// Sign in with SAI Cloud: the routes. Mounted by server/index.js; every one of them is inert unless PORTAL_OIDC=1.
//
//   GET  /auth/portal/login              start the flow (state, nonce and the PKCE verifier ride the library's signed,
//                                        host-only __Host- cookie), 302 to the portal
//   GET  /auth/portal/callback           the library verifies everything (state, iss, ID token, nonce, verified email),
//                                        then accounts.js decides WHICH Stories user this is, then the SAME app JWT the
//                                        password login issues is set as the `token` cookie, 302 to /auth/portal/done
//   POST /auth/portal/logout             clears the Stories session; {everywhere:true} also returns the portal's end_session URL
//   GET  /api/auth/portal/config         what the login page may know ({enabled, only, signupsClosed}); answers when OFF too
//   POST /api/auth/portal/session        hands the freshly issued JWT to the SPA ONCE (see below): the second call is 410
//   GET  /api/auth/portal/link/status    is there an account-linking step pending in this browser?
//   POST /api/auth/portal/link           the old Stories password, once, to link an UNVERIFIED Stories account
//   POST /api/auth/portal/attach         Settings > "Connect SAI Cloud": the SIGNED-IN user, with their password, links
//                                        whichever SAI Cloud account they sign in with next (the email need not match)
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
import { createProviderHealth } from './health.js';
import { createOnceStore } from './session.js';

const require = createRequire(import.meta.url);
const { createClient, OidcError } = require('../vendor/sai-auth-client/index.cjs');

const TOKEN_COOKIE = 'token';                         // the cookie authenticateToken already reads
const IDT_COOKIE = 'portal_idt';                      // the ID token, only to hint the portal's end_session; sent to /auth/portal/* only
const LINK_COOKIE = '__Host-stories_portal_link';     // the pending account-linking step, signed, 10 minutes
const ATTACH_COOKIE = '__Host-stories_portal_attach'; // a Settings "Connect SAI Cloud" in progress, signed, 10 minutes
const LINK_TTL_S = 600;
const HANDOFF_WINDOW_S = 120;                         // /api/auth/portal/session works for 2 minutes after the callback
export const RETURN_TO_RE = /^\/(?![/\\])[\x21-\x7e]{0,512}$/;

// shown, uniform, for every way the password step can fail
const BAD_PASSWORD = { error: 'That did not work. Check your Stories password and try again.', code: 'bad_password' };

const isBlockedUser = (u) => u && (u.status === 'suspended' || u.status === 'banned');

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

// The connect id rides in returnTo, which the library seals into its own sign-in cookie: a connect cookie only ever
// applies to the ONE sign-in flow it was started with, never to a later, ordinary sign-in in the same browser.
const ATTACH_PARAM = 'connect';
const attachIdOf = (returnTo) => {
  try { return new URL(returnTo || '/', 'https://x.invalid').searchParams.get(ATTACH_PARAM) || ''; } catch { return ''; }
};

/**
 * @param {object} o
 * @param {(req) => Promise<boolean>} [o.allowSignup]   asked right before a NEW account is created (index.js: the registration limiter's counter)
 * @param {{consume: (id: string) => Promise<boolean>}} [o.handoff]   one-time-use memory for the SPA hand-off (default: this process)
 * @param {{autoStart?: boolean, intervalMs?: number}} [o.probe]   the provider health probe (tests switch the timer off)
 * @param {Function} [o.authenticate]   the app's authenticateToken (sets req.user); without it there is no "Connect SAI Cloud"
 */
