// The routes over real HTTP, against a fake SAI Cloud provider that signs real ES256 ID tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startApp, browser, portalClaims, hash, JWT_SECRET, ISSUER, APP } from './harness.js';

const loc = (res) => res.headers.get('location');
const errCode = (res) => new URL(loc(res), 'https://x.test').searchParams.get('code');

async function withApp(opts, fn) {
  const t = await startApp(opts);
  try { await fn(t, browser(t.base)); } finally { await t.close(); }
}

/* ── off by default ────────────────────────────────────────────────────────────────────────────── */
test('PORTAL_OIDC unset: config says off, the flow routes answer 404 (not the SPA), password routes unchanged', async () => {
  await withApp({ env: { PORTAL_OIDC: '' } }, async (t, b) => {
    assert.deepEqual(await (await b.go('/api/auth/portal/config')).json(), { enabled: false, only: false, signupsClosed: false });
    for (const p of ['/auth/portal/login', '/auth/portal/callback']) assert.equal((await b.go(p)).status, 404, p);
    const out = await b.go('/auth/portal/logout', { method: 'POST', body: {} });     // sign-out still works, so old cookies can be dropped
    assert.deepEqual(await out.json(), { ok: true, redirect: null });
    assert.equal((await b.go('/api/auth/login', { method: 'POST', body: {} })).status, 200, 'password login runs');
    assert.equal(t.provider.log.length, 0, 'the portal is never contacted');
  });
});

test('PORTAL_OIDC=1 with a missing secret stays OFF and says why (the pod would stay up)', async () => {
  await withApp({ env: { PORTAL_CLIENT_SECRET: '' } }, async (t, b) => {
    assert.equal(t.cfg.enabled, false);
    assert.match(t.cfg.reason, /PORTAL_CLIENT_SECRET/);
    assert.equal((await (await b.go('/api/auth/portal/config')).json()).enabled, false);
    assert.equal((await b.go('/auth/portal/login')).status, 404);
  });
  await withApp({ env: { PORTAL_SESSION_SECRET: 'short' } }, async (t) => assert.match(t.cfg.reason, /PORTAL_SESSION_SECRET/));
  await withApp({ env: { PORTAL_ISSUER: 'http://insecure.test' } }, async (t, b) => {
    assert.equal(t.cfg.enabled, false);
    assert.equal((await b.go('/auth/portal/login')).status, 404);
  });
});

/* ── the flow ──────────────────────────────────────────────────────────────────────────────────── */
test('login starts the flow: PKCE S256, state and nonce, the registered redirect_uri, a host-only signed cookie', async () => {
  await withApp({}, async (t, b) => {
    assert.deepEqual(await (await b.go('/api/auth/portal/config')).json(), { enabled: true, only: false, signupsClosed: false });
    const res = await b.go('/auth/portal/login');
    assert.equal(res.status, 302);
    const u = new URL(loc(res));
    assert.equal(u.origin + u.pathname, ISSUER + '/oidc/authorize');
    assert.equal(u.searchParams.get('client_id'), 'stories');
    assert.equal(u.searchParams.get('redirect_uri'), APP + '/auth/portal/callback');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('scope'), 'openid profile email');
    assert.ok(u.searchParams.get('state') && u.searchParams.get('nonce'));
    const c = b.raw('__Host-sai_oidc_tx');
    assert.match(c, /Secure/); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); assert.match(c, /Path=\//); assert.ok(!/Domain=/i.test(c));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('login: returnTo must be a path on this site; an off-site one is dropped', async () => {
  await withApp({}, async (t, b) => {
    await b.go('/auth/portal/login?returnTo=' + encodeURIComponent('//evil.test/x'));
    const cb = await b.signIn(t.provider, portalClaims(), { returnTo: 'https://evil.test' });
    assert.equal(cb.status, 302);
    assert.equal(loc(cb), '/auth/portal/done', 'no returnTo carried');
  });
});

test('different=1 asks the portal to show the sign-in again (prompt=login)', async () => {
  await withApp({}, async (t, b) => {
    const res = await b.go('/auth/portal/login?different=1');
    assert.equal(new URL(loc(res)).searchParams.get('prompt'), 'login');
  });
});

test('callback, a NEW person: creates the account, issues the SAME JWT the password login does, 24 hours, HttpOnly Secure Lax', async () => {
  await withApp({}, async (t, b) => {
    const cb = await b.signIn(t.provider, portalClaims(), { returnTo: '/?book=abc' });
    assert.equal(cb.status, 302);
    assert.equal(loc(cb), '/auth/portal/done?returnTo=' + encodeURIComponent('/?book=abc'));
    assert.equal(cb.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(t.store.users.length, 1);
    const u = t.store.users[0];
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(u.email, 'ada@example.com');
    assert.equal(u.tier, 'free');
    const tokenCookie = b.raw('token');
    assert.match(tokenCookie, /HttpOnly/); assert.match(tokenCookie, /Secure/); assert.match(tokenCookie, /SameSite=Lax/);
    assert.match(tokenCookie, /Max-Age=86400/);
    const d = jwt.verify(b.jar.get('token').value, JWT_SECRET);
    assert.deepEqual(Object.keys(d).sort(), ['email', 'exp', 'iat', 'tokenVersion', 'userId', 'via']);
    assert.equal(d.userId, u.id);
    assert.equal(d.exp - d.iat, 24 * 3600, 'portal sessions are 24 h, not 7 d');
    assert.equal(d.via, 'portal');
    assert.equal((await (await b.go('/api/probe')).json()).ok, true, 'the existing cookie auth accepts it');
    assert.ok(!b.jar.has('__Host-sai_oidc_tx'), 'the one-time sign-in cookie is cleared');
    assert.match(b.raw('portal_idt'), /Path=\/auth\/portal/);
    assert.deepEqual(t.audit.map((a) => a.reason), ['portal_signup']);
  });
});

test('callback, an existing VERIFIED Stories account with the same email: linked, same user id, nothing else changes', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: true, tier: 'basic', password_hash: hash('pw') });
    const before = { id: u.id, tier: u.tier, hash: u.password_hash };
    const cb = await b.signIn(t.provider, portalClaims());
    assert.equal(loc(cb), '/auth/portal/done');
    assert.equal(t.store.users.length, 1);
    assert.deepEqual({ id: u.id, tier: u.tier, hash: u.password_hash }, before);
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(jwt.verify(b.jar.get('token').value, JWT_SECRET).userId, u.id);
    assert.deepEqual(t.audit.map((a) => a.reason), ['portal_link_auto']);
  });
});

