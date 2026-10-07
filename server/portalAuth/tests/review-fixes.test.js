// The independent security review of "Sign in with SAI Cloud" (2026-10-07): one block of tests per finding.
// DB-backed counterparts are in migration.pg.test.js (throwaway Postgres) and server/tests/regress.test.js (the real server).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { startApp, browser, portalClaims, hash, fakeProvider, JWT_SECRET, ISSUER } from './harness.js';
import { resolveAccount, linkWithPassword, OUTCOME } from '../accounts.js';
import { createProviderHealth, HEALTH_FRESH_MS } from '../health.js';
import { reissueLifetimeS, createOnceStore } from '../session.js';
import { emailKey } from '../emailKey.js';
import { formatCounts, run as runDuplicateCheck } from '../duplicateEmails.js';
import { memoryStore } from './harness.js';
import { UserDataService } from '../../db/dataService.js';

const loc = (res) => res.headers.get('location');
const errCode = (res) => new URL(loc(res), 'https://x.test').searchParams.get('code');
const ONLY = { PORTAL_ONLY: '1' };
const post = (b, p, body = {}) => b.go(p, { method: 'POST', body });

async function withApp(opts, fn) {
  const t = await startApp(opts);
  try { await fn(t, browser(t.base)); } finally { await t.close(); }
}
/** a provider whose network can be switched off */
function switchable() {
  const p = fakeProvider();
  const s = { ...p, down: false, fetch: (u, i) => (s.down ? Promise.reject(new Error('connect ECONNREFUSED')) : p.fetch(u, i)) };
  return s;
}

/* ═══ 1. PORTAL_ONLY must never lock everyone out ═══════════════════════════════════════════════ */

test('1a. PORTAL_ONLY while the portal is healthy: a normal account is refused, an ADMIN can still sign in with the password', async () => {
  await withApp({ env: ONLY }, async (t, b) => {
    t.store.add({ email: 'boss@example.com', role: 'admin', password_hash: hash('pw') });
    t.store.add({ email: 'reader@example.com' });
    assert.equal((await (await b.go('/api/auth/portal/config')).json()).only, true);
    assert.equal((await post(b, '/api/auth/login', { email: 'reader@example.com', password: 'x' })).status, 403);
    assert.equal((await post(b, '/api/auth/login', { email: 'nobody@example.com', password: 'x' })).status, 403, 'unknown address: same refusal');
    assert.equal((await post(b, '/api/auth/login', {})).status, 403);
    const admin = await post(b, '/api/auth/login', { email: 'Boss@Example.com', password: 'x' });
    assert.equal(admin.status, 200, 'the admin reaches the normal login handler (case-insensitive email)');
    assert.equal((await post(b, '/api/auth/register', { email: 'boss@example.com' })).status, 403, 'sign-UP stays closed for everyone');
  });
});

test('1b. PORTAL_ONLY is NOT enforced while the portal is unreachable: password sign-in, sign-up and the public config say so', async () => {
  const provider = switchable();
  provider.down = true;
  await withApp({ env: ONLY, provider }, async (t, b) => {
    assert.equal(t.cfg.only, true, 'requested');
    assert.equal(t.portal.onlyActive(), false, 'but not enforced');
    t.store.add({ email: 'reader@example.com' });
    assert.equal((await post(b, '/api/auth/login', { email: 'reader@example.com', password: 'x' })).status, 200, 'password login runs');
    assert.equal((await post(b, '/api/auth/register', {})).status, 200);
    assert.equal((await (await b.go('/api/auth/portal/config')).json()).only, false, 'the SPA shows the password form');
    const h = t.portal.health();
    assert.equal(h.only, false); assert.equal(h.onlyRequested, true); assert.equal(h.providerHealthy, false);
    assert.match(h.note, /NOT enforced/);
    // the portal comes back: the next probe turns the lock on again
    provider.down = false;
    await t.portal.probe();
    assert.equal((await post(b, '/api/auth/login', { email: 'reader@example.com', password: 'x' })).status, 403);
    assert.equal(t.portal.health().providerHealthy, true);
  });
});

