// The identity-events receiver: the portal tells Stories that an account was deleted / disabled / re-enabled /
// signed out everywhere (STORIES-DELETION.md; the sender is sai-cluster/manifests/sai-portal/events.js, the
// verifier the vendored sai-auth-client's verifyEvent — Drive's receiver, sai-drive/app/identity-events.js,
// is the reference).
//
//   POST /auth/events    one signed Security Event Token per call, applied in ONE transaction with its log row, THEN 202.
//
// The rules, all from the contract:
//   - IN-CLUSTER ONLY: a request carrying X-Forwarded-For / X-Real-Ip gets a stranger's 404 (the route is also not
//     on the public Ingress — both layers, as Drive does it).
//   - The signed token is the credential: ES256 against the portal's JWKS, typ secevent+jwt, iss, aud = 'stories',
//     iat within 300 s, exp in the future, jti + sub present, exactly one event. A bad token is 400 (the portal
//     dead-letters it); a JWKS failure is 503 (the portal retries).
//   - A replayed jti is refused — but the DURABLE identity_events row is the truth: a jti seen before only short-
//     circuits when its event row exists (that apply committed); a jti whose apply failed mid-way is re-applied.
//   - account-deleted erases the person BEFORE anything is answered: re-check the sub with the portal's
//     subjects/check (only 'gone' erases; anything else = 503 so the portal retries), then erase (erasure.js),
//     record the evt FOREVER, and only then answer 2xx. An erase that is not finished = 503, never "done".
//   - account-disabled/enabled and backchannel-logout are reversible: block/restore sign-in, end sessions — never erase.
//   - Log event ids and counts only. Never the token, a sub's data, titles or file names.
'use strict';

import { createJtiSet } from '../vendor/sai-auth-client/index.cjs';
import { parseSubjectCheck } from './subjectsCheck.js';
import { createEraser } from './erasure.js';

const MAX = 8192;