test('callback, the Stories email is UNVERIFIED: no session, no link; the password step does the linking', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('OldPass1!') });
    const cb = await b.signIn(t.provider, portalClaims(), { returnTo: '/?book=7' });
    assert.equal(loc(cb), '/auth/portal/link');
    assert.ok(!b.jar.has('token'), 'NOT signed in by the email claim alone');
    assert.equal(u.portal_sub, null, 'NOT linked yet');
    assert.match(b.raw('__Host-stories_portal_link'), /HttpOnly/);
    assert.deepEqual(await (await b.go('/api/auth/portal/link/status')).json(), { pending: true, email: 'ada@example.com' });

    // wrong password: uniform 401, nothing linked
    const bad = await b.go('/api/auth/portal/link', { method: 'POST', body: { password: 'wrong' } });
    assert.equal(bad.status, 401);
    const badBody = await bad.json();
    assert.equal(badBody.code, 'bad_password');
    assert.equal(u.portal_sub, null);
    assert.ok(!b.jar.has('token'));

    // right password
    const ok = await b.go('/api/auth/portal/link', { method: 'POST', body: { password: 'OldPass1!' } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.user.id, u.id);
    assert.equal(body.user.portalLinked, true);
    assert.equal(body.returnTo, '/?book=7');
    assert.equal(jwt.verify(body.token, JWT_SECRET).via, 'portal');
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(u.email_verified, true);
    assert.ok(b.jar.has('token'));
    assert.deepEqual(await (await b.go('/api/auth/portal/link/status')).json(), { pending: false }, 'the pending step is consumed');
    assert.deepEqual(t.audit.map((a) => a.reason), ['portal_link_needs_password', 'portal_link_bad_password', 'portal_link_password']);
  });
});

test('the password step: only 5 wrong tries per account, then a rate-limit answer even for the right password', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('OldPass1!') });
    await b.signIn(t.provider, portalClaims());
    for (let i = 0; i < 5; i++) assert.equal((await b.go('/api/auth/portal/link', { method: 'POST', body: { password: 'nope' + i } })).status, 401);
    const limited = await b.go('/api/auth/portal/link', { method: 'POST', body: { password: 'OldPass1!' } });
    assert.equal(limited.status, 429);
    assert.equal(u.portal_sub, null);
  });
});

test('the password step without a pending cookie (or a forged one) is refused', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'ada@example.com', password_hash: hash('OldPass1!') });
    const none = await b.go('/api/auth/portal/link', { method: 'POST', body: { password: 'OldPass1!' } });
    assert.equal(none.status, 400);
    assert.equal((await none.json()).code, 'expired');
    b.jar.set('__Host-stories_portal_link', { value: jwt.sign({ uid: t.store.users[0].id, sub: 'u_evil' }, 'attacker-key', { issuer: 'stories-portal-link' }), attrs: [], raw: '' });
    const forged = await b.go('/api/auth/portal/link', { method: 'POST', body: { password: 'OldPass1!' } });
    assert.equal(forged.status, 400);
    assert.equal(t.store.users[0].portal_sub, null);
  });
});

