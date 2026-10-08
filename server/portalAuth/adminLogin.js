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
//   * not there unless SAI Cloud sign-in is enabled (PORTAL_OIDC): without it the normal form is the way in and this surface is
//     pointless. The page and its script then fall through to whatever the app answers for any unknown path (so the build is
//     not fingerprinted by them); a marked POST is a 404;
//   * same-origin only: Sec-Fetch-Site (when sent) must be `same-origin` and Origin must be this site; JSON content type;
//     a 2 KB body cap (read here, before the 10 MB global parser);
//   * its own strict budget: 5 failures per 15 minutes per ACCOUNT and per IP CLASS (/24 for IPv4, /64 for IPv6), counted
//     BEFORE the attempt and given back on success, so parallel guesses cannot all slip through; the IP class is charged
//     first and an account key only after it; Redis when connected, this process otherwise (loginBudget.js); a locked
//     request gets 429 and never reaches the login handler. The ACCOUNT counter is the one every password sign-in shares:
//     the unmarked form is held to 10 failures on the same key (`accountBudget` below), the marked page to 5;
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
import {
  MAX_FAILURES, ACCOUNT_MAX_FAILURES, WINDOW_MS, ipClass, normalizeEmail, accountKey, createWindowCounter,
} from './loginBudget.js';

export { MAX_FAILURES, ACCOUNT_MAX_FAILURES, WINDOW_MS, ipClass, normalizeEmail, accountKey, createWindowCounter, loginLimiterKey, HIT_LUA, RELEASE_LUA } from './loginBudget.js';

export const ADMIN_LOGIN_PATH = '/admin/local-login';
export const ADMIN_LOGIN_SCRIPT = ADMIN_LOGIN_PATH + '.js';
export const ADMIN_LOGIN_API = '/api/auth/login';
export const ENTRY_HEADER = 'x-stories-entry';
export const ENTRY_VALUE = 'admin-local-login';
export const BODY_LIMIT = '2kb';
export const GENERIC = 'That did not work. Check the details and try again.';
export const LOCKED = 'Too many attempts. Try again later.';
export const UNAVAILABLE = 'Sign-in is not available right now. Try again later.';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_SRC = fs.readFileSync(path.join(here, 'adminLoginPage.client.js'), 'utf8');

/**
 * The page itself. Styles are inline (the CSP below allows them), the script is the file above. ORDNANCE tokens, no emoji.
 * The form is `hidden` and has no action: without the script it cannot be reached, and a submit of a form with
 * method="dialog" outside a <dialog> does nothing, so credentials can never be sent anywhere (not even as a GET query) if the
 * script fails to load. The script is what un-hides it. */
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
#msg[hidden],#f[hidden],#boot[hidden]{display:none}
</style>
</head>
<body>
<main>
<h1>Administrator sign-in</h1>
<p>This page is for Stories administrators only. Everyone else signs in with <a href="/auth/portal/login">SAI Cloud</a>.</p>
<p id="boot">This page needs JavaScript to sign in.</p>
<form id="f" method="dialog" autocomplete="on" hidden>
<div id="msg" role="alert" hidden></div>
<div class="field"><label class="lbl" for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
<div class="field"><label class="lbl" for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
<button id="go" type="submit">Sign in</button>
</form>
</main>
<script src="${ADMIN_LOGIN_SCRIPT}"></script>
</body>
</html>
`;
}

// Its own CSP (helmet's global one is overridden for this page): nothing but this origin, inline styles, no framing, no base.
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; "
  + "form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

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

  // disabled: the page and its script are simply not there; next() lets the app answer them as it answers ANY unknown path
  router.get(ADMIN_LOGIN_PATH, (req, res, next) => {
    if (!enabled()) return next();
    surfaceHeaders(res);
    res.type('html').send(renderPage());
  });
  router.get(ADMIN_LOGIN_SCRIPT, (req, res, next) => {
    if (!enabled()) return next();
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
      const email = normalizeEmail(b?.email);
      if (!email || email.length > 320 || typeof b.password !== 'string' || !b.password || b.password.length > 1024) return refuse(req, res, 400, 'body');

      // the budget is spent BEFORE the attempt and given back when it succeeds. The IP class is charged FIRST: a request that
      // is over it is refused without ever creating (or touching) an account key, so a flood of made-up addresses from one
      // class cannot push the real account's counter out of the table. The account counter is the one every password
      // sign-in shares (`accountBudget`), here held to the tighter limit.
      const cls = ipClass(req.ip);
      const i = await limits.hit('i:' + cls, { budget: maxFailures });
      if (i.n > maxFailures) return refuse(req, res, 429, 'ip_budget', LOCKED);
      const a = await limits.hit(accountKey(email), { budget: maxFailures, cls });
      if (a.n > maxFailures) return refuse(req, res, 429, 'account_budget', LOCKED);

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

  /**
   * The per-ACCOUNT failure budget for every password sign-in that did NOT come through the admin page (that one is charged by
   * `guard`, on the same key, with the tighter limit). Mounted on POST /api/auth/login after the body is parsed and after the
   * per-IP limiters. 10 failures per 15 minutes per normalised address, whatever the client address or X-Forwarded-For
   * says, so rotating addresses cannot multiply guesses at one account. The attempt is counted before it runs and given
   * back when it succeeds: a correct password never counts. A locked address gets 429 and the login handler never runs.
   * SAI Cloud sign-in does not pass through here (it is the primary path and has no password to guess).
   */
  async function accountBudget(req, res, next) {
    if (req.adminLocalLogin) return next();
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) return next();                   // nothing to charge; the handler answers 400
      const a = await limits.hit(accountKey(email), { budget: ACCOUNT_MAX_FAILURES, cls: ipClass(req.ip) });
      if (a.n > ACCOUNT_MAX_FAILURES) {
        res.set('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
        return res.status(429).json({ error: 'Too many login attempts, please try again later' });
      }
      res.on('finish', () => { if (res.statusCode >= 200 && res.statusCode < 300) a.release(); });
      return next();
    } catch (e) {
      log.error?.('[login-budget] account budget failed:', e && (e.code || e.name));
      return next();
    }
  }

  return {
    router, guard, accountBudget,
    /** An unknown address costs what a wrong password costs (the login handler calls this when the lookup finds nobody). */
    dummyCompare: (password) => bcrypt.compare(String(password || ''), dummyHash).catch(() => false),
  };
}
