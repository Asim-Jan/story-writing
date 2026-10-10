/*
 * VENDORED COPY - do not edit here. Re-copy with scripts/sync-auth-client.sh.
 *
 * What:     SAI Cloud sign-in client (OpenID Connect code flow + PKCE), zero dependencies.
 * Source:   Solutions-AI-LTD/sai-cluster  manifests/_auth-client/index.js
 * Commit:   d444325b301ae8aa8dac0f9381c1532a0bf77ff4
 * Licence:  proprietary, (c) Solutions AI Ltd - first-party code, vendored into another first-party repo under the same
 *           ownership. The source repo carries no separate licence file; this notice is the record.
 * Why:      the Stories image is built from its own repo and cannot import sai-cluster's manifests.
 */
//--- BEGIN VENDORED SOURCE: everything below this line is byte-identical to the original file ---
'use strict';
/*
 * _auth-client — sign in with SAI Cloud (OpenID Connect, authorization code + PKCE) for a first-party Node app.
 * Zero dependencies (node:crypto + the global fetch of Node 18+). Copy this one file into your app, or require it from
 * a deploy-time copy exactly like manifests/_suite. The provider is manifests/sai-portal/oidc.js (OIDC-DEPLOY.md).
 *
 *   const { createClient, createSession } = require('./auth-client');
 *   const auth = createClient({ issuer: 'https://solutionsai.co.uk', clientId: 'stories', clientSecret: process.env.OIDC_CLIENT_SECRET,
 *                               redirectUri: 'https://story-writing.solutionsai.co.uk/auth/portal/callback',
 *                               postLogoutRedirectUri: 'https://story-writing.solutionsai.co.uk/', cookieSecret: process.env.APP_COOKIE_SECRET });
 *   const sessions = createSession({ secret: process.env.APP_COOKIE_SECRET });       // your own short, host-only session
 *
 *   // GET /login          const { url, cookie } = await auth.authorizationUrl({ returnTo: '/library' });
 *   //                     res.setHeader('Set-Cookie', cookie); res.writeHead(302, { Location: url }); res.end();
 *   // GET /auth/portal/callback
 *   //                     const who = await auth.handleCallback(req);              // throws OidcError on ANY problem
 *   //                     res.setHeader('Set-Cookie', [who.clearCookie, sessions.issue({ sub: who.sub, name: who.name })]);   // key on sub; add who.email only if you must (it is verified, see below)
 *   //                     res.writeHead(302, { Location: who.returnTo || '/' }); res.end();
 *   // GET /logout         res.setHeader('Set-Cookie', sessions.clear());
 *   //                     res.writeHead(302, { Location: await auth.logoutUrl({ idTokenHint }) }); res.end();
 *
 * WHAT IT CHECKS, so the app does not have to remember to:
 *   · discovery: `issuer` is byte-for-byte the configured one and every endpoint is https on that same origin;
 *   · the callback: a signed, short-lived, host-only `__Host-` cookie set at the start holds state + nonce + the PKCE
 *     verifier; `state` must match it, the `iss` PARAMETER must be present and equal the issuer (RFC 9207, the
 *     mix-up defence), and a callback can be used once;
 *   · the code exchange: confidential client (client_secret_basic), PKCE, redirects are never followed;
 *   · the ID token: alg PINNED to ES256 (none / HS* / RS* refused before any key is looked at), signature against the
 *     issuer's JWKS (cached, refreshed once on an unknown kid, never more often than jwksMinRefreshS), then iss, aud
 *     (and azp), exp, iat, nonce, sub, and auth_time when you asked for max_age.
 *   · the email: if you asked for the `email` scope the callback REJECTS an address the portal has not verified
 *     (OidcError `email_unverified`) unless you pass requireVerifiedEmail: false. `emailVerified` is always returned. Key your
 *     data on `sub`, never on the email.
 * WHAT IT DOES NOT DO: refresh tokens (the provider issues none: your own session ends, you redirect again, and with a
 * live portal session that is silent); back-channel logout (phase 4); storing anything server-side.
 */