test('1b. before the first probe has succeeded (just booted) local sign-in is available', async () => {
  await withApp({ env: ONLY, probe: false }, async (t, b) => {
    assert.equal(t.portal.onlyActive(), false);
    assert.equal((await post(b, '/api/auth/login', { email: 'x@example.com', password: 'x' })).status, 200);
  });
});

test('1b. healthy means "discovery + keys fetched OK within the last 10 minutes"', async () => {
  let clock = Date.now();
  const provider = switchable();
  await withApp({ env: ONLY, provider, now: () => clock }, async (t) => {
    assert.equal(t.portal.onlyActive(), true);
    provider.down = true;
    clock += 9 * 60 * 1000;
    await t.portal.probe();                                         // fails, but the last success is only 9 minutes old
    assert.equal(t.portal.onlyActive(), true, 'a blip does not open the door');
    clock += 2 * 60 * 1000;                                         // now 11 minutes since the last success
    assert.equal(t.portal.onlyActive(), false);
    provider.down = false;
    await t.portal.probe();
    assert.equal(t.portal.onlyActive(), true);
    assert.equal(HEALTH_FRESH_MS, 10 * 60 * 1000);
  });
});

test('1b. the probe never blocks a request, and is bounded by its timeout', async () => {
  let calls = 0;
  const hang = (url, init) => { calls++; return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))); };
  const h = createProviderHealth({ issuer: ISSUER, fetch: hang, timeoutMs: 40, intervalMs: 60000, autoStart: true, log: { warn() {}, log() {} } });
  const keepAlive = setInterval(() => {}, 20);          // Node 20 unrefs AbortSignal.timeout timers: keep the loop alive while the probe waits for its timeout
  const t0 = Date.now();
  assert.equal(h.check(), false, 'answers at once from the cache while a refresh runs in the background');
  assert.ok(Date.now() - t0 < 20, 'did not wait for the network');
  assert.equal(calls, 1, 'a background probe was kicked');
  assert.equal(await h.probe(), false, 'and it ends by itself (timeout)');
  assert.equal(h.status().lastError, 'timeout');
  clearInterval(keepAlive);
  h.stop();
});

test('1b. a discovery document for another issuer, or an empty key set, is not healthy', async () => {
  const mk = (disc, keys) => createProviderHealth({ issuer: ISSUER, autoStart: false, log: { warn() {}, log() {} },
    fetch: async (u) => ({ status: 200, text: async () => JSON.stringify(u.endsWith('openid-configuration') ? disc : keys) }) });
  const good = { issuer: ISSUER, jwks_uri: ISSUER + '/oidc/jwks' };
  assert.equal(await mk(good, { keys: [{ kid: 'a' }] }).probe(), true);
  assert.equal(await mk({ ...good, issuer: 'https://evil.test' }, { keys: [{ kid: 'a' }] }).probe(), false);
  assert.equal(await mk({ ...good, jwks_uri: 'https://evil.test/jwks' }, { keys: [{ kid: 'a' }] }).probe(), false);
  assert.equal(await mk(good, { keys: [] }).probe(), false);
  assert.equal(await mk(good, {}).probe(), false);
});

test('1c. the probe CANNOT see a wrong client secret: PORTAL_ONLY is still enforced, sign-in fails, and the admin break-glass is what remains', async () => {
  const p = fakeProvider();
  const brokenSecret = { ...p, fetch: async (u, i) => (u === ISSUER + '/oidc/token' ? { status: 401, text: async () => JSON.stringify({ error: 'invalid_client' }) } : p.fetch(u, i)) };
  await withApp({ env: ONLY, provider: brokenSecret }, async (t, b) => {
    t.store.add({ email: 'boss@example.com', role: 'admin', password_hash: hash('pw') });
    t.store.add({ email: 'reader@example.com', email_verified: true });
    assert.equal(t.portal.health().providerHealthy, true, 'discovery and keys are fine');
    assert.equal(errCode(await b.signIn(t.provider, portalClaims({ email: 'reader@example.com' }))), 'failed', 'but no real sign-in works');
    assert.equal((await post(b, '/api/auth/login', { email: 'reader@example.com', password: 'x' })).status, 403, 'and the reader is locked out');
    assert.equal((await post(b, '/api/auth/login', { email: 'boss@example.com', password: 'x' })).status, 200, 'the admin still gets in');
  });
});