test('callback: an existing user linked to another sub gets a clear error page and no session', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'ada@example.com', email_verified: true, portal_sub: 'u_someoneelse00000' });
    const cb = await b.signIn(t.provider, portalClaims());
    assert.equal(errCode(cb), 'linked_elsewhere');
    assert.ok(!b.jar.has('token'));
  });
});

test('callback: signups closed refuses a new person with its own error page, creating nothing', async () => {
  await withApp({ env: { SIGNUPS_CLOSED: '1' } }, async (t, b) => {
    const cb = await b.signIn(t.provider, portalClaims());
    assert.equal(errCode(cb), 'signups_closed');
    assert.equal(t.store.users.length, 0);
    assert.ok(!b.jar.has('token'));
  });
});

test('callback: an UNVERIFIED SAI Cloud email is refused by the library and surfaced as email_unverified', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'ada@example.com', email_verified: true });
    const cb = await b.signIn(t.provider, portalClaims({ email_verified: false }));
    assert.equal(errCode(cb), 'email_unverified');
    assert.ok(!b.jar.has('token'));
    assert.equal(t.store.users[0].portal_sub, null);
  });
});

test('callback: the portal said access_denied / an error: clear error codes, no session', async () => {
  await withApp({}, async (t, b) => {
    const start = await b.go('/auth/portal/login');
    const state = new URL(loc(start)).searchParams.get('state');
    const cb = await b.go(`/auth/portal/callback?error=access_denied&state=${state}&iss=${encodeURIComponent(ISSUER)}`);
    assert.equal(errCode(cb), 'access_denied');
    const start2 = await b.go('/auth/portal/login');
    const state2 = new URL(loc(start2)).searchParams.get('state');
    const cb2 = await b.go(`/auth/portal/callback?error=server_error&state=${state2}&iss=${encodeURIComponent(ISSUER)}`);
    assert.equal(errCode(cb2), 'failed');
  });
});

test('callback: no sign-in cookie / wrong state / replay all end on the "expired" page', async () => {
  await withApp({}, async (t, b) => {
    // a callback that was never started in this browser
    const cold = await browser(t.base).go(`/auth/portal/callback?code=x&state=y&iss=${encodeURIComponent(ISSUER)}`);
    assert.equal(errCode(cold), 'expired');
    // wrong state
    const start = await b.go('/auth/portal/login');
    const { code } = t.provider.authorize(loc(start), portalClaims());
    assert.equal(errCode(await b.go(`/auth/portal/callback?code=${code}&state=WRONG&iss=${encodeURIComponent(ISSUER)}`)), 'expired');
    // replay of a completed callback
    const b2 = browser(t.base);
    const s2 = await b2.go('/auth/portal/login');
    const a = t.provider.authorize(loc(s2), portalClaims());
    const url = `/auth/portal/callback?code=${a.code}&state=${a.state}&iss=${encodeURIComponent(ISSUER)}`;
    const txCookie = b2.jar.get('__Host-sai_oidc_tx');
    assert.equal(loc(await b2.go(url)), '/auth/portal/done');
    b2.jar.set('__Host-sai_oidc_tx', txCookie);
    assert.equal(errCode(await b2.go(url)), 'expired');
  });
});

test('callback: a missing iss parameter (the mix-up defence) is refused', async () => {
  await withApp({}, async (t, b) => {
    const start = await b.go('/auth/portal/login');
    const { code, state } = t.provider.authorize(loc(start), portalClaims());
    assert.equal(errCode(await b.go(`/auth/portal/callback?code=${code}&state=${state}`)), 'failed');
    assert.equal(t.store.users.length, 0);
  });
});

test('callback: an ID token for another audience is refused', async () => {
  await withApp({}, async (t, b) => {
    const cb = await b.signIn(t.provider, portalClaims(), { extra: { tamper: true } });
    assert.equal(errCode(cb), 'failed');
    assert.equal(t.store.users.length, 0);
    assert.ok(!b.jar.has('token'));
  });
});

test('callback: a suspended account lands on the suspended page', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'x@example.com', portal_sub: 'u_aaaaaaaaaaaaaaaa', status: 'suspended' });
    assert.equal(errCode(await b.signIn(t.provider, portalClaims())), 'suspended');
    assert.ok(!b.jar.has('token'));
  });
});

test('signing in again by sub after the portal email changed: same account, no duplicate', async () => {
  await withApp({}, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    const b2 = browser(t.base);
    const cb = await b2.signIn(t.provider, portalClaims({ email: 'ada.new@example.com' }));
    assert.equal(loc(cb), '/auth/portal/done');
    assert.equal(t.store.users.length, 1);
    assert.equal(t.store.users[0].email, 'ada@example.com');
  });
});

