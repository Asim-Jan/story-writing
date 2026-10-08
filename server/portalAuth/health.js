// Is SAI Cloud (the portal) reachable, and does it serve what sign-in needs? A small cached probe: the discovery
// document and the key set are fetched in the BACKGROUND (a short timeout, never inside a request) and the answer is
// "healthy" while both were fetched OK within the last `freshMs` (10 minutes).
//
// What it is for: PORTAL_ONLY switches the password routes off. If the portal is down, that would lock EVERYONE out
// of Stories, so PORTAL_ONLY is only enforced while this says healthy. Not yet probed (just booted) counts as NOT
// healthy: local sign-in stays available until the first probe has succeeded.
//
// What it CANNOT see: the probe only proves the portal's public documents are reachable and well-formed. A wrong
// client secret, a redirect URI that is not registered at the portal, or a client that is disabled there only fail
// at the token step of a real sign-in. Only a real round trip proves those, so PORTAL_ONLY stays OFF until one works
// for every user (see STORIES-SAI-CLOUD.md in the deployment repo).

export const HEALTH_FRESH_MS = 10 * 60 * 1000;
export const PROBE_INTERVAL_MS = 60 * 1000;
export const PROBE_TIMEOUT_MS = 5000;

export function createProviderHealth({
  issuer, fetch: fetchImpl, now = Date.now, log = console,
  freshMs = HEALTH_FRESH_MS, intervalMs = PROBE_INTERVAL_MS, timeoutMs = PROBE_TIMEOUT_MS, autoStart = true,
}) {
  const doFetch = fetchImpl || globalThis.fetch;
  let lastOkAt = 0;
  let lastTryAt = 0;
  let lastError = '';
  let wasHealthy = null;
  let inflight = null;
  let timer = null;

  const getJson = async (url) => {
    const res = await doFetch(url, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) throw new Error('HTTP ' + res.status);
    return JSON.parse(await res.text());
  };

  const sameOriginHttps = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.origin === issuer; } catch { return false; } };

  async function runProbe() {
    lastTryAt = now();
    try {
      const d = await getJson(issuer + '/.well-known/openid-configuration');
      if (!d || d.issuer !== issuer) throw new Error('discovery names a different issuer');
      if (!sameOriginHttps(d.jwks_uri)) throw new Error('discovery has no usable jwks_uri');
      const k = await getJson(d.jwks_uri);
      if (!k || !Array.isArray(k.keys) || !k.keys.length) throw new Error('the key set is empty');
      lastOkAt = now();
      lastError = '';
    } catch (e) {
      lastError = String((e && e.name === 'TimeoutError') ? 'timeout' : (e && e.message) || e).slice(0, 120);
    }
    const healthy = isHealthy();
    if (wasHealthy !== healthy) {
      // one line per change, never one per probe
      if (healthy) log.log?.('[portal-auth] SAI Cloud is reachable: PORTAL_ONLY (if set) is enforced');
      else log.warn?.('[portal-auth] SAI Cloud is NOT reachable (' + (lastError || 'not probed yet') + '): PORTAL_ONLY is not enforced, password sign-in stays available');
      wasHealthy = healthy;
    }
    return healthy;
  }

  /** One probe at a time; callers share it. */
  function probe() {
    if (!inflight) inflight = runProbe().finally(() => { inflight = null; });
    return inflight;
  }

  function isHealthy() { return lastOkAt > 0 && now() - lastOkAt < freshMs; }

  /** For request paths: the cached answer, and a refresh in the background if one is due. Never waits. */
  function check() {
    if (autoStart && !inflight && now() - lastTryAt >= intervalMs) probe().catch(() => {});
    return isHealthy();
  }

  function start() {
    if (timer || !autoStart) return;
    probe().catch(() => {});
    timer = setInterval(() => { probe().catch(() => {}); }, intervalMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {
    check, probe, start, stop, isHealthy,
    status: () => ({ healthy: isHealthy(), lastOkAgoS: lastOkAt ? Math.round((now() - lastOkAt) / 1000) : null, ...(isHealthy() || !lastError ? {} : { lastError }) }),
  };
}