/* ═══ 2. the dead end: an unverified account whose password is forgotten ═══════════════════════ */

test('2. under PORTAL_ONLY an account WITHOUT a SAI Cloud link can still use forgot / reset; a linked one is told nothing', async () => {
  await withApp({ env: ONLY }, async (t, b) => {
    t.store.add({ email: 'old@example.com', email_verified: false });
    t.store.add({ email: 'linked@example.com', portal_sub: 'u_linked00000000000' });
    t.store.add({ email: 'boss@example.com', role: 'admin', portal_sub: 'u_boss000000000000' });
    assert.deepEqual(await (await post(b, '/api/auth/forgot-password', { email: 'old@example.com' })).json(), { generic: true, sent: true });
    assert.deepEqual(await (await post(b, '/api/auth/forgot-password', { email: 'linked@example.com' })).json(), { generic: true, sent: false }, 'same generic answer, no mail');
    assert.deepEqual(await (await post(b, '/api/auth/forgot-password', { email: 'boss@example.com' })).json(), { generic: true, sent: true }, 'an admin can always get a password back');
    assert.equal((await post(b, '/api/auth/reset-password', { userId: t.store.users[1].id })).status, 403);
  });
});

test('2. reset-by-emailed-link marks the email verified, so reset-then-sign-in-with-SAI-Cloud links the account', async () => {
  await withApp({ env: ONLY }, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('forgotten') });
    // before: the portal sign-in can only ask for the (forgotten) password
    assert.equal(loc(await b.signIn(t.provider, portalClaims())), '/auth/portal/link');
    assert.equal(u.portal_sub, null);
    // the reset works under PORTAL_ONLY and verifies the address
    assert.equal((await post(b, '/api/auth/reset-password', { userId: u.id })).status, 200);
    assert.equal(u.email_verified, true);
    // after: the same sign-in links by itself
    const b2 = browser(t.base);
    assert.equal(loc(await b2.signIn(t.provider, portalClaims())), '/auth/portal/done');
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
  });
});

/* ═══ 3. a pre-registered account does not stay in the attacker's hands ═══════════════════════ */

test('3. automatic link: token_version is bumped, the local password is replaced, the attacker\'s JWT dies, the victim\'s session works', async () => {
  await withApp({}, async (t, b) => {
    // the attacker registered victim@example.com; the victim later verified the address
    const u = t.store.add({ email: 'victim@example.com', email_verified: true, password_hash: hash('attacker-knows-this') });
    const attackerJwt = jwt.sign({ userId: u.id, email: u.email, tokenVersion: 1 }, JWT_SECRET, { expiresIn: '7d' });
    const attackerGet = () => fetch(t.base + '/api/with-token', { headers: { authorization: 'Bearer ' + attackerJwt } });
    assert.equal((await attackerGet()).status, 200, 'before the link the attacker is in');

    const cb = await b.signIn(t.provider, portalClaims({ email: 'victim@example.com' }));
    assert.equal(loc(cb), '/auth/portal/done');
    assert.equal(u.portal_sub, 'u_aaaaaaaaaaaaaaaa');
    assert.equal(u.token_version, 2);
    assert.equal(await bcrypt.compare('attacker-knows-this', u.password_hash), false, 'the old password no longer opens the account');
    assert.equal((await attackerGet()).status, 401, 'the attacker\'s 7-day JWT is dead');
    assert.equal((await (await b.go('/api/probe')).json()).ok, true, 'the victim\'s own new session works');
    assert.equal(jwt.verify(b.jar.get('token').value, JWT_SECRET).tokenVersion, 2);
  });
});