export function createIdentityEvents({ pool, storage, redisClient, client, appSecret, portalBase = 'http://sai-portal.sai-portal.svc.cluster.local:8100', fetch: fetchImpl = globalThis.fetch, log = console, now = Date.now }) {
  if (!pool || !client || !appSecret) throw new Error('identity-events: pool, client and appSecret are required');

  const jtiSet = createJtiSet({ ttlS: 86400, max: 50000, now });                    // replay guard (24 h > token life)
  let jtiLoaded = false;
  const jtiLoad = async () => {
    if (jtiLoaded) return;
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'identity_jti_set'");
      if (rows.length) jtiSet.load(JSON.parse(rows[0].value));
    } catch (e) { log.error && log.error('[identity-events] could not load the jti set:', e.message); }
    jtiLoaded = true;
  };
  const jtiSave = async () => {
    try {
      await pool.query(
        "INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('identity_jti_set', $1, NOW(), NULL) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        [JSON.stringify(jtiSet.export())]);
    } catch (e) { log.error && log.error('[identity-events] could not save the jti set:', e.message); }
  };

  const reply = (res, code, obj) => res.status(code).json(obj);
  const readBody = (req) => new Promise((resolve, reject) => {
    const ch = []; let n = 0, over = false;
    req.on('data', d => { if (over) return; n += d.length; if (n > MAX) { over = true; reject(Object.assign(new Error('too large'), { status: 413 })); } else ch.push(d); });
    req.on('end', () => { if (!over) resolve(Buffer.concat(ch).toString('utf8').trim()); });
    req.on('error', reject);
  });

  /* The portal's answer for one sub ('gone' | 'disabled' | 'ok') or a THROW when it cannot tell — strict on
   * purpose (subjectsCheck.js): anything but two real arrays must not become "ok" and stop an erasure. */
  async function subjectState(sub) {
    const r = await fetchImpl(portalBase + '/api/apps/subjects/check', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'X-App-Id': 'stories', 'X-App-Secret': appSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ subs: [sub] }),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 403) throw Object.assign(new Error('the portal refused our app secret'), { code: 'bad_secret' });
    return parseSubjectCheck(j, sub);
  }

  /* ── the durable event log ─────────────────────────────────────────────────────────────────────── */
  /* ONE insert decides everything: a conflict on the PRIMARY KEY evt means "already handled" — a 202 that
   * changes nothing. Deletion rows are kept forever; disabled/enabled/logout rows age out (the sweeper). */
  async function recordEvent({ evt, jti, sub, type, at }) {
    const { rows } = await pool.query(
      `INSERT INTO identity_events (evt, jti, sub, type, at) VALUES ($1, $2, $3, $4, to_timestamp($5))
       ON CONFLICT (evt) DO NOTHING RETURNING evt`, [evt, jti, sub, type, at]);
    return { duplicate: !rows.length };
  }
  const evtRecorded = async (evt) => (await pool.query('SELECT 1 FROM identity_events WHERE evt = $1', [evt])).rows.length > 0;

  /* ── one event, applied ────────────────────────────────────────────────────────────────────────── */
  async function apply(type, ev, at) {
    if (type === 'account-deleted') {
      // the durable evt row is checked first: a retry of a COMPLETED erase answers from the log
      if (await evtRecorded(ev.evt)) return { ok: true, duplicate: true };
      let st;
      try { st = await subjectState(ev.sub); }
      catch (e) {
        // an unreachable or unreadable portal answer is NEVER an erase and NEVER a 4xx: 503, the portal retries
        log.error('[identity-events] subjects/check could not be answered:', e && e.message);
        return { retry: true };
      }
      if (st !== 'gone') {
        // 'ok'/'disabled' = not an erase yet: 503 so the portal retries (the sub may still be mid-deletion);
        // a bad_secret throw propagates (503; the operator is needed — the secret wiring is broken).
        log.warn && log.warn(`[identity-events] deletion postponed (the portal does not say gone yet: ${st})`);
        return { retry: true, postpone: st };
      }
      const r = await createEraser({ pool, storage, redis: redisClient, log }).eraseBySub(ev.sub);
      if (!r.done) return { retry: true };
      const rec = await recordEvent({ evt: ev.evt, jti: ev.jti, sub: ev.sub, type, at });
      if (!rec.duplicate) await jtiSave();
      return { ok: true, duplicate: rec.duplicate, counts: r.counts };
    }
    // reversible events: record FIRST (so a crash between record and act is healed by the evt dedupe on retry),
    // then act; both are idempotent and ordered by the event's own time.
    const rec = await recordEvent({ evt: ev.evt, jti: ev.jti, sub: ev.sub, type, at });
    if (rec.duplicate) return { ok: true, duplicate: true };
    if (type === 'account-disabled') await disableUser(ev.sub, at);
    else if (type === 'account-enabled') await enableUser(ev.sub, at);
    else await endSessions(ev.sub, at);
    await jtiSave();
    return { ok: true };
  }

  /* disable: block sign-in (both sign-in paths read users.status) and kill every issued JWT (token_version bump).
   * Ordered by the event time: a late retry of an OLDER event must not undo a newer one. An erased account stays
   * erased — a disabled event must never resurrect anyone. */
  const sinceClause = 'AND (state_event_at IS NULL OR state_event_at <= to_timestamp($2))';
  const bumpClock = (sub, at) => pool.query(
    `UPDATE users SET state_event_at = GREATEST(COALESCE(state_event_at, to_timestamp(0)), to_timestamp($2))
     WHERE portal_sub = $1 AND (state_event_at IS NULL OR state_event_at < to_timestamp($2))`, [sub, at]);
  async function disableUser(sub, at) {
    await pool.query(
      `UPDATE users SET status = CASE WHEN status = 'erased' THEN status ELSE 'suspended' END,
         token_version = token_version + 1
       WHERE portal_sub = $1 ${sinceClause}`, [sub, at]);
    await bumpClock(sub, at);
  }
  async function enableUser(sub, at) {
    await pool.query(
      `UPDATE users SET status = CASE WHEN status = 'erased' THEN status ELSE 'active' END
       WHERE portal_sub = $1 ${sinceClause}`, [sub, at]);
    await bumpClock(sub, at);
  }
  async function endSessions(sub, at) {
    await pool.query(
      `UPDATE users SET token_version = token_version + 1 WHERE portal_sub = $1 ${sinceClause}`, [sub, at]);
    await bumpClock(sub, at);
  }

  /* ── the route ─────────────────────────────────────────────────────────────────────────────────── */
  /* handleToken: verify + apply one token string → { status, body } — the SAME core the POST route serves, so the
   * catch-up sweep (a pulled token) runs exactly what a delivered event runs. */
  async function handleToken(token) {
    let ev;
    try { ev = await client.verifyEvent(token); }
    catch (e) {
      if (e && e.code === 'bad_event') { log.error('[identity-events] token refused:', e.reason); return { status: 400, body: { error: 'event refused' } }; }
      log.error('[identity-events] cannot verify right now:', e && e.code);
      return { status: 503, body: { error: 'cannot verify right now' } };               // the portal retries
    }
    const names = Object.keys(ev.events);
    if (names.length !== 1) return { status: 400, body: { error: 'exactly one event per token' } };
    const type = names[0], body = ev.events[type];
    // replay guard: a jti we have COMPLETED before short-circuits; one that failed mid-way falls through and re-applies
    if (jtiSet.seen(ev.jti) && (await evtRecorded(ev.evt))) return { status: 202, body: { ok: true, duplicate: true } };
    try {
      const r = await apply(type, { evt: body.evt, jti: ev.jti, sub: ev.sub }, body.at);
      jtiSet.seen(ev.jti);                                                              // mark only on success
      if (r.retry) return { status: 503, body: { error: 'cannot finish yet; retry' } };
      return { status: 202, body: { ok: true, ...(r.duplicate ? { duplicate: true } : {}) } };
    } catch (e) {
      log.error('[identity-events] could not apply:', e && e.message);
      return { status: 500, body: { error: 'could not apply' } };                       // the portal retries
    }
  }

  return { handle: async (req, res) => {
    if (req.headers['x-forwarded-for'] || req.headers['x-real-ip']) return reply(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'method not allowed' });
    if (!/^application\/secevent\+jwt\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) { req.resume(); return reply(res, 415, { error: 'send application/secevent+jwt' }); }
    let token;
    try { token = await readBody(req); } catch (e) { return reply(res, e.status || 400, { error: 'bad body' }); }
    await jtiLoad();
    const out = await handleToken(token);
    return reply(res, out.status, out.body);
  }, handleToken };
}
