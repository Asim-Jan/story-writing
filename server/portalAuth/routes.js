// Sign in with SAI Cloud: the routes. Mounted by server/index.js; every one of them is inert unless PORTAL_OIDC=1.
//
//   GET  /auth/portal/login              start the flow (state, nonce and the PKCE verifier ride the library's signed,
//                                        host-only __Host- cookie), 302 to the portal
//   GET  /auth/portal/callback           the library verifies everything (state, iss, ID token, nonce, verified email),
//                                        then accounts.js decides WHICH Stories user this is, then the SAME app JWT the
//                                        password login issues is set as the `token` cookie, 302 to /auth/portal/done
//   POST /auth/portal/logout             clears the Stories session; {everywhere:true} also returns the portal's end_session URL
//   GET  /api/auth/portal/config         what the login page may know ({enabled, only, signupsClosed}); answers when OFF too
//   POST /api/auth/portal/session        hands the freshly issued JWT to the SPA once (see below)
//   GET  /api/auth/portal/link/status    is there an account-linking step pending in this browser?
//   POST /api/auth/portal/link           the old Stories password, once, to link an UNVERIFIED Stories account
//
// SPA pages (served by the existing fallback): /auth/portal/done, /auth/portal/link, /auth/portal/error.
import crypto from 'crypto';
import { createRequire } from 'module';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { OUTCOME, resolveAccount, linkWithPassword } from './accounts.js';
import { publicPortalConfig } from './config.js';

const require = createRequire(import.meta.url);
const { createClient, OidcError } = require('../vendor/sai-auth-client/index.cjs');

const TOKEN_COOKIE = 'token';                         // the cookie authenticateToken already reads
const IDT_COOKIE = 'portal_idt';                      // the ID token, only to hint the portal's end_session; sent to /auth/portal/* only
const LINK_COOKIE = '__Host-stories_portal_link';     // the pending account-linking step, signed, 10 minutes
const LINK_TTL_S = 600;
const HANDOFF_WINDOW_S = 120;                         // /api/auth/portal/session works for 2 minutes after the callback
export const RETURN_TO_RE = /^\/(?![/\\])[\x21-\x7e]{0,512}$/;

// shown, uniform, for every way the password step can fail
const BAD_PASSWORD = { error: 'That did not work. Check your Stories password and try again.', code: 'bad_password' };

const errorCodeFor = (e) => {
  if (!(e instanceof OidcError)) return 'failed';
  switch (e.code) {
    case 'email_unverified': return 'email_unverified';
    case 'provider_error': return e.providerError === 'access_denied' ? 'access_denied' : 'failed';
    case 'tx_missing': case 'tx_invalid': case 'tx_expired': case 'state_mismatch': case 'replayed': return 'expired';
    case 'discovery': case 'jwks': return 'unavailable';
    default: return 'failed';
  }
};

