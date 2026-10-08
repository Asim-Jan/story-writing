// The failure budgets behind password sign-in: one normalised key per ACCOUNT and one per IP CLASS, in a counter that is
// shared across replicas through Redis when it is connected and lives in this process's memory otherwise.
//
//   normalizeEmail   the one spelling every limiter keys on, so "Admin@x", " admin@x " and "ADMIN@X" are one account
//   ipClass          /24 (IPv4) or /64 (IPv6)
//   createWindowCounter   fixed-window counter: hit() adds one, release() gives it back (a success is not a failure)
//
// The Redis side is two Lua scripts, so a window can never be left without an end: INCR and EXPIRE are one atomic step, and a
// key that somehow has no TTL (an EXPIRE that was lost, a key written by hand) is given one by the next hit.
//
// The memory side is the fallback, and it is PER PROCESS: with N replicas and Redis down a caller gets N budgets, not one.
// It cannot be flushed by volume: the IP class is charged before any account key exists, eviction is least-recently-used and
// never takes a key that is already at half its budget or more, and one IP class may only create a bounded number of new keys per window.
import crypto from 'crypto';

export const MAX_FAILURES = 5;                 // the marked admin page: per account and per IP class
export const ACCOUNT_MAX_FAILURES = 10;        // every other password sign-in: per account
export const WINDOW_MS = 15 * 60 * 1000;
export const NEW_KEYS_PER_CLASS = 300;
const KEY_PREFIX = 'stories:admin-login:';
const CAPPED = Number.MAX_SAFE_INTEGER;

/** Lower case, trimmed, Unicode NFKC: the spelling the account lookup is insensitive to, and then some. '' when it is not a string. */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return '';
  return raw.slice(0, 400).normalize('NFKC').trim().toLowerCase();
}

/** The key under which an address's failures are counted (hashed: the address never reaches Redis or a log). */
export const accountKey = (email) => 'acct:' + crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 24);

/** "203.0.113.0/24" for IPv4 (also ::ffff:a.b.c.d), "2001:db8:1:2::/64" for IPv6; "unknown" when there is no address. */
export function ipClass(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return 'unknown';
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) s = mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return s.split('.').slice(0, 3).join('.') + '.0/24';
  if (!s.includes(':')) return 'unknown';
  const [head, tail = null] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail === null ? [] : (tail ? tail.split(':') : []);
  const groups = tail === null ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return 'unknown';
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** The key the normal login's rate limiter uses: the NORMALISED address plus the client address. */
export const loginLimiterKey = (req) => `auth:${normalizeEmail(req.body?.email) || 'unknown'}:${req.ip}`;

