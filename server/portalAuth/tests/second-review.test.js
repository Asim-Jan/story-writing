// The second independent review of "Sign in with SAI Cloud": one block of tests per finding.
// (Finding 3, the limiter order, is on the real server in server/tests/regress.test.js; findings 4 and 5 are text and scripts.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { startApp, browser, portalClaims } from './harness.js';
import { resolveAccount, OUTCOME } from '../accounts.js';
import { createOnceStore } from '../session.js';
import { missingPgEnv, pgConfigFromEnv } from '../../../scripts/pgEnv.js';
import { MediaStorage } from '../../services/mediaStorage.js';
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

/* ═══ 4. the rollback text tells the truth about linked accounts ═════════════════════════════ */

test('4. the down-migration header says auto-linked accounts LOST their password hash and need "Forgot password"', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const down = fs.readFileSync(path.join(here, '..', '..', 'db', 'migrations-down', 'z106_portal_identity.down.sql'), 'utf8');
  const header = down.split('\n').filter((l) => l.startsWith('--')).join('\n');
  assert.match(header, /LINKED AUTOMATICALLY/);
  assert.match(header, /REPLACED by an\s+--\s+unusable one/);
  assert.match(header, /linked accounts need "Forgot password"/);
  assert.doesNotMatch(header, /Users linked to SAI Cloud keep their account, books and password hash/, 'the old, wrong claim is gone');
});

/* ═══ 5. no credential defaults in a public repo ═════════════════════════════════════════════ */

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB_SCRIPTS = ['check-postgres-data', 'clear-postgres-data', 'run-migration', 'test-book-api'];

test('5. each database maintenance script REQUIRES the four POSTGRES_* variables and exits 1 naming the missing ones', () => {
  for (const name of DB_SCRIPTS) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', name + '.js')], { cwd: os.tmpdir(), env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 1, `${name} exits 1 (got ${r.status}, signal ${r.signal})`);
    const out = r.stdout + r.stderr;
    assert.match(out, /Missing required environment variable\(s\): POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB/, name);
    assert.doesNotMatch(out, /amazonaws|rds\./i, 'no stale hostname either');
  }
  // partially set: only the missing names are listed, and no value is echoed
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'check-postgres-data.js')], { cwd: os.tmpdir(), env: { PATH: process.env.PATH, POSTGRES_HOST: '127.0.0.1', POSTGRES_PASSWORD: 'sentinel-not-echoed' }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /POSTGRES_USER, POSTGRES_DB\n/);
  assert.doesNotMatch(r.stdout + r.stderr, /sentinel-not-echoed/);
});

test('5. pgConfigFromEnv: all four set -> a config (port defaults to 5432); one empty -> missing', () => {
  const env = { POSTGRES_HOST: 'h', POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p', POSTGRES_DB: 'd' };
  assert.deepEqual(missingPgEnv(env), []);
  const c = pgConfigFromEnv(env);
  assert.deepEqual([c.host, c.port, c.user, c.database], ['h', 5432, 'u', 'd']);
  assert.deepEqual(missingPgEnv({ ...env, POSTGRES_PASSWORD: '  ' }), ['POSTGRES_PASSWORD']);
});

test('5. the scripts carry no fallback literal after a POSTGRES_* variable, and the old RDS host is gone from tracked scripts', () => {
  for (const name of DB_SCRIPTS) {
    const src = fs.readFileSync(path.join(REPO, 'scripts', name + '.js'), 'utf8');
    assert.doesNotMatch(src, /POSTGRES_(HOST|USER|PASSWORD|DB)\s*\|\|/, name);
    assert.doesNotMatch(src, /amazonaws/i, name);
  }
});

test('5. MinIO: production REQUIRES its own credentials (no built-in pair); development keeps its convenience default', () => {
  const keep = { ...process.env };
  const restore = () => { for (const k of ['NODE_ENV', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'AWS_S3_BUCKET']) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } };
  try {
    delete process.env.AWS_S3_BUCKET; delete process.env.MINIO_ACCESS_KEY; delete process.env.MINIO_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    assert.throws(() => new MediaStorage(), /MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set in production/);
    process.env.MINIO_ACCESS_KEY = 'only-one';
    assert.throws(() => new MediaStorage(), /must be set in production/);
    process.env.MINIO_SECRET_KEY = 'both-present';
    assert.doesNotThrow(() => new MediaStorage());
    delete process.env.MINIO_ACCESS_KEY; delete process.env.MINIO_SECRET_KEY;
    process.env.NODE_ENV = 'development';
    assert.doesNotThrow(() => new MediaStorage(), 'development still works with nothing set');
    process.env.NODE_ENV = 'production'; process.env.AWS_S3_BUCKET = 'b';
    assert.doesNotThrow(() => new MediaStorage(), 'S3 mode needs no MinIO keys');
  } finally { restore(); }
});
