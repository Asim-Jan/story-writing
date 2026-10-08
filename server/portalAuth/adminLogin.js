// The hidden administrator sign-in page: break-glass for PORTAL_ONLY.
//
//   GET  /admin/local-login        the page (a form: email + password). NOT linked from anywhere, not in robots.txt or a
//                                  sitemap, noindex, no-store, no referrer, never framed. Obscurity is NOT the protection:
//                                  the protection is everything below, on the server.
//   GET  /admin/local-login.js     its script (the CSP allows no inline scripts)
//   POST /api/auth/login           the EXISTING login endpoint, marked with the header `X-Stories-Entry: admin-local-login`.
//                                  There is no second login code path: the marker only adds THIS surface's hardening
//                                  (`guard`, mounted ahead of the body parser and of the normal limiters), and the same
//                                  rules decide who gets in (PORTAL_ONLY lets only admin accounts through, as before).
//
// What the guard adds for marked requests (unmarked requests are untouched, byte for byte):
//   * 404 unless SAI Cloud sign-in is enabled (PORTAL_OIDC): without it the normal form is the way in and this surface is
//     pointless, so it is not there at all;
//   * same-origin only: Sec-Fetch-Site (when sent) must be `same-origin` and Origin must be this site; JSON content type;
//     a 2 KB body cap (read here, before the 10 MB global parser);
//   * its own strict budget: 5 failures per 15 minutes per ACCOUNT and per IP CLASS (/24 for IPv4, /64 for IPv6), counted
//     BEFORE the attempt and given back on success, so parallel guesses cannot all slip through; Redis when connected, this
//     process otherwise; a locked request gets 429 and never reaches the login handler;
//   * one uniform failure: every refusal (wrong password, unknown address, not an admin under PORTAL_ONLY, suspended, bad
//     body) is the same 401 with the same text, and a "not an admin" or "no such address" answer costs one bcrypt compare,
//     like a wrong password, so neither status, text nor timing class tells them apart;
//   * one audit line per attempt: outcome, account id or "unknown", IP class. Never the email, never the password.
import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

export const ADMIN_LOGIN_PATH = '/admin/local-login';
export const ADMIN_LOGIN_SCRIPT = ADMIN_LOGIN_PATH + '.js';
export const ADMIN_LOGIN_API = '/api/auth/login';
export const ENTRY_HEADER = 'x-stories-entry';
export const ENTRY_VALUE = 'admin-local-login';
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const BODY_LIMIT = '2kb';
export const GENERIC = 'That did not work. Check the details and try again.';
export const LOCKED = 'Too many attempts. Try again later.';
export const UNAVAILABLE = 'Sign-in is not available right now. Try again later.';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_SRC = fs.readFileSync(path.join(here, 'adminLoginPage.client.js'), 'utf8');