export function createPortalAuth({ cfg, store, jwtSecret, audit = async () => {}, log = console, fetch: fetchImpl, now = Date.now }) {
  const router = express.Router();
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const dummyHash = bcrypt.hashSync('not-a-password-' + crypto.randomBytes(8).toString('hex'), 10);

  router.get('/api/auth/portal/config', (req, res) => { noStore(res); res.json(publicPortalConfig(cfg)); });

  let client = null;
  if (cfg.enabled) {
    try {
      client = createClient({
        issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri,
        postLogoutRedirectUri: cfg.postLogoutRedirectUri, cookieSecret: cfg.cookieSecret,
        ...(fetchImpl ? { fetch: fetchImpl } : {}), now,
      });
    } catch (e) {
      cfg.enabled = false; cfg.only = false; cfg.reason = 'client config: ' + (e.message || e.code);
      log.error('[portal-auth] SAI Cloud sign-in is DISABLED -', cfg.reason);
    }
  }

  if (!client) {
    // OFF: answer 404 ourselves, or the SPA fallback would hand these paths index.html with a 200
    router.all(['/auth/portal/login', '/auth/portal/callback'], (req, res) => res.status(404).json({ error: 'Not found' }));
    // ...except sign-out: a browser that signed in while the feature was on must still be able to drop its cookies after it is turned off
    router.post('/auth/portal/logout', (req, res) => {
      noStore(res);
      res.clearCookie(TOKEN_COOKIE);
      res.clearCookie(IDT_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/portal' });
      res.json({ ok: true, redirect: null });
    });
    return finish(router, cfg);
  }

  // The link cookie and the JWT use different keys: HMAC-derived from the session secret per purpose.
  const linkKey = crypto.createHmac('sha256', cfg.cookieSecret).update('stories-portal-link').digest();
  const sealLink = (p) => jwt.sign(p, linkKey, { algorithm: 'HS256', expiresIn: LINK_TTL_S, issuer: 'stories-portal-link' });
  const readLink = (req) => {
    const raw = req.cookies?.[LINK_COOKIE];
    if (!raw) return null;
    try {
      const p = jwt.verify(raw, linkKey, { algorithms: ['HS256'], issuer: 'stories-portal-link' });
      return p && typeof p.uid === 'string' && typeof p.sub === 'string' ? p : null;
    } catch { return null; }
  };
  const linkCookieOpts = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
  const idtCookieOpts = { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/portal' };

  const userJson = (u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role || 'user', tier: u.tier || 'free', status: u.status || 'active',
    emailVerified: !!(u.email_verified ?? u.emailVerified), books: [], portalLinked: true,
  });

  // The SAME JWT the password login issues (so every existing route and the SPA keep working), 24 h not 7 d.
  function startSession(res, user, idToken) {
    const token = jwt.sign(
      { userId: user.id, email: user.email, tokenVersion: user.token_version ?? user.tokenVersion ?? 1, via: 'portal' },
      jwtSecret, { expiresIn: cfg.sessionTtlS });
    res.cookie(TOKEN_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: cfg.sessionTtlS * 1000 });
    if (idToken) res.cookie(IDT_COOKIE, idToken, { ...idtCookieOpts, maxAge: cfg.sessionTtlS * 1000 });
    res.clearCookie(LINK_COOKIE, linkCookieOpts);
    return token;
  }

  const toError = (res, code) => { noStore(res); res.redirect(302, '/auth/portal/error?code=' + encodeURIComponent(code)); };
  const done = (res, returnTo) => {
    noStore(res);
    res.redirect(302, '/auth/portal/done' + (returnTo && RETURN_TO_RE.test(returnTo) ? '?returnTo=' + encodeURIComponent(returnTo) : ''));
  };

  const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    message: 'Too many sign-in attempts, please try again later', keyGenerator: (req) => `portal:${req.ip}` });
  // The password step: 5 FAILED tries per account per 15 min whoever asks, and 20 tries per IP.
  const linkAcctLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
    message: { ...BAD_PASSWORD, error: 'Too many attempts. Please wait a few minutes and try again.', code: 'rate_limited' },
    keyGenerator: (req) => `portal-link:${readLink(req)?.uid || 'none'}:${readLink(req) ? '' : req.ip}` });
  const linkIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { ...BAD_PASSWORD, error: 'Too many attempts. Please wait a few minutes and try again.', code: 'rate_limited' },
    keyGenerator: (req) => `portal-link-ip:${req.ip}` });

  router.get('/auth/portal/login', ipLimiter, async (req, res) => {
    const rt = typeof req.query.returnTo === 'string' && RETURN_TO_RE.test(req.query.returnTo) ? req.query.returnTo : undefined;
    try {
      const { url, cookie } = await client.authorizationUrl({
        returnTo: rt, prompt: req.query.different === '1' ? 'login' : undefined });
      noStore(res);
      res.append('Set-Cookie', cookie);
      res.redirect(302, url);
    } catch (e) {
      log.error('[portal-auth] could not start the sign-in:', e.code || e.message);
      toError(res, 'unavailable');
    }
  });

  router.get('/auth/portal/callback', ipLimiter, async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    let who;
    try {
      who = await client.handleCallback({ url: req.originalUrl, headers: req.headers });
    } catch (e) {
      if (e && e.clearCookie) res.append('Set-Cookie', e.clearCookie);
      log.warn(`[portal-auth] callback refused: ${e.code || 'error'}${e.reason ? ':' + e.reason : ''}${e.providerError ? ' (' + e.providerError + ')' : ''}`);
      return toError(res, errorCodeFor(e));
    }
    res.append('Set-Cookie', who.clearCookie);

    let outcome;
    try {
      outcome = await resolveAccount(store, who, { signupsOpen: !cfg.signupsClosed });
    } catch (e) {
      log.error('[portal-auth] account resolution failed:', e.message);
      return toError(res, 'unavailable');
    }

    switch (outcome.kind) {
      case OUTCOME.SIGNED_IN: {
        startSession(res, outcome.user, who.idToken);
        await audit(outcome.user.email, outcome.user.id, true, outcome.created ? 'portal_signup' : outcome.linked ? 'portal_link_auto' : 'portal_login', req);
        return done(res, who.returnTo);
      }
      case OUTCOME.NEEDS_PASSWORD: {
        const p = outcome.pending;
        res.cookie(LINK_COOKIE, sealLink({ uid: p.userId, sub: p.sub, email: p.email, idt: who.idToken, rt: who.returnTo || undefined }),
          { ...linkCookieOpts, maxAge: LINK_TTL_S * 1000 });
        await audit(p.email, p.userId, false, 'portal_link_needs_password', req);
        noStore(res);
        return res.redirect(302, '/auth/portal/link');
      }
      case OUTCOME.SIGNUPS_CLOSED: await audit(who.verifiedEmail, null, false, 'portal_signups_closed', req); return toError(res, 'signups_closed');
      case OUTCOME.LINKED_ELSEWHERE: await audit(who.verifiedEmail, null, false, 'portal_linked_elsewhere', req); return toError(res, 'linked_elsewhere');
      case OUTCOME.BLOCKED: await audit(who.verifiedEmail, outcome.user?.id || null, false, 'portal_account_' + (outcome.user?.status || 'blocked'), req); return toError(res, 'suspended');
      case OUTCOME.EMAIL_UNVERIFIED: return toError(res, 'email_unverified');
      default: return toError(res, 'unavailable');
    }
  });

  // The cookie is HttpOnly, but the SPA still keeps its token in localStorage (dozens of components read it), so right after
  // the callback it asks for it ONCE. Only a portal session, and only in the first two minutes after it was issued.
  router.post('/api/auth/portal/session', async (req, res) => {
    noStore(res);
    const raw = req.cookies?.[TOKEN_COOKIE];
    try {
      const d = jwt.verify(raw || '', jwtSecret);
      const t = Math.floor(now() / 1000);
      if (d.via !== 'portal' || typeof d.iat !== 'number' || t - d.iat > HANDOFF_WINDOW_S) throw new Error('not fresh');
      const user = await store.findById(d.userId);
      if (!user || user.status === 'suspended' || user.status === 'banned' || (d.tokenVersion !== undefined && d.tokenVersion !== (user.token_version ?? 1))) throw new Error('gone');
      return res.json({ user: userJson(user), token: raw });
    } catch {
      return res.status(401).json({ error: 'Sign in again', code: 'expired' });
    }
  });

  router.get('/api/auth/portal/link/status', (req, res) => {
    noStore(res);
    const p = readLink(req);
    res.json(p ? { pending: true, email: p.email } : { pending: false });
  });

  router.post('/api/auth/portal/link', linkIpLimiter, linkAcctLimiter, async (req, res) => {
    noStore(res);
    const p = readLink(req);
    if (!p) return res.status(400).json({ error: 'This step has expired. Please sign in with SAI Cloud again.', code: 'expired' });
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    try {
      const r = await linkWithPassword(store, { userId: p.uid, sub: p.sub }, password, { compare: bcrypt.compare, dummyHash });
      if (r.kind === 'bad_password') {
        await audit(p.email, p.uid, false, 'portal_link_bad_password', req);
        return res.status(401).json(BAD_PASSWORD);
      }
      if (r.kind === OUTCOME.BLOCKED) return res.status(403).json({ error: 'This account is not available.', code: 'suspended' });
      if (r.kind === OUTCOME.LINKED_ELSEWHERE) return res.status(409).json({ error: 'This Stories account is already linked to a different SAI Cloud account.', code: 'linked_elsewhere' });
      const token = startSession(res, r.user, p.idt);
      await audit(r.user.email, r.user.id, true, r.linked ? 'portal_link_password' : 'portal_login', req);
      return res.json({ user: userJson(r.user), token, returnTo: p.rt && RETURN_TO_RE.test(p.rt) ? p.rt : null });
    } catch (e) {
      log.error('[portal-auth] linking failed:', e.message);
      return res.status(500).json({ error: 'Linking failed. Please try again.', code: 'unavailable' });
    }
  });

  router.post('/auth/portal/logout', async (req, res) => {
    noStore(res);
    const hint = req.cookies?.[IDT_COOKIE];
    res.clearCookie(TOKEN_COOKIE);
    res.clearCookie(IDT_COOKIE, idtCookieOpts);
    res.clearCookie(LINK_COOKIE, linkCookieOpts);
    let redirect = null;
    if (req.body && req.body.everywhere === true) {
      try { redirect = await client.logoutUrl({ idTokenHint: hint || undefined }); }
      catch (e) { log.warn('[portal-auth] no end_session URL:', e.code || e.message); }
    }
    res.json({ ok: true, redirect });
  });

  return finish(router, cfg);
}

// What index.js needs besides the router.
function finish(router, cfg) {
  return {
    router,
    config: cfg,
    /** PORTAL_ONLY: the password routes answer 403 (existing sessions keep working until they expire). */
    blockPasswordAuth(req, res, next) {
      if (!cfg.only) return next();
      return res.status(403).json({ error: 'Email and password sign-in is turned off. Sign in with SAI Cloud.', code: 'PORTAL_ONLY' });
    },
    /** SIGNUPS_CLOSED: new accounts (local) answer 403. */
    blockSignups(req, res, next) {
      if (!cfg.signupsClosed) return next();
      return res.status(403).json({ error: 'New accounts are closed at the moment.', code: 'SIGNUPS_CLOSED' });
    },
    health: () => ({ requested: cfg.requested, enabled: cfg.enabled, only: cfg.only, ...(cfg.requested && !cfg.enabled ? { reason: cfg.reason } : {}) }),
  };
}