export function createPortalAuth({ cfg, store, jwtSecret, audit = async () => {}, log = console, fetch: fetchImpl, now = Date.now,
  allowSignup = async () => true, handoff = createOnceStore({ now, log }), probe: probeOpts = {}, authenticate = null }) {
  const router = express.Router();
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const dummyHash = bcrypt.hashSync('not-a-password-' + crypto.randomBytes(8).toString('hex'), 10);

  // PORTAL_ONLY is a REQUEST (cfg.only). It is ENFORCED only while the portal is healthy (health.js), so a portal outage,
  // or a portal that is gone, never locks everyone out of Stories. Admins are never locked out by it at all.
  let providerHealth = null;
  const onlyActive = () => !!(cfg.only && providerHealth && providerHealth.check());
  const ctx = { cfg, store, onlyActive, providerHealth: () => providerHealth };

  router.get('/api/auth/portal/config', (req, res) => { noStore(res); res.json({ ...publicPortalConfig(cfg), only: onlyActive() }); });

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
    router.all(['/auth/portal/login', '/auth/portal/callback', '/api/auth/portal/attach'], (req, res) => res.status(404).json({ error: 'Not found' }));
    // ...except sign-out: a browser that signed in while the feature was on must still be able to drop its cookies after it is turned off
    router.post('/auth/portal/logout', (req, res) => {
      noStore(res);
      res.clearCookie(TOKEN_COOKIE);
      res.clearCookie(IDT_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/portal' });
      res.json({ ok: true, redirect: null });
    });
    return finish(router, ctx);
  }

  providerHealth = createProviderHealth({ issuer: cfg.issuer, fetch: fetchImpl, now, log, ...probeOpts });
  providerHealth.start();

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
  const attachKey = crypto.createHmac('sha256', cfg.cookieSecret).update('stories-portal-attach').digest();
  const sealAttach = (p) => jwt.sign(p, attachKey, { algorithm: 'HS256', expiresIn: LINK_TTL_S, issuer: 'stories-portal-attach' });
  const readAttach = (req) => {
    const raw = req.cookies?.[ATTACH_COOKIE];
    if (!raw) return null;
    try {
      const p = jwt.verify(raw, attachKey, { algorithms: ['HS256'], issuer: 'stories-portal-attach' });
      return p && typeof p.uid === 'string' && typeof p.aid === 'string' && p.aid ? p : null;
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
      // jti: the id the SPA hand-off consumes (see /api/auth/portal/session); one fresh id per issued session
      jwtSecret, { expiresIn: cfg.sessionTtlS, jwtid: crypto.randomBytes(16).toString('hex') });
    res.cookie(TOKEN_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: cfg.sessionTtlS * 1000 });
    if (idToken) res.cookie(IDT_COOKIE, idToken, { ...idtCookieOpts, maxAge: cfg.sessionTtlS * 1000 });
    res.clearCookie(LINK_COOKIE, linkCookieOpts);
    res.clearCookie(ATTACH_COOKIE, linkCookieOpts);
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

    const attach = readAttach(req);
    if (attach) res.clearCookie(ATTACH_COOKIE, linkCookieOpts);
    if (attach && attachIdOf(who.returnTo) === attach.aid) return attachAccount(req, res, attach, who);

    let outcome;
    try {
      outcome = await resolveAccount(store, who, { signupsOpen: !cfg.signupsClosed, allowCreate: () => allowSignup(req) });
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
      case OUTCOME.AMBIGUOUS_EMAIL:
        // operator hint only: no address in the log
        log.warn('[portal-auth] a SAI Cloud sign-in was refused: more than one Stories account has its email (case-duplicates). Run node server/portalAuth/duplicateEmails.js (counts only) and merge them.');
        await audit(who.verifiedEmail, null, false, 'portal_email_ambiguous', req);
        return toError(res, 'contact_support');
      case OUTCOME.SIMILAR_EMAIL: await audit(who.verifiedEmail, null, false, 'portal_email_similar', req); return toError(res, 'similar_email');
      case OUTCOME.RATE_LIMITED: await audit(who.verifiedEmail, null, false, 'portal_signup_rate_limited', req); return toError(res, 'rate_limited');
      default: return toError(res, 'unavailable');
    }
  });

  // The cookie is HttpOnly, but the SPA still keeps its token in localStorage (dozens of components read it), so right after
  // the callback it asks for it ONCE. Only a portal session, only in the first two minutes after it was issued, and the
  // session's jti is consumed on the first success: a second call (a replay of the cookie, a second tab) is 410.
  router.post('/api/auth/portal/session', async (req, res) => {
    noStore(res);
    const raw = req.cookies?.[TOKEN_COOKIE];
    try {
      const d = jwt.verify(raw || '', jwtSecret);
      const t = Math.floor(now() / 1000);
      if (d.via !== 'portal' || typeof d.iat !== 'number' || t - d.iat > HANDOFF_WINDOW_S) throw new Error('not fresh');
      const user = await store.findById(d.userId);
      if (!user || user.status === 'suspended' || user.status === 'banned' || (d.tokenVersion !== undefined && d.tokenVersion !== (user.token_version ?? 1))) throw new Error('gone');
      if (typeof d.jti !== 'string' || !d.jti) throw new Error('no id');
      if (!(await handoff.consume(d.jti))) return res.status(410).json({ error: 'This sign-in was already collected. Sign in again.', code: 'used' });
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
      const r = await linkWithPassword(store, { userId: p.uid, sub: p.sub, email: p.email }, password, { compare: bcrypt.compare, dummyHash });
      if (r.kind === 'bad_password') {
        await audit(p.email, p.uid, false, 'portal_link_bad_password', req);
        return res.status(401).json(BAD_PASSWORD);
      }
      if (r.kind === OUTCOME.BLOCKED) return res.status(403).json({ error: 'This account is not available.', code: 'suspended' });
      if (r.kind === OUTCOME.LINKED_ELSEWHERE) return res.status(409).json({ error: 'This Stories account is already linked to a different SAI Cloud account.', code: 'linked_elsewhere' });
      if (r.kind === OUTCOME.AMBIGUOUS_EMAIL) {
        log.warn('[portal-auth] account linking refused: more than one Stories account has the email (case-duplicates).');
        return res.status(409).json({ error: 'More than one Stories account uses this email address. Please contact support.', code: 'contact_support' });
      }
      const token = startSession(res, r.user, p.idt);
      await audit(r.user.email, r.user.id, true, r.linked ? 'portal_link_password' : 'portal_login', req);
      return res.json({ user: userJson(r.user), token, returnTo: p.rt && RETURN_TO_RE.test(p.rt) ? p.rt : null });
    } catch (e) {
      log.error('[portal-auth] linking failed:', e.message);
      return res.status(500).json({ error: 'Linking failed. Please try again.', code: 'unavailable' });
    }
  });

  // Settings > "Connect SAI Cloud". The person is signed in to Stories AND types their Stories password (a stolen session
  // alone cannot hand the account to someone else's SAI Cloud). The answer is where to send the browser: the ordinary
  // sign-in, asking the portal to show its sign-in page so the person picks the SAI Cloud account knowingly.
  const attachLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'rate_limited' },
    keyGenerator: (req) => `portal-attach:${req.user?.id || req.user?.userId || req.ip}` });
  const noAuth = (req, res) => res.status(404).json({ error: 'Not found' });
  router.post('/api/auth/portal/attach', authenticate || noAuth, attachLimiter, async (req, res) => {
    noStore(res);
    try {
      const user = await store.findById(req.user.id || req.user.userId);
      if (!user || isBlockedUser(user)) return res.status(403).json({ error: 'This account is not available.', code: 'suspended' });
      if (user.portal_sub) return res.status(409).json({ error: 'This account is already connected to SAI Cloud.', code: 'already_connected' });
      const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
      const hash = typeof user.password_hash === 'string' && user.password_hash ? user.password_hash : dummyHash;
      if (!(await bcrypt.compare(password, hash))) {
        await audit(user.email, user.id, false, 'portal_attach_bad_password', req);
        return res.status(401).json({ error: 'That password is not right.', code: 'bad_password' });
      }
      const aid = crypto.randomBytes(16).toString('hex');
      res.cookie(ATTACH_COOKIE, sealAttach({ uid: user.id, tv: user.token_version ?? 1, aid }), { ...linkCookieOpts, maxAge: LINK_TTL_S * 1000 });
      const want = typeof req.body?.returnTo === 'string' && RETURN_TO_RE.test(req.body.returnTo) ? req.body.returnTo : '/';
      const rt = new URL(want, 'https://x.invalid');
      rt.searchParams.set(ATTACH_PARAM, aid);
      const returnTo = rt.pathname + rt.search;
      if (!RETURN_TO_RE.test(returnTo)) return res.status(400).json({ error: 'Bad return address.', code: 'bad_request' });
      return res.json({ url: '/auth/portal/login?different=1&returnTo=' + encodeURIComponent(returnTo) });
    } catch (e) {
      log.error('[portal-auth] connect could not start:', e.message);
      return res.status(500).json({ error: 'Could not start. Please try again.', code: 'unavailable' });
    }
  });

  // The callback half of "Connect SAI Cloud": link THIS Stories user to the SAI Cloud account that just signed in.
  // The email is not consulted for the decision (the person proved both sides); it only marks the Stories address
  // verified when the portal vouches for the very same one. The password stays, as after the password step.
  async function attachAccount(req, res, attach, who) {
    try {
      const user = await store.findById(attach.uid);
      if (!user || (user.token_version ?? 1) !== attach.tv) return toError(res, 'expired');   // signed out / password changed meanwhile
      if (isBlockedUser(user)) return toError(res, 'suspended');
      if (user.portal_sub && user.portal_sub !== who.sub) return toError(res, 'already_connected');
      let linked = user;
      if (!user.portal_sub) {
        const owner = await store.findByPortalSub(who.sub);
        if (owner && owner.id !== user.id) {
          await audit(user.email, user.id, false, 'portal_attach_sub_in_use', req);
          return toError(res, 'sub_in_use');
        }
        const same = who.emailVerified === true && typeof who.verifiedEmail === 'string'
          && who.verifiedEmail.trim().toLowerCase() === String(user.email || '').trim().toLowerCase();
        const r = await store.linkPortal(user.id, who.sub, { markEmailVerified: same });
        if (r.ok) linked = r.user;
        else if (r.reason === 'already_linked') linked = (await store.findById(user.id)) || user;   // a second tab got there first
        else return toError(res, 'sub_in_use');
      }
      startSession(res, linked, who.idToken);
      await audit(linked.email, linked.id, true, 'portal_attach', req);
      return done(res, who.returnTo);
    } catch (e) {
      log.error('[portal-auth] connect failed:', e.message);
      return toError(res, 'unavailable');
    }
  }

  router.post('/auth/portal/logout', async (req, res) => {
    noStore(res);
    const hint = req.cookies?.[IDT_COOKIE];
    res.clearCookie(TOKEN_COOKIE);
    res.clearCookie(IDT_COOKIE, idtCookieOpts);
    res.clearCookie(LINK_COOKIE, linkCookieOpts);
    res.clearCookie(ATTACH_COOKIE, linkCookieOpts);
    let redirect = null;
    if (req.body && req.body.everywhere === true) {
      try { redirect = await client.logoutUrl({ idTokenHint: hint || undefined }); }
      catch (e) { log.warn('[portal-auth] no end_session URL:', e.code || e.message); }
    }
    res.json({ ok: true, redirect });
  });

  return finish(router, ctx);
}