/** The page itself. Styles are inline (the CSP below allows them), the script is the file above. ORDNANCE tokens, no emoji. */
export function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Administrator sign-in - Stories</title>
<style>
@font-face{font-family:'Archivo';font-style:normal;font-weight:100 900;font-stretch:62% 125%;font-display:swap;src:url('/fonts/archivo-var-latin.woff2') format('woff2')}
:root{--bg:#F2F0EA;--bg2:#FFFFFF;--line:#C9C6BC;--line2:#A9A69B;--ink:#14181B;--dim:#5A6469;--blue:#29506E;--red:#B4472E;--focus:rgba(41,80,110,.22);--onblue:#fff;
  --sans:'Archivo',ui-sans-serif,system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10161A;--bg2:#161E23;--line:#26333A;--line2:#3A4B54;--ink:#E4E7E4;--dim:#8C9BA2;--blue:#6EA8D8;--red:#E2795C;--focus:rgba(110,168,216,.28);--onblue:#10161A}}
:root[data-theme="dark"]{--bg:#10161A;--bg2:#161E23;--line:#26333A;--line2:#3A4B54;--ink:#E4E7E4;--dim:#8C9BA2;--blue:#6EA8D8;--red:#E2795C;--focus:rgba(110,168,216,.28);--onblue:#10161A}
*{margin:0;padding:0;box-sizing:border-box}
html{background:var(--bg)}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.5}
main{width:100%;max-width:26rem;background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:28px 24px}
.lbl{display:block;font-size:.66rem;text-transform:uppercase;letter-spacing:.09em;font-weight:600;font-stretch:88%;color:var(--dim);margin-bottom:6px}
h1{font-size:1.25rem;font-weight:700;margin-bottom:8px}
p{color:var(--dim);font-size:.9rem;margin-bottom:18px}
p a{color:var(--blue)}
.field{margin-bottom:16px}
input{width:100%;padding:10px 12px;font:inherit;color:var(--ink);background:var(--bg2);border:1px solid var(--line2);border-radius:3px}
input:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px var(--focus)}
button{width:100%;padding:11px 16px;font:inherit;font-weight:600;color:var(--onblue);background:var(--blue);border:1px solid var(--blue);border-radius:3px;cursor:pointer}
button:disabled{opacity:.45;cursor:default}
#msg{border:1px solid var(--red);color:var(--red);border-radius:3px;padding:10px 12px;margin-bottom:16px;font-size:.9rem}
#msg[hidden]{display:none}
</style>
</head>
<body>
<main>
<h1>Administrator sign-in</h1>
<p>This page is for Stories administrators only. Everyone else signs in with <a href="/auth/portal/login">SAI Cloud</a>.</p>
<form id="f" method="post" action="#" autocomplete="on">
<div id="msg" role="alert" hidden></div>
<div class="field"><label class="lbl" for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
<div class="field"><label class="lbl" for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
<button id="go" type="submit">Sign in</button>
</form>
<noscript><p style="margin-top:16px">This page needs JavaScript.</p></noscript>
</main>
<script src="${ADMIN_LOGIN_SCRIPT}"></script>
</body>
</html>
`;
}

// Its own CSP (helmet's global one is overridden for this page): nothing but this origin, inline styles, no framing, no base.
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; "
  + "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** Headers every response of this surface carries. */
export function surfaceHeaders(res) {
  res.set({
    'Cache-Control': 'no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': PAGE_CSP,
    'X-Frame-Options': 'DENY',
  });
}

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

/**
 * A counter per fixed window: hit(key) adds one and says how many there are now; the returned release() gives the one
 * back (a success is not a failure). Redis (when `redis()` yields a client) so replicas agree and a restart does not
 * forget; the process's memory otherwise, and also when Redis does not answer within `redisTimeoutMs` (node-redis queues
 * commands while it reconnects, so a dead Redis must never make a sign-in wait). hit and release use the SAME backend.
 */
export function createWindowCounter({ now = Date.now, redis = () => null, windowMs = WINDOW_MS, redisTimeoutMs = 750, maxKeys = 20000, log = console } = {}) {
  const mem = new Map();                       // key -> { n, exp }
  const ttlS = Math.ceil(windowMs / 1000);
  let lastWarn = -Infinity;
  const warn = (what) => {
    if (now() - lastWarn < 60_000) return;
    lastWarn = now();
    log.warn?.(`[admin-local-login] limiter store (redis) ${what}, using process memory`);
  };
  const sweep = () => {
    const t = now();
    for (const [k, v] of mem) if (v.exp <= t) mem.delete(k);
    while (mem.size >= maxKeys) mem.delete(mem.keys().next().value);   // oldest first: bounded however many addresses are tried
  };
  const withTimeout = (p) => {
    let timer;
    return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), redisTimeoutMs); })]).finally(() => clearTimeout(timer));
  };
  const memHit = (key) => {
    const t = now();
    let e = mem.get(key);
    if (!e || e.exp <= t) { if (mem.size >= maxKeys) sweep(); e = { n: 0, exp: t + windowMs }; mem.set(key, e); }
    e.n += 1;
    return { n: e.n, release: async () => { const x = mem.get(key); if (x && x === e && x.n > 0) x.n -= 1; } };
  };
  return {
    async hit(key) {
      let client = null;
      try { client = redis(); } catch { client = null; }
      if (client) {
        const k = 'stories:admin-login:' + key;
        try {
          const n = await withTimeout((async () => { const v = await client.incr(k); if (v === 1) await client.expire(k, ttlS); return v; })());
          return { n, release: async () => { try { await withTimeout(client.decr(k)); } catch { /* the window expires on its own */ } } };
        } catch (e) {
          warn(e && e.message === 'timed out' ? 'did not answer in time' : 'failed');
        }
      }
      return memHit(key);
    },
  };
}

const hashKey = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);

/**
 * @param {object} o
 * @param {object} o.cfg                 the portal config (read live: it flips to disabled on a bad client config)
 * @param {object} [o.log]
 * @param {() => object|null} [o.redis]
 */
export function createAdminLogin({ cfg, log = console, now = Date.now, redis = () => null, counter = null, maxFailures = MAX_FAILURES }) {
  const limits = counter || createWindowCounter({ now, redis, log });
  const dummyHash = bcrypt.hashSync('not-a-password-' + crypto.randomBytes(8).toString('hex'), 10);
  const json = express.json({ limit: BODY_LIMIT, type: () => true });
  const router = express.Router();

  const enabled = () => !!cfg.enabled;
  const appOrigin = () => { try { return new URL(cfg.redirectUri).origin; } catch { return ''; } };
  const notFound = (res) => res.status(404).json({ error: 'Not found' });

  router.get(ADMIN_LOGIN_PATH, (req, res) => {
    if (!enabled()) return notFound(res);
    surfaceHeaders(res);
    res.type('html').send(renderPage());
  });
  router.get(ADMIN_LOGIN_SCRIPT, (req, res) => {
    if (!enabled()) return notFound(res);
    surfaceHeaders(res);
    res.type('application/javascript').send(SCRIPT_SRC);
  });

  const audit = (outcome, req, extra = '') => {
    // outcome, account id (or unknown), IP class. Never the address typed, never the password, never the IP itself.
    log.log?.(`[admin-local-login] outcome=${outcome} acct=${req.loginAccountId || 'unknown'} ipclass=${ipClass(req.ip)}${extra ? ' ' + extra : ''}`);
  };

  const sameOrigin = (req) => {
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin') return false;
    const origin = req.get('origin');
    if (!origin) return false;
    let o;
    try { o = new URL(origin); } catch { return false; }
    if (o.protocol !== 'https:' && o.protocol !== 'http:') return false;
    if (appOrigin() && o.origin === appOrigin()) return true;
    const host = req.get('host');
    return !!host && o.host === host;
  };

  const refuse = (req, res, status, reason, text = GENERIC) => {
    audit(status === 429 ? 'locked' : 'refused', req, `reason=${reason} status=${status}`);
    if (status === 429) res.set('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
    return res.status(status).json({ error: text });
  };

  async function guard(req, res, next) {
    if (req.method !== 'POST' || String(req.get(ENTRY_HEADER) || '').toLowerCase() !== ENTRY_VALUE) return next();
    try {
      req.adminLocalLogin = true;
      res.set('Cache-Control', 'no-store');
      if (!enabled()) return notFound(res);
      if (!sameOrigin(req)) return refuse(req, res, 403, 'cross_site');
      if (!/^application\/json\s*(;|$)/i.test(req.get('content-type') || '')) return refuse(req, res, 415, 'content_type');
      await new Promise((resolve, reject) => json(req, res, (err) => (err ? reject(err) : resolve())));
      const b = req.body;
      const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
      if (!email || email.length > 320 || typeof b.password !== 'string' || !b.password || b.password.length > 1024) return refuse(req, res, 400, 'body');

      // the budget is spent BEFORE the attempt and given back when it succeeds
      const a = await limits.hit('a:' + hashKey(email));
      const i = await limits.hit('i:' + ipClass(req.ip));
      if (a.n > maxFailures || i.n > maxFailures) return refuse(req, res, 429, a.n > maxFailures ? 'account_budget' : 'ip_budget', LOCKED);

      // every failure leaves as the same 401 (a PORTAL_ONLY refusal costs one bcrypt compare, like a wrong password does)
      const send = res.json.bind(res);
      res.json = (body) => {
        const code = res.statusCode;
        if (res.headersSent) return res;
        if (code >= 200 && code < 300) {
          a.release(); i.release();
          return send(body);
        }
        (async () => {
          if (code === 403 && body?.code === 'PORTAL_ONLY') await bcrypt.compare('x', dummyHash).catch(() => false);
          const status = code >= 500 ? 503 : 401;
          res.status(status);
          send({ error: status === 503 ? UNAVAILABLE : GENERIC });
        })();
        return res;
      };
      res.on('finish', () => {
        const code = res.statusCode;
        audit(code >= 200 && code < 300 ? 'success' : code === 429 ? 'locked' : 'failure', req, `status=${code}`);
      });
      return next();
    } catch (e) {
      // body-parser errors carry a status (413 too large, 400 not JSON); anything else is ours
      const status = e && (e.status === 413 || e.type === 'entity.too.large') ? 413 : e && e.status === 400 ? 400 : 0;
      if (status) return refuse(req, res, status, status === 413 ? 'too_large' : 'bad_json');
      log.error?.('[admin-local-login] guard failed:', e && (e.code || e.name));
      return res.status(503).json({ error: UNAVAILABLE });
    }
  }

  return {
    router, guard,
    /** An unknown address costs what a wrong password costs (the login handler calls this when the lookup finds nobody). */
    dummyCompare: (password) => bcrypt.compare(String(password || ''), dummyHash).catch(() => false),
  };
}