test('3. password-step link: token_version is bumped and old JWTs die, but the password the person just proved is kept', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('OldPass1!') });
    const old = jwt.sign({ userId: u.id, email: u.email, tokenVersion: 1 }, JWT_SECRET, { expiresIn: '7d' });
    await b.signIn(t.provider, portalClaims());
    const before = u.password_hash;
    const ok = await post(b, '/api/auth/portal/link', { password: 'OldPass1!' });
    assert.equal(ok.status, 200);
    assert.equal(u.token_version, 2);
    assert.equal(u.password_hash, before, 'unchanged');
    assert.equal((await fetch(t.base + '/api/with-token', { headers: { authorization: 'Bearer ' + old } })).status, 401);
    assert.equal(jwt.verify((await ok.json()).token, JWT_SECRET).tokenVersion, 2);
  });
});

test('3. signing in again by sub is only a sign-in: no bump, nothing replaced', async () => {
  await withApp({}, async (t, b) => {
    const u = t.store.add({ email: 'ada@example.com', email_verified: true, password_hash: hash('x') });
    await b.signIn(t.provider, portalClaims());
    const v = u.token_version, h = u.password_hash;
    await browser(t.base).signIn(t.provider, portalClaims());
    assert.equal(u.token_version, v);
    assert.equal(u.password_hash, h);
  });
});

/* ═══ 4. case-duplicate accounts: nobody is linked by guesswork ════════════════════════════════ */

test('4. two accounts share the email: no auto-link, no session, a "contact support" page, an operator hint WITHOUT the address', async () => {
  const lines = [];
  const log = { error: (...a) => lines.push(a.join(' ')), warn: (...a) => lines.push(a.join(' ')), log() {} };
  await withApp({ log }, async (t, b) => {
    const a = t.store.add({ email: 'Ada@Example.com', email_verified: true });
    const c = t.store.add({ email: 'ada@example.com', email_verified: true });
    const cb = await b.signIn(t.provider, portalClaims());
    assert.equal(errCode(cb), 'contact_support');
    assert.ok(!b.jar.has('token'));
    assert.equal(a.portal_sub, null); assert.equal(c.portal_sub, null);
    assert.equal(t.store.users.length, 2, 'no third account either');
    assert.ok(lines.some((l) => /case-duplicates/.test(l) && /duplicateEmails\.js/.test(l)), 'the operator is told what to run');
    assert.ok(!lines.join('\n').toLowerCase().includes('ada@example.com'), 'no email in the log');
  });
});

test('4. the same rule at the password step (duplicates that appeared after the callback)', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('pw') });
  store.add({ email: 'ADA@example.com' });
  const r = await linkWithPassword(store, { userId: u.id, sub: 'u_x', email: 'ada@example.com' }, 'pw', { compare: bcrypt.compare, dummyHash: hash('d') });
  assert.equal(r.kind, OUTCOME.AMBIGUOUS_EMAIL);
  assert.equal(u.portal_sub, null);
});

test('4. over HTTP the password step answers 409 contact_support', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('pw') });
    await b.signIn(t.provider, portalClaims());
    t.store.add({ email: 'ADA@example.com' });
    const r = await post(b, '/api/auth/portal/link', { password: 'pw' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'contact_support');
    assert.ok(!b.jar.has('token'));
  });
});