// What index.js needs besides the router.
function finish(router, { cfg, store, onlyActive, providerHealth }) {
  const onlyBody = { error: 'Email and password sign-in is turned off. Sign in with SAI Cloud.', code: 'PORTAL_ONLY' };
  return {
    router,
    config: cfg,
    /** PORTAL_ONLY is requested AND the portal is healthy: the password routes are really off. */
    onlyActive,
    /** PORTAL_ONLY, local sign-UP: refused for everyone while it is enforced (existing sessions keep working until they expire). */
    blockPasswordAuth(req, res, next) {
      if (!onlyActive()) return next();
      return res.status(403).json(onlyBody);
    },
    /**
     * PORTAL_ONLY, password sign-IN: refused while it is enforced, EXCEPT for an admin account (break-glass: the way in
     * when SAI Cloud is misconfigured in a way the health probe cannot see). The account looked at is the one the login
     * handler will use (the oldest with that email). Side effect worth knowing: under PORTAL_ONLY a non-admin gets 403
     * where an admin gets the normal 401, so admin addresses can be told apart.
     */
    async blockPasswordLogin(req, res, next) {
      if (!onlyActive()) return next();
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        if (email && (await store.findUsersByEmail(email))[0]?.role === 'admin') return next();
      } catch { return next(); }       // the database is in trouble: the handler answers (and fails the same way)
      return res.status(403).json(onlyBody);
    },
    /**
     * PORTAL_ONLY, "forgot password" / "reset password" for this account? An account WITHOUT a SAI Cloud link can still reset
     * (reset-then-link is how an unverified Stories account whose password is forgotten gets onto SAI Cloud), and so can an
     * admin. A linked account signs in through SAI Cloud while the portal is healthy.
     */
    passwordResetAllowed(user) {
      if (!onlyActive()) return true;
      return !!user && (user.role === 'admin' || !user.portal_sub);
    },
    onlyBody,
    /** SIGNUPS_CLOSED: new accounts (local) answer 403. */
    blockSignups(req, res, next) {
      if (!cfg.signupsClosed) return next();
      return res.status(403).json({ error: 'New accounts are closed at the moment.', code: 'SIGNUPS_CLOSED' });
    },
    /** One probe now (tests, and an operator hook); resolves to healthy/not. */
    probe: () => (providerHealth() ? providerHealth().probe() : Promise.resolve(false)),
    stop: () => providerHealth()?.stop(),
    health() {
      const h = providerHealth();
      return {
        requested: cfg.requested, enabled: cfg.enabled, only: onlyActive(),
        ...(cfg.enabled ? { onlyRequested: cfg.onlyRequested, providerHealthy: !!h?.isHealthy(), provider: h?.status() } : {}),
        ...(cfg.requested && !cfg.enabled ? { reason: cfg.reason } : {}),
        ...(cfg.only && !onlyActive() ? { note: 'PORTAL_ONLY is requested but NOT enforced: SAI Cloud is not reachable, so password sign-in stays available' } : {}),
      };
    },
  };
}
