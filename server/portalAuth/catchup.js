// The catch-up sweep (STORIES-DELETION.md section 12): the receiver can miss events while this app is down, and
// the portal stops retrying after 7 days — so an app that was down catches up itself:
//   1. at start-up and nightly, GET the portal's /api/apps/events?since=<cursor> and run the SAME handler on each
//      returned token (the pull mints freshly signed tokens, so verifyEvent accepts them like any delivery);
//   2. nightly, sweep every portal_sub Stories knows through /api/apps/subjects/check (at most 500 per call) and
//      erase any that come back gone — the backstop that catches a deletion whose queue row aged out entirely.
// The cursor and the last-run date live in app_settings: a restart never replays or skips. Best-effort: a failure
// logs and waits for the next run; it never crashes the server.
'use strict';

const EVENTS_PATH = '/api/apps/events';
const CHECK_PATH = '/api/apps/subjects/check';
const SWEEP_HOUR_UTC = 4;                                            // quiet hours for this site
const DAY_MS = 24 * 3600 * 1000;
const CHECK_BATCH = 500;                                             // the portal's cap per subjects/check call

export function startCatchUp({ pool, appSecret, portalBase = 'http://sai-portal.sai-portal.svc.cluster.local', onToken, onSubGone, log = console, now = Date.now, fetch: fetchImpl = globalThis.fetch }) {
  if (!pool || !appSecret || !onToken || !onSubGone) throw new Error('catch-up: pool, appSecret, onToken and onSubGone are required');
  const headers = { 'X-App-Id': 'stories', 'X-App-Secret': appSecret };
  let running = false;

  const getSetting = async (name, fallback) => {
    try {
      const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['identity_catchup_' + name]);
      return rows.length ? rows[0].value : fallback;
    } catch { return fallback; }
  };
  const putSetting = async (name, value) => {
    try {
      await pool.query(
        "INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), NULL) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        ['identity_catchup_' + name, String(value)]);
    } catch (e) { log.error && log.error('[identity-catchup] could not save ' + name + ':', e.message); }
  };

  /* the queue catch-up: pull since the cursor, hand each token to the receiver's own handler. The cursor moves to
   * the END of what the portal returned even when an event failed (each failure is logged; the nightly subjects/check
   * sweep below is the backstop that still erases a missed deletion). Returns { pulled, applied, cursor }. */
  async function pullEvents() {
    const cursor = Number(await getSetting('cursor', '0')) || 0;
    const r = await fetchImpl(portalBase + EVENTS_PATH + '?since=' + cursor + '&limit=200', { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('the portal answered ' + r.status);
    const j = await r.json().catch(() => null);
    if (!j || !Array.isArray(j.events)) throw new Error('an unreadable pull answer');
    let applied = 0;
    for (const e of j.events) {
      try {
        const out = await onToken(e.token);                 // the receiver's handle(): verifies + applies + dedupes
        if (out && (out.status === 200 || out.status === 202)) applied++;
      } catch (err) { log.error && log.error('[identity-catchup] one event failed:', err && err.message); }
    }
    const next = Number.isInteger(j.next) && j.next > cursor ? j.next : cursor;
    if (next !== cursor) await putSetting('cursor', next);
    return { pulled: j.events.length, applied, cursor: next };
  }

  /* every linked sub, CHECK_BATCH per call; each 'gone' sub goes through the eraser's own idempotent path */
  async function sweepSubjects() {
    const { rows } = await pool.query("SELECT DISTINCT portal_sub FROM users WHERE portal_sub IS NOT NULL AND status <> 'erased' LIMIT 2000");
    const subs = rows.map(r => r.portal_sub).filter(s => /^u_[a-f0-9]{16}$/.test(s));
    let gone = 0;
    for (let i = 0; i < subs.length; i += CHECK_BATCH) {
      const r = await fetchImpl(portalBase + CHECK_PATH, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ subs: subs.slice(i, i + CHECK_BATCH) }), signal: AbortSignal.timeout(20000),
      });
      if (r.status === 403) throw new Error('the portal refused our app secret (the mirror is broken)');
      const j = await r.json().catch(() => null);
      if (!j || !Array.isArray(j.gone)) throw new Error('an unreadable subjects/check answer');
      for (const s of j.gone) {
        try { await onSubGone(s); gone++; } catch (e) { log.error && log.error('[identity-catchup] one sweep erase failed:', e && e.message); }
      }
    }
    return { checked: subs.length, gone };
  }

  async function run() {
    if (running) return { skipped: 'busy' };
    running = true;
    try {
      const out = { queue: await pullEvents(), sweep: await sweepSubjects() };
      await putSetting('last_run', new Date(now()).toISOString());
      log.info && log.info(`[identity-catchup] ran (pulled ${out.queue.pulled}, applied ${out.queue.applied}, swept ${out.sweep.checked}, gone ${out.sweep.gone})`);
      return out;
    } finally { running = false; }
  }

  /* nightly at SWEEP_HOUR_UTC: fire at most once per UTC day (the last_run date guards the hour window) */
  const timer = setInterval(() => {
    const d = new Date(now());
    if (d.getUTCHours() !== SWEEP_HOUR_UTC) return;
    (async () => {
      const last = await getSetting('last_day', '');
      const today = d.toISOString().slice(0, 10);
      if (last === today) return;
      await putSetting('last_day', today);
      run().catch(e => log.error && log.error('[identity-catchup] nightly run failed:', e.message));
    })();
  }, 60 * 60 * 1000);
  timer.unref();

  return { run, _test: { pullEvents, sweepSubjects, stop: () => clearInterval(timer) } };
}