test('4. the operator check prints COUNTS only, never an address, and its exit code gates the rollout', async () => {
  const counts = { users: 4, duplicateGroups: 0, accountsInDuplicateGroups: 0, linked: 0 };
  assert.match(formatCounts(counts), /OK/);
  assert.doesNotMatch(formatCounts({ ...counts, duplicateGroups: 2, accountsInDuplicateGroups: 4 }), /@/);
  const out = [];
  assert.equal(await runDuplicateCheck({ counts: async () => counts, out: (s) => out.push(s) }), 0);
  assert.equal(await runDuplicateCheck({ counts: async () => ({ ...counts, duplicateGroups: 1, accountsInDuplicateGroups: 2 }), out: (s) => out.push(s) }), 1);
  assert.ok(out.join('\n').includes('BLOCKED'));
  const wrapper = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'check-duplicate-emails.js'), 'utf8');
  assert.match(wrapper, /duplicateEmails\.js/);
});

/* ═══ 5. another SPELLING of the email must not silently create a second, empty account ════════ */

test('5. emailKey: plus-tags everywhere, dots and googlemail only on Gmail; used to detect, nothing else', () => {
  assert.equal(emailKey('Ada+Books@Example.com'), 'ada@example.com');
  assert.equal(emailKey('a.d.a@gmail.com'), 'ada@gmail.com');
  assert.equal(emailKey('Ada@GoogleMail.com'), 'ada@gmail.com');
  assert.equal(emailKey('a.da@example.com'), 'a.da@example.com', 'dots are significant elsewhere');
  assert.notEqual(emailKey('a.da@example.com'), emailKey('ada@example.com'));
});

test('5. a plus/dot variant of an existing address: NO new account, NO link, a "may already have an account" page', async () => {
  const cases = [['ada@example.com', 'ada+books@example.com'], ['ada+old@example.com', 'ada@example.com'], ['ada@gmail.com', 'a.da@gmail.com'], ['a.da@gmail.com', 'ada@googlemail.com']];
  for (const [stories, portal] of cases) {
    await withApp({}, async (t, b) => {
      const u = t.store.add({ email: stories, email_verified: true });
      const cb = await b.signIn(t.provider, portalClaims({ email: portal }));
      assert.equal(errCode(cb), 'similar_email', `${stories} vs ${portal}`);
      assert.equal(t.store.users.length, 1, 'nothing created');
      assert.equal(u.portal_sub, null, 'and nothing linked: the key only detects');
      assert.ok(!b.jar.has('token'));
      assert.deepEqual(t.audit.map((a) => a.reason), ['portal_email_similar']);
    });
  }
});

test('5. strict matching is unchanged: a genuinely different address still gets its own account; an exact match still links; closed signups win', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'a.da@example.com', email_verified: true });
    assert.equal(loc(await b.signIn(t.provider, portalClaims({ email: 'ada@example.com' }))), '/auth/portal/done');
    assert.equal(t.store.users.length, 2);
  });
  await withApp({ env: { SIGNUPS_CLOSED: '1' } }, async (t, b) => {
    t.store.add({ email: 'ada@example.com', email_verified: true });
    assert.equal(errCode(await b.signIn(t.provider, portalClaims({ email: 'ada+x@example.com' }))), 'signups_closed');
  });
});

/* ═══ 6a. change-password does not turn a 24 h session into 7 days ════════════════════════════ */

test('6a. a portal-linked user gets what is left of the session, at most 24 h; password users keep 7 days', () => {
  const now = 1_000_000;
  assert.equal(reissueLifetimeS({ exp: now + 3600, nowS: now, portalLinked: true }), 3600);
  assert.equal(reissueLifetimeS({ exp: now + 7 * 86400, nowS: now, portalLinked: true }), 86400, 'a 7-day password token held by a linked user is capped');
  assert.equal(reissueLifetimeS({ exp: now + 5, nowS: now, portalLinked: true }), 60, 'a floor, so it is not already expired');
  assert.equal(reissueLifetimeS({ exp: undefined, nowS: now, portalLinked: true }), 86400);
  assert.equal(reissueLifetimeS({ exp: now + 3600, nowS: now, portalLinked: false }), 7 * 86400);
});

/* ═══ 6b. portal sign-ups spend from the registration budget ═════════════════════════════════ */

