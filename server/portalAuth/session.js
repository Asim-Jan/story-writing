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
 * not forget). A Redis error falls back to the process memory instead of failing the sign-in.
 */
export function createOnceStore({ now = Date.now, redis = () => null, ttlS = 300, log = console } = {}) {
  const seen = new Map();                 // id -> expiry ms
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
        try {
          const r = await client.set('stories:portal-handoff:' + id, '1', { NX: true, EX: ttlS });
          return r === 'OK';
        } catch (e) {
          log.warn?.('[portal-auth] hand-off store (redis) failed, using process memory:', e.message);
        }
      }
      return local(id);
    },
  };
}
