// Settings > "Connect SAI Cloud": a signed-in Stories user links the SAI Cloud account they sign in with next.
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startApp, browser, portalClaims, hash, JWT_SECRET } from './harness.js';

const loc = (res) => res.headers.get('location');
const errCode = (res) => new URL(loc(res), 'https://x.test').searchParams.get('code');
const bearer = (u) => ({ authorization: 'Bearer ' + jwt.sign({ userId: u.id, email: u.email, tokenVersion: u.token_version ?? 1 }, JWT_SECRET, { expiresIn: '7d' }) });

async function withApp(opts, fn) {
  const t = await startApp(opts);
  try { await fn(t, browser(t.base)); } finally { await t.close(); }
}

/** Start a connect as user u and return the start path it hands the SPA. */
async function startConnect(b, u, { password = 'Secret1!', returnTo = '/settings' } = {}) {
  const r = await b.go('/api/auth/portal/attach', { method: 'POST', body: { password, returnTo }, headers: bearer(u) });
  return { res: r, body: await r.json() };
}

test('connect: a DIFFERENT SAI Cloud email links to the signed-in account, keeps its password, lands back on settings', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'writer@stories.test', email_verified: true, password_hash: hash('Secret1!') });
    const before = u.password_hash;
    const { res, body } = await startConnect(b, u);
    assert.equal(res.status, 200);
    assert.match(body.url, /^\/auth\/portal\/login\?different=1&returnTo=/);
    assert.match(b.raw('__Host-stories_portal_attach'), /HttpOnly/);
    const cb = await b.signIn(t.provider, portalClaims({ email: 'someone.else@cloud.test' }), { start: body.url });
    assert.equal(cb.status, 302);
    const done = new URL(loc(cb), 'https://x.test');
    assert.equal(done.pathname, '/auth/portal/done');
    assert.match(done.searchParams.get('returnTo'), /^\/settings\?connect=[0-9a-f]{32}$/);
    assert.equal(t.store.users.length, 1, 'no second account made for the other email');
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(u.password_hash, before, 'the password stays: the person just proved it');
    assert.equal(u.email_verified, true);
    const claims = jwt.verify(b.jar.get('token').value, JWT_SECRET);
    assert.equal(claims.userId, u.id);
    assert.equal(claims.via, 'portal');
    assert.equal(claims.tokenVersion, u.token_version, 'the new session carries the bumped version');
    assert.ok(!b.jar.has('__Host-stories_portal_attach'), 'the connect cookie is used up');
    assert.deepEqual(t.audit.map((a) => a.reason), ['portal_attach']);
    // the next ordinary sign-in finds the same account by sub
    const again = await browser(t.base).signIn(t.provider, portalClaims({ email: 'someone.else@cloud.test' }));
    assert.equal(loc(again), '/auth/portal/done');
    assert.equal(t.store.users.length, 1);
  });
});

test('connect: the Stories email becomes verified only when SAI Cloud vouches for that SAME address', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'Ada@Example.com', email_verified: false, password_hash: hash('Secret1!') });
    const { body } = await startConnect(b, u);
    await b.signIn(t.provider, portalClaims({ email: 'ada@example.com' }), { start: body.url });
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(u.email_verified, true);
  });
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('Secret1!') });
    const { body } = await startConnect(b, u);
    await b.signIn(t.provider, portalClaims({ email: 'other@example.com' }), { start: body.url });
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(u.email_verified, false, 'another address proves nothing about this one');
  });
});

test('connect: needs a signed-in user AND the right password; 5 wrong tries then rate-limited', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'w@stories.test', password_hash: hash('Secret1!') });
    assert.equal((await b.go('/api/auth/portal/attach', { method: 'POST', body: { password: 'Secret1!' } })).status, 401, 'no session');
    const bad = await startConnect(b, u, { password: 'wrong' });
    assert.equal(bad.res.status, 401);
    assert.equal(bad.body.code, 'bad_password');
    assert.ok(!b.jar.has('__Host-stories_portal_attach'));
    for (let i = 0; i < 4; i++) await startConnect(b, u, { password: 'nope' + i });
    assert.equal((await startConnect(b, u)).res.status, 429);
    assert.equal(u.portal_sub, null);
  });
});

test('connect: an already-connected account is refused up front', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'w@stories.test', password_hash: hash('Secret1!'), portal_sub: 'u_bbbbbbbbbbbbbbbb' });
    const r = await startConnect(b, u);
    assert.equal(r.res.status, 409);
    assert.equal(r.body.code, 'already_connected');
  });
});

test('connect: a SAI Cloud account that already belongs to ANOTHER Stories user is refused; nothing moves', async () => {
  await withApp({}, async (t, b) => {
    const other = t.store.add({ email: 'first@stories.test', portal_sub: 'u_aaaaaaaaaaaaaaaa' });
    const u = t.store.add({ email: 'w@stories.test', password_hash: hash('Secret1!') });
    const { body } = await startConnect(b, u);
    const cb = await b.signIn(t.provider, portalClaims(), { start: body.url });
    assert.equal(errCode(cb), 'sub_in_use');
    assert.equal(u.portal_sub, null);
    assert.equal(other.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.ok(!b.jar.has('token'));
  });
});

test('connect: signing out (or changing the password) between the start and the callback cancels it', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'w@stories.test', password_hash: hash('Secret1!') });
    const { body } = await startConnect(b, u);
    u.token_version += 1;                                   // logout-everywhere / password change
    const cb = await b.signIn(t.provider, portalClaims({ email: 'x@cloud.test' }), { start: body.url });
    assert.equal(errCode(cb), 'expired');
    assert.equal(u.portal_sub, null);
  });
});

test('connect: a left-over connect cookie never hijacks a later ORDINARY sign-in in the same browser', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'w@stories.test', password_hash: hash('Secret1!') });
    await startConnect(b, u);                               // started, then abandoned
    assert.ok(b.jar.has('__Host-stories_portal_attach'));
    const cb = await b.signIn(t.provider, portalClaims({ sub: 'u_cccccccccccccccc', email: 'stranger@cloud.test' }));
    assert.equal(loc(cb), '/auth/portal/done');
    assert.equal(u.portal_sub, null, 'the stranger was NOT attached to the abandoned account');
    assert.equal(t.store.users.length, 2, 'the stranger got their own account, as any sign-in would');
    assert.ok(!b.jar.has('__Host-stories_portal_attach'), 'and the stale cookie is gone');
    // a guessed connect id in returnTo does not help either
    await startConnect(b, u);
    const forged = await b.signIn(t.provider, portalClaims({ sub: 'u_dddddddddddddddd', email: 'mallory@cloud.test' }), { returnTo: '/settings?connect=' + '0'.repeat(32) });
    assert.equal(loc(forged), '/auth/portal/done?returnTo=' + encodeURIComponent('/settings?connect=' + '0'.repeat(32)));
    assert.equal(u.portal_sub, null);
  });
});

test('connect: OFF when SAI Cloud sign-in is off', async () => {
  await withApp({ env: { PORTAL_OIDC: '' } }, async (t, b) => {
    const u = t.store.add({ email: 'w@stories.test', password_hash: hash('Secret1!') });
    assert.equal((await startConnect(b, u)).res.status, 404);
  });
});