test('6b. a NEW account asks the sign-up limiter first; an existing user\'s sign-in or link never does', async () => {
  let asked = 0;
  await withApp({ allowSignup: async () => { asked++; return false; } }, async (t, b) => {
    t.store.add({ email: 'known@example.com', email_verified: true });
    assert.equal(loc(await b.signIn(t.provider, portalClaims({ sub: 'u_known0000000000', email: 'known@example.com' }))), '/auth/portal/done');
    assert.equal(asked, 0, 'linking an existing account is not a sign-up');
    const b2 = browser(t.base);
    const cb = await b2.signIn(t.provider, portalClaims({ sub: 'u_new00000000000a', email: 'new@example.com' }));
    assert.equal(errCode(cb), 'rate_limited');
    assert.equal(asked, 1);
    assert.equal(t.store.users.length, 1, 'nothing created');
    assert.ok(t.audit.some((a) => a.reason === 'portal_signup_rate_limited'));
  });
  await withApp({ allowSignup: async () => true }, async (t, b) => {
    assert.equal(loc(await b.signIn(t.provider, portalClaims())), '/auth/portal/done');
    assert.equal(t.store.users.length, 1);
  });
});

test('6b. index.js spends the portal sign-ups from the SAME counter as POST /api/auth/register', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.js'), 'utf8');
  assert.match(src, /const registrationLimiter = rateLimit\(\{[^}]*store: registrationStore/s);
  assert.match(src, /allowSignup: async \(req\) => \(await registrationStore\.increment\(`register:\$\{req\.ip\}`\)\)\.totalHits <= REGISTRATION_MAX/);
  assert.match(src, /keyGenerator: \(req\) => \{\s*return `register:\$\{req\.ip\}`;/);
});

/* ═══ 6c. the hand-off is one-shot ═══════════════════════════════════════════════════════════ */

test('6c. the second call to the hand-off is 410, even inside the two minutes; the token has a jti', async () => {
  await withApp({}, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    assert.ok(jwt.verify(b.jar.get('token').value, JWT_SECRET).jti);
    const first = await post(b, '/api/auth/portal/session');
    assert.equal(first.status, 200);
    const second = await post(b, '/api/auth/portal/session');
    assert.equal(second.status, 410);
    assert.equal((await second.json()).code, 'used');
    // a copy of the cookie in another browser is just as late
    const thief = browser(t.base);
    thief.jar.set('token', { value: b.jar.get('token').value, attrs: [], raw: '' });
    assert.equal((await post(thief, '/api/auth/portal/session')).status, 410);
  });
});

test('6c. each portal sign-in has its own one hand-off; a failed check does not burn it; a token without a jti is refused', async () => {
  let clock = Date.now();
  await withApp({ now: () => clock }, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    const cookie = b.jar.get('token').value;
    const b2 = browser(t.base);
    b2.jar.set('token', { value: jwt.sign({ userId: t.store.users[0].id, tokenVersion: 99, via: 'portal', jti: 'x' }, JWT_SECRET), attrs: [], raw: '' });
    assert.equal((await post(b2, '/api/auth/portal/session')).status, 401, 'stale tokenVersion');
    assert.equal((await post(b, '/api/auth/portal/session')).status, 200, 'the real one is still available');
    const noJti = browser(t.base);
    noJti.jar.set('token', { value: jwt.sign({ userId: t.store.users[0].id, tokenVersion: 2, via: 'portal' }, JWT_SECRET), attrs: [], raw: '' });
    assert.equal((await post(noJti, '/api/auth/portal/session')).status, 401);
    // and another sign-in (a new session, a new jti) can be collected once again
    const again = browser(t.base);
    await again.signIn(t.provider, portalClaims());
    assert.notEqual(again.jar.get('token').value, cookie);
    assert.equal((await post(again, '/api/auth/portal/session')).status, 200);
    assert.equal((await post(again, '/api/auth/portal/session')).status, 410);
  });
});

