// The second independent review of "Sign in with SAI Cloud": one block of tests per finding.
// (Finding 3, the limiter order, is on the real server in server/tests/regress.test.js; findings 4 and 5 are text and scripts.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser, portalClaims } from './harness.js';
import { resolveAccount, OUTCOME } from '../accounts.js';
import { createOnceStore } from '../session.js';
import { memoryStore } from './harness.js';

const loc = (res) => res.headers.get('location');
const errCode = (res) => new URL(loc(res), 'https://x.test').searchParams.get('code');
const post = (b, p, body = {}) => b.go(p, { method: 'POST', body });
async function withApp(opts, fn) {
  const t = await startApp(opts);
  try { await fn(t, browser(t.base)); } finally { await t.close(); }
}

/* ═══ 1. an unverified lookalike must not block the real person ═══════════════════════════════ */

test('1. ATTACK: a squatter registers victim+x@ locally (unverified, no mailbox); the real victim@ can still sign up with SAI Cloud', async () => {
  await withApp({}, async (t, b) => {
    t.store.add({ email: 'victim+x@gmail.com', email_verified: false });                 // what anyone can do via POST /api/auth/register
    t.store.add({ email: 'v.ictim@gmail.com', email_verified: false });
    const cb = await b.signIn(t.provider, portalClaims({ email: 'victim@gmail.com' }));
    assert.equal(loc(cb), '/auth/portal/done', 'not similar_email');
    const mine = t.store.users.find((u) => u.email === 'victim@gmail.com');
    assert.ok(mine && mine.portal_sub, 'the real person got their own, linked account');
    assert.equal(t.store.users.filter((u) => u.portal_sub).length, 1, 'the squatters were not linked to anything');
  });
});

test('1. a lookalike that proves its address still blocks: Stories-verified, or already portal-linked', async () => {
  const cases = [{ email_verified: true }, { email_verified: false, portal_sub: 'u_someoneelse000001' }, { email_verified: true, portal_sub: 'u_someoneelse000002' }];
  for (const extra of cases) {
    await withApp({}, async (t, b) => {
      t.store.add({ email: 'ada+books@example.com', ...extra });
      assert.equal(errCode(await b.signIn(t.provider, portalClaims({ email: 'ada@example.com' }))), 'similar_email', JSON.stringify(extra));
      assert.equal(t.store.users.length, 1, 'nothing created');
    });
  }
});

test('1. only unverified lookalikes: a NEW account is made; a verified one among them still blocks, whatever its position', async () => {
  const who = (sub) => ({ sub, verifiedEmail: 'ada@gmail.com', emailVerified: true, name: 'Ada' });
  const lookalikes = [{ id: 'a', email: 'a.da+1@gmail.com', email_verified: false }, { id: 'b', email: 'a.da+2@gmail.com', email_verified: false }];
  const fake = (rows) => ({ ...memoryStore(), findUsersByEmailKey: async () => rows });
  assert.equal((await resolveAccount(fake(lookalikes), who('u_new0000000000001'), { signupsOpen: true })).kind, OUTCOME.SIGNED_IN);
  const verified = { id: 'c', email: 'ada+real@gmail.com', email_verified: true };
  assert.equal((await resolveAccount(fake([...lookalikes, verified]), who('u_new0000000000002'), { signupsOpen: true })).kind, OUTCOME.SIMILAR_EMAIL);
  assert.equal((await resolveAccount(fake([verified, ...lookalikes]), who('u_new0000000000003'), { signupsOpen: true })).kind, OUTCOME.SIMILAR_EMAIL);
});

/* ═══ 2. Redis down: the hand-off fails open instead of hanging ═══════════════════════════════ */

const hung = () => ({ set: () => new Promise(() => {}) });                       // node-redis v4 while reconnecting: queued, never answers
const throwing = () => ({ set: async () => { throw new Error('connect ECONNREFUSED redis.invalid:6379'); } });
const sink = () => { const lines = []; return { lines, warn: (...a) => lines.push(a.join(' ')) }; };

test('2. a hung Redis: consume() answers within the timeout from process memory, once, and the second call is false', async () => {
  const log = sink();
  const s = createOnceStore({ redis: hung, log, redisTimeoutMs: 40 });
  const t0 = Date.now();
  assert.equal(await s.consume('jti-1'), true);
  assert.ok(Date.now() - t0 < 1000, 'did not hang');
  assert.equal(await s.consume('jti-1'), false, 'one-shot still holds on this replica');
  assert.equal(log.lines.length, 1, 'one warning for two timeouts (rate limited)');
});

test('2. a throwing Redis: falls back the same way, and the warning is rate limited and carries no key or token', async () => {
  const log = sink();
  let clock = 1_000_000;
  const s = createOnceStore({ redis: throwing, log, now: () => clock, warnEveryMs: 60_000 });
  assert.equal(await s.consume('jti-secret-123'), true);
  assert.equal(await s.consume('jti-secret-123'), false);
  assert.equal(await s.consume('jti-other'), true);
  assert.equal(log.lines.length, 1, 'three failures, one warning');
  assert.ok(!/jti-|stories:portal-handoff|ECONNREFUSED|redis\.invalid/.test(log.lines[0]), 'no key, no jti, no connection detail: ' + log.lines[0]);
  clock += 61_000;
  await s.consume('jti-third');
  assert.equal(log.lines.length, 2, 'warns again after the interval');
});

test('2. a healthy Redis still uses the documented key and a 300 s TTL', async () => {
  const calls = [];
  const redis = { set: async (k, v, o) => { calls.push([k, o]); return 'OK'; } };
  const s = createOnceStore({ redis: () => redis });
  assert.equal(await s.consume('abc'), true);
  assert.deepEqual(calls, [['stories:portal-handoff:abc', { NX: true, EX: 300 }]]);
});

test('2. over HTTP with a hung Redis the hand-off answers 200 then 410 (no >4 s hang)', async () => {
  const handoff = createOnceStore({ redis: hung, log: sink(), redisTimeoutMs: 50 });
  await withApp({ handoff }, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    const t0 = Date.now();
    assert.equal((await post(b, '/api/auth/portal/session')).status, 200);
    assert.ok(Date.now() - t0 < 2000, 'answered promptly');
    assert.equal((await post(b, '/api/auth/portal/session')).status, 410);
  });
});

test('2. over HTTP with a throwing Redis the hand-off answers 200 then 410', async () => {
  const handoff = createOnceStore({ redis: throwing, log: sink() });
  await withApp({ handoff }, async (t, b) => {
    await b.signIn(t.provider, portalClaims());
    assert.equal((await post(b, '/api/auth/portal/session')).status, 200);
    assert.equal((await post(b, '/api/auth/portal/session')).status, 410);
  });
});