const crypto = require('crypto');

class OidcError extends Error {
  constructor(code, message, extra) { super(message); this.name = 'OidcError'; this.code = code; Object.assign(this, extra || {}); }
}

const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = d => crypto.createHash('sha256').update(d).digest();
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const B64U = /^[A-Za-z0-9_-]+$/;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 1) continue;
    const k = part.slice(0, i).trim(); if (!(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}
function setCookie(name, value, maxAgeS) {
  if (!/^__Host-[A-Za-z0-9_.-]+$/.test(name)) throw new OidcError('config', 'cookie names must start with __Host-');
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeS))}`;
}
/* an HMAC-signed blob: base64url(json).base64url(hmac("<label>." + that part)). `label` separates uses of one secret, so a
 * sign-in cookie can never be presented as a session (or the reverse). */
function seal(secret, label, obj) {
  const p = b64u(JSON.stringify(obj));
  return p + '.' + b64u(crypto.createHmac('sha256', secret).update(label + '.' + p).digest());
}
function unseal(secret, label, token) {
  const t = String(token || '');
  const i = t.indexOf('.');
  if (i < 1 || t.indexOf('.', i + 1) !== -1) return null;
  const p = t.slice(0, i), m = t.slice(i + 1);
  if (!B64U.test(p) || !B64U.test(m)) return null;
  if (!eq(m, b64u(crypto.createHmac('sha256', secret).update(label + '.' + p).digest()))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}
function needSecret(secret) {
  const s = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''));
  if (s.length < 32) throw new OidcError('config', 'the cookie secret must be at least 32 bytes of random data');
  return s;
}
const httpsUrl = (u, what) => {
  let x; try { x = new URL(u); } catch { throw new OidcError('config', `${what} is not a URL`); }
  if (x.protocol !== 'https:' || x.hash || x.username || x.password) throw new OidcError('config', `${what} must be an https URL with no fragment or credentials`);
  return x;
};

/* the event URIs the portal sends, by the short name this library returns */
const EVENT_URIS = {
  'https://schemas.solutionsai.co.uk/event/account-deleted': 'account-deleted',
  'https://schemas.solutionsai.co.uk/event/account-disabled': 'account-disabled',
  'https://schemas.solutionsai.co.uk/event/account-enabled': 'account-enabled',
  'http://schemas.openid.net/event/backchannel-logout': 'backchannel-logout',
};
const EVT_RE = /^evt_[a-f0-9]{24}$/;

/* Replay guard for event tokens: remembers each jti for ttlS (default 24 h, longer than a token can live), bounded in size.
 * seen(jti) returns true if it was already used, otherwise records it and returns false. In memory; export() / load() let an
 * app persist it with its event log so a restart does not forget. */
function createJtiSet({ ttlS = 86400, max = 50000, now = Date.now } = {}) {
  const m = new Map();
  const prune = () => { const t = now(); for (const [k, e] of m) if (e <= t) m.delete(k); while (m.size > max) m.delete(m.keys().next().value); };
  return {
    seen(jti) { prune(); if (m.has(jti)) return true; m.set(jti, now() + ttlS * 1000); prune(); return false; },
    export() { prune(); return [...m.entries()]; },
    load(entries) { for (const [k, e] of Array.isArray(entries) ? entries : []) if (typeof k === 'string' && Number.isFinite(e)) m.set(k, e); prune(); },
    size: () => m.size,
  };
}

/* ═══ a tiny signed session cookie for the app's OWN session ═══════════════════════════════════════════ */
function createSession({ secret, cookieName = '__Host-sai_sess', ttlS = 12 * 3600, now = Date.now } = {}) {
  const key = needSecret(secret);
  if (!/^__Host-/.test(cookieName)) throw new OidcError('config', 'the session cookie name must start with __Host-');
  return {
    cookieName,
    /* → a Set-Cookie value. `data` is small, JSON, and READABLE by the browser's owner (it is signed, not encrypted): put
     * an id, an email and a name in it, never a secret. */
    issue(data, { ttlS: t = ttlS } = {}) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new OidcError('config', 'session data must be an object');
      const iat = Math.floor(now() / 1000);
      const v = seal(key, 'sess', { d: data, iat, exp: iat + t });
      if (v.length > 3800) throw new OidcError('config', 'session data is too large for a cookie');
      return setCookie(cookieName, v, t);
    },
    /* → the data, or null (no cookie, bad signature, expired, wrong purpose). `req` = anything with headers.cookie. */
    read(req, { meta = false } = {}) {
      const o = unseal(key, 'sess', parseCookies(req && req.headers && req.headers.cookie)[cookieName]);
      if (!o || typeof o.exp !== 'number' || o.exp * 1000 <= now() || !o.d || typeof o.d !== 'object') return null;
      // meta: { data, iat, exp } (seconds). `iat` lets an app reject "sessions older than X", e.g. an account the portal
      // later disabled or signed out everywhere: the session cookie itself carries no revocation, this is how you check it.
      return meta ? { data: o.d, iat: typeof o.iat === 'number' ? o.iat : null, exp: o.exp } : o.d;
    },
    clear() { return setCookie(cookieName, '', 0); },
  };
}

/* ═══ the OIDC client ═════════════════════════════════════════════════════════════════════════════════════ */
function createClient(opts = {}) {
  const issuer = String(opts.issuer || '');
  const iu = httpsUrl(issuer, 'issuer');
  if (iu.origin !== issuer) throw new OidcError('config', 'issuer must be an origin with no path and no trailing slash (e.g. https://solutionsai.co.uk)');
  // a secret read from a file or a mounted Secret usually ends in a newline (oidc-tool.js writes one); the portal hashed the bare secret, so a trailing newline would be
  // invalid_client on every sign-in. Only trailing line breaks are removed.
  const clientId = String(opts.clientId || ''), clientSecret = String(opts.clientSecret || '').replace(/[\r\n]+$/, '');
  if (!clientId || !clientSecret) throw new OidcError('config', 'clientId and clientSecret are required');
  const redirectUri = String(opts.redirectUri || '');
  httpsUrl(redirectUri, 'redirectUri');
  const key = needSecret(opts.cookieSecret);
  const scope = String(opts.scope || 'openid profile email');
  if (!scope.split(' ').includes('openid')) throw new OidcError('config', 'scope must include openid');
  const doFetch = opts.fetch || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new OidcError('config', 'no fetch available (Node 18+ or pass opts.fetch)');
  const now = opts.now || Date.now;
  const skew = opts.clockSkewS == null ? 60 : opts.clockSkewS;
  const txName = opts.txCookieName || '__Host-sai_oidc_tx';
  const txTtl = opts.txTtlS || 600;
  const discoveryTtl = (opts.discoveryTtlS || 3600) * 1000, jwksTtl = (opts.jwksTtlS || 600) * 1000, jwksMin = (opts.jwksMinRefreshS == null ? 30 : opts.jwksMinRefreshS) * 1000;
  const maxIdAge = opts.maxIdTokenAgeS || 600;
  const remember = opts.rememberCallbacks !== false;
  // asking for the email claim means you intend to USE it: an address the portal has not verified is then refused at the callback
  const wantsEmail = scope.split(' ').includes('email');
  const requireVerifiedEmail = opts.requireVerifiedEmail == null ? wantsEmail : !!opts.requireVerifiedEmail;
  const timeout = opts.timeoutMs || 10000;

  /* ── network, bounded ───────────────────────────────────────────────────────────────────────── */
  async function call(url, init, what) {
    let res, text;
    try {
      res = await doFetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      text = await res.text();
    } catch (e) { throw new OidcError(what, `${what}: the portal could not be reached`); }
    if (text.length > 262144) throw new OidcError(what, `${what}: the answer was too large`);
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  }

  /* ── discovery (cached) ─────────────────────────────────────────────────────────────────────── */
  let disc = null, discAt = 0, discFlight = null;
  async function discover() {
    if (disc && now() - discAt < discoveryTtl) return disc;
    if (!discFlight) discFlight = (async () => {
      const r = await call(issuer + '/.well-known/openid-configuration', { method: 'GET', headers: { accept: 'application/json' } }, 'discovery');
      const d = r.json;
      if (r.status !== 200 || !d || typeof d !== 'object') throw new OidcError('discovery', 'discovery: the portal did not return a configuration');
      if (d.issuer !== issuer) throw new OidcError('discovery', 'discovery: the document names a different issuer');
      for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        let u; try { u = new URL(d[k]); } catch { throw new OidcError('discovery', `discovery: ${k} is missing`); }
        if (u.protocol !== 'https:' || u.origin !== issuer) throw new OidcError('discovery', `discovery: ${k} is not on the issuer's origin`);
      }
      for (const k of ['userinfo_endpoint', 'end_session_endpoint']) if (d[k] != null) { let u; try { u = new URL(d[k]); } catch { u = null; } if (!u || u.protocol !== 'https:' || u.origin !== issuer) throw new OidcError('discovery', `discovery: ${k} is not on the issuer's origin`); }
      if (Array.isArray(d.id_token_signing_alg_values_supported) && !d.id_token_signing_alg_values_supported.includes('ES256')) throw new OidcError('discovery', 'discovery: the portal does not sign with ES256');
      if (Array.isArray(d.code_challenge_methods_supported) && !d.code_challenge_methods_supported.includes('S256')) throw new OidcError('discovery', 'discovery: the portal does not support PKCE S256');
      disc = d; discAt = now(); return d;
    })().finally(() => { discFlight = null; });
    return discFlight;
  }

  /* ── JWKS (cached, refreshed once on an unknown kid, never more often than jwksMin) ───────────── */
  let keys = new Map(), keysAt = 0, keysTried = 0, keysFlight = null;
  async function loadKeys() {
    if (!keysFlight) keysFlight = (async () => {
      const d = await discover();
      keysTried = now();
      const r = await call(d.jwks_uri, { method: 'GET', headers: { accept: 'application/json' } }, 'jwks');
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.keys)) throw new OidcError('jwks', 'jwks: the portal did not return a key set');
      const m = new Map();
      for (const j of r.json.keys) {
        if (!j || j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.kid !== 'string' || (j.use && j.use !== 'sig') || (j.alg && j.alg !== 'ES256')) continue;
        try { m.set(j.kid, crypto.createPublicKey({ key: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, format: 'jwk' })); } catch { /* skip a malformed key */ }
      }
      keys = m; keysAt = now();
    })().finally(() => { keysFlight = null; });
    return keysFlight;
  }
  async function keyFor(kid) {
    if (!keys.size || now() - keysAt > jwksTtl) { try { await loadKeys(); } catch (e) { if (!keys.size) throw e; } }
    if (keys.has(kid)) return keys.get(kid);
    if (now() - keysTried >= jwksMin) await loadKeys();                // an unknown kid: the portal may have rotated
    return keys.get(kid) || null;
  }

  /* ── the ID token ─────────────────────────────────────────────────────────────────────────────── */
  const bad = reason => new OidcError('bad_id_token', 'the ID token was not accepted (' + reason + ')', { reason });
  async function verifyIdToken(token, { nonce, maxAge } = {}) {
    if (typeof token !== 'string' || token.length > 8192) throw bad('shape');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(p => p && B64U.test(p))) throw bad('shape');
    let header, claims;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw bad('header'); }
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw bad('header');
    if (header.alg !== 'ES256') throw bad('alg');                     // pinned: none, HS*, RS*, PS*, ES384... are all refused here
    if ('crit' in header) throw bad('crit');
    if (typeof header.kid !== 'string' || !header.kid) throw bad('kid');
    const pub = await keyFor(header.kid);
    if (!pub) throw bad('kid');
    const sig = Buffer.from(parts[2], 'base64url');
    if (sig.length !== 64 || !crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key: pub, dsaEncoding: 'ieee-p1363' }, sig)) throw bad('sig');
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw bad('claims'); }
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw bad('claims');
    const t = Math.floor(now() / 1000);
    if (claims.iss !== issuer) throw bad('iss');
    const aud = claims.aud;
    if (typeof aud === 'string') { if (aud !== clientId) throw bad('aud'); }
    else if (Array.isArray(aud) && aud.includes(clientId)) { if (aud.length > 1 && claims.azp !== clientId) throw bad('aud'); }
    else throw bad('aud');
    if (claims.azp != null && claims.azp !== clientId) throw bad('aud');
    if (typeof claims.exp !== 'number' || claims.exp + skew <= t) throw bad('exp');
    if (typeof claims.iat !== 'number' || claims.iat > t + skew || t - claims.iat > maxIdAge + skew) throw bad('iat');
    if (claims.nbf != null && (typeof claims.nbf !== 'number' || claims.nbf > t + skew)) throw bad('nbf');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw bad('sub');
    if (nonce != null && (typeof claims.nonce !== 'string' || !eq(claims.nonce, nonce))) throw bad('nonce');
    if (maxAge != null && (typeof claims.auth_time !== 'number' || t - claims.auth_time > maxAge + skew)) throw bad('auth_time');
    return claims;
  }

  /* ── identity events from the portal (account-deleted / disabled / enabled / backchannel-logout) ─────────────────────────
   * The portal POSTs a Security Event Token to your /auth/events (and lists the same tokens at GET /api/apps/events for an
   * app that was down). verifyEvent() is the whole check: ES256 pinned, typ must be secevent+jwt, the signature against the
   * portal's JWKS, iss, aud = THIS client (a string, exactly), iat within maxAgeS (default 300) and exp in the future, a jti,
   * a sub, and at least one event URI this library knows. It does not trust anything else in the body.
   * → { jti, sub, iat, events: { 'account-deleted': { evt, at, erase }, ... } }  or throws OidcError('bad_event', ..., { reason }).
   * What YOU must do (CUSTOMER-APPS-PLAN.md section 2): answer 202 only after the event is on disk (append + fsync), dedupe on
   * `evt` (forever for deletions), refuse a replayed `jti` (createJtiSet below), and before ERASING anything re-check the sub with
   * POST /api/apps/subjects/check. Reject a request that carries X-Forwarded-For: this endpoint is in-cluster only. */
  const badEvent = reason => new OidcError('bad_event', 'the event was not accepted (' + reason + ')', { reason });
  async function verifyEvent(token, { maxAgeS = 300 } = {}) {
    if (typeof token !== 'string' || token.length > 8192) throw badEvent('shape');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(p => p && B64U.test(p))) throw badEvent('shape');
    let header, claims;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw badEvent('header'); }
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw badEvent('header');
    if (header.alg !== 'ES256') throw badEvent('alg');
    if (header.typ !== 'secevent+jwt') throw badEvent('typ');          // an ID token (typ JWT) must never be accepted as an event
    if ('crit' in header) throw badEvent('crit');
    if (typeof header.kid !== 'string' || !header.kid) throw badEvent('kid');
    let pub; try { pub = await keyFor(header.kid); } catch { throw new OidcError('jwks', 'the portal key set could not be fetched, try again later'); }
    if (!pub) throw badEvent('kid');
    const sig = Buffer.from(parts[2], 'base64url');
    if (sig.length !== 64 || !crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key: pub, dsaEncoding: 'ieee-p1363' }, sig)) throw badEvent('sig');
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw badEvent('claims'); }
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw badEvent('claims');
    const t = Math.floor(now() / 1000);
    if (claims.iss !== issuer) throw badEvent('iss');
    if (claims.aud !== clientId) throw badEvent('aud');                 // a string, exactly this client: an event for another app is not ours
    if (typeof claims.exp !== 'number' || claims.exp + skew <= t) throw badEvent('exp');
    if (typeof claims.iat !== 'number' || claims.iat > t + skew || t - claims.iat > maxAgeS + skew) throw badEvent('iat');
    if (typeof claims.jti !== 'string' || !claims.jti || claims.jti.length > 128) throw badEvent('jti');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw badEvent('sub');
    if (!claims.events || typeof claims.events !== 'object' || Array.isArray(claims.events)) throw badEvent('events');
    const events = {};
    for (const [uri, body] of Object.entries(claims.events)) {
      const name = EVENT_URIS[uri];
      if (!name) continue;                                              // an event we do not know is ignored, not obeyed
      if (!body || typeof body !== 'object' || Array.isArray(body) || !EVT_RE.test(String(body.evt || ''))) throw badEvent('event body');
      events[name] = body;
    }
    if (!Object.keys(events).length) throw badEvent('no known event');
    return { jti: claims.jti, sub: claims.sub, iat: claims.iat, events };
  }

  /* ── the redirect out ─────────────────────────────────────────────────────────────────────────── */
  async function authorizationUrl({ returnTo, prompt, maxAge, loginHint } = {}) {
    const d = await discover();
    const verifier = b64u(crypto.randomBytes(32)), state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24));
    if (returnTo != null && !(typeof returnTo === 'string' && /^\/(?![/\\])[\x21-\x7e]{0,512}$/.test(returnTo))) throw new OidcError('config', 'returnTo must be a path on this site (starting with a single "/")');
    const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state, nonce,
      code_challenge: b64u(sha256(verifier)), code_challenge_method: 'S256' });
    if (prompt) p.set('prompt', String(prompt));
    if (maxAge != null) p.set('max_age', String(Math.max(0, Math.floor(maxAge))));
    if (loginHint) p.set('login_hint', String(loginHint));
    const iat = Math.floor(now() / 1000);
    const tx = { s: state, n: nonce, v: verifier, iat, exp: iat + txTtl, ...(returnTo ? { r: returnTo } : {}), ...(maxAge != null ? { m: Math.max(0, Math.floor(maxAge)) } : {}) };
    return { url: d.authorization_endpoint + '?' + p.toString(), cookie: setCookie(txName, seal(key, 'tx', tx), txTtl), state };
  }

  /* ── the redirect back ────────────────────────────────────────────────────────────────────────── */
  const used = new Map();                                              // state hash -> expiry: a callback is accepted once per process
  function remembered(h, exp) {
    const t = now();
    for (const [k, e] of used) if (e <= t) used.delete(k);
    if (used.has(h)) return true;
    if (used.size > 20000) used.delete(used.keys().next().value);
    used.set(h, exp); return false;
  }
  async function handleCallback(req) {
    let url;
    try { url = new URL(String((req && req.url) || ''), 'https://app.invalid'); } catch { throw new OidcError('tx_invalid', 'the callback URL is not valid'); }
    const q = url.searchParams;
    for (const k of new Set(q.keys())) if (q.getAll(k).length > 1) throw new OidcError('tx_invalid', 'a callback parameter was repeated');
    const clearCookie = setCookie(txName, '', 0);
    const raw = parseCookies(req && req.headers && req.headers.cookie)[txName];
    if (!raw) throw new OidcError('tx_missing', 'the sign-in was not started in this browser (cookie missing) - start again', { clearCookie });
    const tx = unseal(key, 'tx', raw);
    if (!tx || typeof tx.s !== 'string' || typeof tx.n !== 'string' || typeof tx.v !== 'string') throw new OidcError('tx_invalid', 'the sign-in cookie is not valid - start again', { clearCookie });
    if (typeof tx.exp !== 'number' || tx.exp * 1000 <= now()) throw new OidcError('tx_expired', 'the sign-in took too long - start again', { clearCookie });
    const state = q.get('state');
    if (!state || !eq(state, tx.s)) throw new OidcError('state_mismatch', 'the state did not match - start again', { clearCookie });
    // the RFC 9207 mix-up defence: the answer must say who it came from, and it must be the portal
    const iss = q.get('iss');
    if (iss == null || iss !== issuer) throw new OidcError('issuer_mismatch', 'the answer did not come from the expected issuer', { clearCookie });
    if (q.has('error')) throw new OidcError('provider_error', 'the portal refused the sign-in', { providerError: String(q.get('error')).slice(0, 64), clearCookie });
    const code = q.get('code');
    if (!code || code.length > 512) throw new OidcError('tx_invalid', 'the callback carried no code', { clearCookie });
    if (remember && remembered(b64u(sha256(tx.s)), tx.exp * 1000)) throw new OidcError('replayed', 'this sign-in was already completed', { clearCookie });

    const d = await discover();
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: tx.v });
    const r = await call(d.token_endpoint, { method: 'POST', body: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'cache-control': 'no-store',
        authorization: 'Basic ' + Buffer.from(encodeURIComponent(clientId) + ':' + encodeURIComponent(clientSecret)).toString('base64') } }, 'token');
    if (r.status !== 200 || !r.json || typeof r.json.id_token !== 'string') {
      const e = r.json && typeof r.json.error === 'string' ? r.json.error.slice(0, 64) : null;
      throw new OidcError('token_exchange', 'the portal did not accept the code', { providerError: e, status: r.status, clearCookie });
    }
    if (String(r.json.token_type || '').toLowerCase() !== 'bearer') throw new OidcError('token_exchange', 'unexpected token type', { clearCookie });
    let claims;
    try { claims = await verifyIdToken(r.json.id_token, { nonce: tx.n, maxAge: tx.m }); }
    catch (e) { e.clearCookie = clearCookie; throw e; }
    const emailVerified = claims.email_verified === true;
    if (requireVerifiedEmail && wantsEmail && (typeof claims.email !== 'string' || !emailVerified))
      throw new OidcError('email_unverified', 'the portal has not verified this account\'s email address', { clearCookie });
    return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified, emailVerified,
      verifiedEmail: emailVerified && typeof claims.email === 'string' ? claims.email : null,       // the address only when it is proven; null otherwise
      name: claims.name, amr: claims.amr, acr: claims.acr,
      auth_time: claims.auth_time, sid: claims.sid, claims, idToken: r.json.id_token, accessToken: r.json.access_token, scope: r.json.scope,
      returnTo: tx.r || null, clearCookie };
  }

  /* ── logout ───────────────────────────────────────────────────────────────────────────────────── */
  async function logoutUrl({ idTokenHint, state, postLogoutRedirectUri } = {}) {
    const d = await discover();
    if (!d.end_session_endpoint) throw new OidcError('discovery', 'the portal has no end_session_endpoint');
    const p = new URLSearchParams({ client_id: clientId });
    if (idTokenHint) p.set('id_token_hint', String(idTokenHint));
    const back = postLogoutRedirectUri || opts.postLogoutRedirectUri;
    if (back) { p.set('post_logout_redirect_uri', back); if (state) p.set('state', String(state)); }
    return d.end_session_endpoint + '?' + p.toString();
  }

  return { issuer, clientId, discover, authorizationUrl, handleCallback, verifyIdToken, verifyEvent, logoutUrl, txCookieName: txName };
}

module.exports = { createClient, createSession, createJtiSet, OidcError, parseCookies, EVENT_URIS };