test('6c. the once-store: first use wins, in this process and (when Redis is there) across replicas; Redis errors fall back', async () => {
  const mem = createOnceStore({ log: { warn() {} } });
  assert.equal(await mem.consume('a'), true);
  assert.equal(await mem.consume('a'), false);
  assert.equal(await mem.consume(''), false);
  const keys = new Set();
  const redis = { set: async (k, v, o) => { assert.deepEqual(o, { NX: true, EX: 300 }); if (keys.has(k)) return null; keys.add(k); return 'OK'; } };
  const a = createOnceStore({ redis: () => redis }), b = createOnceStore({ redis: () => redis });
  assert.equal(await a.consume('j'), true);
  assert.equal(await b.consume('j'), false, 'another replica sees it');
  const broken = createOnceStore({ redis: () => ({ set: async () => { throw new Error('down'); } }), log: { warn() {} } });
  assert.equal(await broken.consume('k'), true);
  assert.equal(await broken.consume('k'), false);
  let clock = 0;
  const ttl = createOnceStore({ now: () => clock, ttlS: 10 });
  assert.equal(await ttl.consume('t'), true);
  clock = 11_000;
  assert.equal(await ttl.consume('t'), true, 'forgotten after the ttl (the JWT itself is long stale by then)');
});

/* ═══ 6d. documented limit ═══════════════════════════════════════════════════════════════════ */

test('6d. there is no verified_at column on users, so a stale "verified" cannot be aged out (documented, not silently ignored)', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db');
  const sql = fs.readdirSync(path.join(dir, 'migrations')).map((f) => fs.readFileSync(path.join(dir, 'migrations', f), 'utf8')).join('\n') + fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');
  assert.doesNotMatch(sql, /email_verified_at|verified_at/i, 'if a verified_at column is ever added, auto-link must start using it (docs/SAI-CLOUD-LOGIN.md)');
  const doc = fs.readFileSync(path.join(dir, '..', '..', 'docs', 'SAI-CLOUD-LOGIN.md'), 'utf8');
  assert.match(doc, /no `?verified_at`?/i);
});

/* ═══ 6e. portal_sub is written by the link path only ═════════════════════════════════════════ */

test('6e. generic user updates cannot carry portal_sub / portal_linked_at, and no handler writes back a spread copy of req.user', () => {
  const mapped = UserDataService.mapUserFieldsToPostgres({ name: 'n', portal_sub: 'u_stale', portal_linked_at: new Date(), password: 'h', token_version: 9 });
  assert.deepEqual(Object.keys(mapped).sort(), ['name', 'password_hash']);
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.js'), 'utf8');
  assert.doesNotMatch(src, /updateUser\([^)]*\.\.\.(req\.user|user)\b/);
  assert.doesNotMatch(src, /const updatedUser = \{\s*\.\.\.(req\.user|user),/);
  const repo = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'repositories', 'UserRepository.js'), 'utf8');
  assert.match(repo, /key !== 'portal_sub' && key !== 'portal_linked_at'/);
});

/* ═══ resolveAccount-level checks for the new outcomes ═══════════════════════════════════════ */

test('resolveAccount: ambiguous and similar are decided before anything is written', async () => {
  const who = (over = {}) => ({ sub: 'u_1', emailVerified: true, verifiedEmail: 'ada@example.com', name: 'Ada', ...over });
  const store = memoryStore();
  store.add({ email: 'ada@example.com', email_verified: true });
  store.add({ email: 'Ada@Example.com', email_verified: true });
  assert.equal((await resolveAccount(store, who(), { signupsOpen: true })).kind, OUTCOME.AMBIGUOUS_EMAIL);
  assert.ok(store.users.every((u) => u.portal_sub === null));
  const s2 = memoryStore();
  s2.add({ email: 'ada+a@example.com', email_verified: true });
  assert.equal((await resolveAccount(s2, who(), { signupsOpen: true })).kind, OUTCOME.SIMILAR_EMAIL);
  assert.equal(s2.users.length, 1);
});