// one atomic step: add one; (re)start the window when the key is new or has lost its TTL
export const HIT_LUA = `local v = redis.call('INCR', KEYS[1])
if v == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;
// give one back, never below zero
export const RELEASE_LUA = `local v = tonumber(redis.call('GET', KEYS[1]))
if v and v > 0 then return redis.call('DECR', KEYS[1]) end
return 0`;

/**
 * @param {object} [o]
 * @param {() => object|null} [o.redis]       yields a connected node-redis client, or null
 * @param {number} [o.redisTimeoutMs]         node-redis queues commands while it reconnects: a dead Redis must never make a sign-in wait
 * @param {number} [o.maxKeys]                memory fallback: table size
 * @param {number} [o.newKeysPerClass]        memory fallback: new account keys one IP class may create per window
 *
 * hit(key, { budget, cls }) -> { n, capped, release() }
 *   budget  how many this key may take; the memory fallback never evicts a key past half of it
 *   cls     the caller's IP class: when given, creating a NEW key spends from that class's allowance
 *   capped  (memory only) the table or the class allowance is full: n is huge, so the caller refuses the request
 */
export function createWindowCounter({ now = Date.now, redis = () => null, windowMs = WINDOW_MS, redisTimeoutMs = 750, maxKeys = 20000,
  newKeysPerClass = NEW_KEYS_PER_CLASS, log = console } = {}) {
  const mem = new Map();                       // key -> { n, exp, budget, cls }; Map order = least recently used first
  const created = new Map();                   // cls -> { n, exp }: new account keys this window
  const ttlS = Math.ceil(windowMs / 1000);
  const lastWarn = {};
  const warn = (kind, text) => {
    if (now() - (lastWarn[kind] ?? -Infinity) < 60_000) return;
    lastWarn[kind] = now();
    log.warn?.(`[admin-local-login] ${text}`);
  };
  const withTimeout = (p) => {
    let timer;
    return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), redisTimeoutMs); })]).finally(() => clearTimeout(timer));
  };

  let lastSweep = -Infinity;
  const forget = (e) => {
    if (!e.cls) return;
    const c = created.get(e.cls);
    if (c && c.n > 0) c.n -= 1;
  };
  const drop = (k, e) => { mem.delete(k); forget(e); };
  const sweep = () => {                        // expired entries, at most once a second
    const t = now();
    if (t - lastSweep < 1000) return;
    lastSweep = t;
    for (const [k, v] of mem) if (v.exp <= t) drop(k, v);
    for (const [k, v] of created) if (v.exp <= t || v.n <= 0) created.delete(k);
    while (created.size > maxKeys) created.delete(created.keys().next().value);
  };
  /** Room for one more key? Expired first, then the least recently used key that is not past half its budget. */
  const makeRoom = () => {
    if (mem.size < maxKeys) return true;
    sweep();
    if (mem.size < maxKeys) return true;
    for (const [k, v] of mem) {
      if (v.n * 2 >= v.budget) continue;      // a key at half its budget or more is being attacked: the one thing we must not forget
      drop(k, v);
      return true;
    }
    return false;
  };
  const memHit = (key, budget, cls) => {
    const t = now();
    let e = mem.get(key);
    if (e && e.exp <= t) { drop(key, e); e = undefined; }
    if (e) {
      mem.delete(key); mem.set(key, e);        // most recently used
    } else {
      if (cls) {
        let c = created.get(cls);
        if (!c || c.exp <= t) { c = { n: 0, exp: t + windowMs }; created.set(cls, c); }
        if (c.n >= newKeysPerClass) { warn('class', `limiter: one IP class created ${newKeysPerClass} new account keys this window, refusing more from it (process memory, per replica)`); return { n: CAPPED, capped: true, release: async () => {} }; }
      }
      if (!makeRoom()) { warn('full', `limiter: the in-memory table is full of keys under attack, refusing new ones (process memory, per replica)`); return { n: CAPPED, capped: true, release: async () => {} }; }
      e = { n: 0, exp: t + windowMs, budget, cls: cls || '' };
      mem.set(key, e);
      if (cls) created.get(cls).n += 1;
    }
    e.n += 1;
    if (budget < e.budget) e.budget = budget;   // protected from the TIGHTEST limit anyone applies to it
    return {
      n: e.n,
      release: async () => {
        if (mem.get(key) !== e || e.n <= 0) return;
        e.n -= 1;
        if (e.n === 0) drop(key, e);           // a success leaves nothing behind (and gives the class its allowance back)
      },
    };
  };

  return {
    async hit(key, { budget = MAX_FAILURES, cls = '' } = {}) {
      let client = null;
      try { client = redis(); } catch { client = null; }
      if (client) {
        const k = KEY_PREFIX + key;
        try {
          const n = Number(await withTimeout(client.eval(HIT_LUA, { keys: [k], arguments: [String(ttlS)] })));
          if (!Number.isFinite(n)) throw new Error('bad reply');
          return { n, release: async () => { try { await withTimeout(client.eval(RELEASE_LUA, { keys: [k] })); } catch { /* the window expires on its own */ } } };
        } catch (e) {
          warn('redis', `limiter store (redis) ${e && e.message === 'timed out' ? 'did not answer in time' : 'failed'}, using this process's memory (the budget is then per replica)`);
        }
      }
      return memHit(key, budget, cls);
    },
    /** For tests and diagnostics. */
    size: () => mem.size,
  };
}