/* ── the hand-off to the SPA ───────────────────────────────────────────────────────────────────── */
test('session hand-off: works right after a portal sign-in, and only then', async () => {
  let clock = Date.now();
  await withApp({ now: () => clock }, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    const r = await b.go('/api/auth/portal/session', { method: 'POST' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.user.portalLinked, true);
    assert.equal(jwt.verify(body.token, JWT_SECRET).userId, t.store.users[0].id);
    clock += 5 * 60 * 1000;
    assert.equal((await b.go('/api/auth/portal/session', { method: 'POST' })).status, 401, 'not after the first two minutes');
  });
});

test('session hand-off: refuses a cookie that is not a fresh portal session (e.g. a password-login token)', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'p@example.com' });
    b.jar.set('token', { value: jwt.sign({ userId: u.id, email: u.email, tokenVersion: 1 }, JWT_SECRET, { expiresIn: '7d' }), attrs: [], raw: '' });
    assert.equal((await b.go('/api/auth/portal/session', { method: 'POST' })).status, 401);
    assert.equal((await browser(t.base).go('/api/auth/portal/session', { method: 'POST' })).status, 401);
  });
});

/* ── logout ────────────────────────────────────────────────────────────────────────────────────── */
test('logout clears the Stories session; everywhere:true also returns the portal end_session URL with the id_token_hint', async () => {
  await withApp({}, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    const idt = b.jar.get('portal_idt').value;
    const local = await (await b.go('/auth/portal/logout', { method: 'POST', body: {} })).json();
    assert.deepEqual(local, { ok: true, redirect: null });
    assert.ok(!b.jar.has('token')); assert.ok(!b.jar.has('portal_idt'));

    const b2 = browser(t.base);
    await b2.signIn(t.provider, portalClaims());
    const all = await (await b2.go('/auth/portal/logout', { method: 'POST', body: { everywhere: true } })).json();
    const u = new URL(all.redirect);
    assert.equal(u.origin + u.pathname, ISSUER + '/oidc/logout');
    assert.equal(u.searchParams.get('client_id'), 'stories');
    assert.ok(u.searchParams.get('id_token_hint'));
    assert.equal(u.searchParams.get('post_logout_redirect_uri'), APP + '/');
    assert.ok(!b2.jar.has('token'));
    assert.ok(idt);
  });
});

test('logout without a session still answers and clears', async () => {
  await withApp({}, async (t, b) => {
    const r = await b.go('/auth/portal/logout', { method: 'POST', body: { everywhere: true } });
    assert.equal(r.status, 200);
    assert.ok((await r.json()).redirect.startsWith(ISSUER + '/oidc/logout'));
  });
});

/* ── PORTAL_ONLY and SIGNUPS_CLOSED ────────────────────────────────────────────────────────────── */
test('PORTAL_ONLY=1 turns the password routes off; SAI Cloud keeps working', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t, b) => {
    assert.equal((await (await b.go('/api/auth/portal/config')).json()).only, true);
    for (const p of ['/api/auth/login', '/api/auth/register']) {
      const r = await b.go(p, { method: 'POST', body: {} });
      assert.equal(r.status, 403, p);
      assert.equal((await r.json()).code, 'PORTAL_ONLY');
    }
    assert.equal(loc(await b.signIn(t.provider, portalClaims())), '/auth/portal/done');
  });
});

test('PORTAL_ONLY=1 is IGNORED when SAI Cloud sign-in is not actually working (no lock-out)', async () => {
  await withApp({ env: { PORTAL_ONLY: '1', PORTAL_CLIENT_SECRET: '' } }, async (t, b) => {
    assert.equal(t.cfg.only, false);
    assert.equal((await b.go('/api/auth/login', { method: 'POST', body: {} })).status, 200);
  });
});

test('SIGNUPS_CLOSED=1 closes local registration too', async () => {
  await withApp({ env: { SIGNUPS_CLOSED: '1' } }, async (t, b) => {
    assert.equal((await b.go('/api/auth/register', { method: 'POST', body: {} })).status, 403);
    assert.equal((await b.go('/api/auth/login', { method: 'POST', body: {} })).status, 200);
  });
});

test('health reports the state without secrets', async () => {
  await withApp({}, async (t) => assert.deepEqual(t.portal.health(), { requested: true, enabled: true, only: false }));
  await withApp({ env: { PORTAL_OIDC: '' } }, async (t) => assert.deepEqual(t.portal.health(), { requested: false, enabled: false, only: false }));
  await withApp({ env: { PORTAL_CLIENT_SECRET: '' } }, async (t) => {
    const h = t.portal.health();
    assert.equal(h.enabled, false);
    assert.ok(!JSON.stringify(h).includes('client-secret-for-tests'));
  });
});
