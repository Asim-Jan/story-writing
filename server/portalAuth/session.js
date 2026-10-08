// Small session helpers for the SAI Cloud sign-in: how long a re-issued token may live, and a one-time-use memory.

export const PASSWORD_SESSION_TTL_S = 7 * 24 * 3600;     // what the password login has always issued
export const PORTAL_SESSION_CAP_S = 24 * 3600;           // a portal-linked user never gets more than this in one token

/**
 * The lifetime for a token that REPLACES the session's current one (change-password hands the caller a fresh token
 * carrying the new token_version). A 24 hour portal session must not turn into a 7 day one: a portal-linked user
 * gets what is left of the current token, at most 24 hours. Everyone else keeps the 7 days they always had.
 */
export function reissueLifetimeS({ exp, nowS, portalLinked }) {
  if (!portalLinked) return PASSWORD_SESSION_TTL_S;
  const left = Number.isFinite(exp) ? Math.floor(exp - nowS) : PORTAL_SESSION_CAP_S;
  return Math.max(60, Math.min(left, PORTAL_SESSION_CAP_S));
}

/**
 * "Use once" memory for the SPA hand-off: consume(id) is true the first time an id is seen and false afterwards.
 * Kept in this process; if `redis()` yields a client, SET NX EX is used so every replica agrees (and a restart does
 * not forget). Redis must never make the sign-in wait or fail: node-redis v4 QUEUES commands while it reconnects, so a
 * `set` against a dead Redis can hang for as long as the outage lasts. The call therefore races a short timeout
 * (`redisTimeoutMs`), and on a timeout or an error the process memory decides instead. Warned about once per `warnEveryMs`.
 * (Consequence on a timeout with several replicas: that one call is checked per replica, not globally.)
 */
export function createOnceStore({ now = Date.now, redis = () => null, ttlS = 300, log = console, redisTimeoutMs = 750, warnEveryMs = 60_000 } = {}) {
  const seen = new Map();                 // id -> expiry ms
  let lastWarn = -Infinity;
  const warn = (what) => {
    const t = now();
    if (t - lastWarn < warnEveryMs) return;
    lastWarn = t;
    log.warn?.(`[portal-auth] hand-off store (redis) ${what}, using process memory (this warning is rate-limited)`);
  };
  const local = (id) => {
    const t = now();
    for (const [k, exp] of seen) if (exp <= t) seen.delete(k);
    if (seen.has(id)) return false;
    seen.set(id, t + ttlS * 1000);
    return true;
  };
  return {
    async consume(id) {
      if (typeof id !== 'string' || !id) return false;
      let client = null;
      try { client = redis(); } catch { client = null; }
      if (client) {
        let timer;
        try {
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), redisTimeoutMs); });
          const r = await Promise.race([client.set('stories:portal-handoff:' + id, '1', { NX: true, EX: ttlS }), timeout]);
          return r === 'OK';
        } catch (e) {
          // only the failure KIND is logged: no key (it holds the jti), no token, no connection string
          warn(e && e.message === 'timed out' ? 'did not answer in time' : 'failed');
        } finally { clearTimeout(timer); }
      }
      return local(id);
    },
  };
}
