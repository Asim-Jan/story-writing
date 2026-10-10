// The identity-events receiver + erasure, against a REAL throwaway Postgres (and a fake portal + fake MinIO +
// a tiny in-memory Redis). The contract is sai-cluster/manifests/sai-portal/STORIES-DELETION.md; the tests pin
// every rule it names. SKIPPED unless a throwaway Postgres is named (it creates and drops its own database):
//   PORTAL_TEST_PG_HOST=127.0.0.1 PORTAL_TEST_PG_PORT=57432 PORTAL_TEST_PG_USER=postgres PORTAL_TEST_PG_PASSWORD=x \
//     node --test server/portalAuth/tests/identityEvents.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { fileURLToPath } from 'url';
import pg from 'pg';

const E = process.env;
const enabled = ['127.0.0.1', 'localhost'].includes(E.PORTAL_TEST_PG_HOST) && E.PORTAL_TEST_PG_USER;
const skip = enabled ? false : 'set PORTAL_TEST_PG_HOST=127.0.0.1 (+ _PORT _USER _PASSWORD) to run against a throwaway Postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const DB = 'identity_ev_' + process.pid;
const conn = { host: E.PORTAL_TEST_PG_HOST, port: Number(E.PORTAL_TEST_PG_PORT || 5432), user: E.PORTAL_TEST_PG_USER, password: E.PORTAL_TEST_PG_PASSWORD };
let admin, pool, app, srv, port;
let subjectCheckAnswer = { gone: [], disabled: [] };      // what the fake portal answers
let subjectCheckCalls = 0;
let failNextDelete = false;                               // the fake MinIO's next remove throws (non-404)
const removedObjects = [];
const jwksLog = [];

/* ── the fake portal: signs real ES256 event tokens and serves the JWKS ─────────────────────────── */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const KID = 'portal-test-key';
const b64u = (b) => Buffer.from(b).toString('base64url');
const signEvent = (claims) => {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'secevent+jwt', kid: KID }));
  const p = b64u(JSON.stringify(claims));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return h + '.' + p + '.' + b64u(sig);
};
const ISS = 'https://portal.test';
let jtiN = 0;
const nextJti = () => 'jti_' + crypto.randomBytes(12).toString('hex');
const evtId = () => 'evt_' + crypto.randomBytes(12).toString('hex');
const deletedEvent = (sub, { erase = 'now' } = {}) => ({
  'https://schemas.solutionsai.co.uk/event/account-deleted': { evt: evtId(), at: Math.floor(Date.now() / 1000), erase },
});

/* ── a tiny in-memory Redis: only what the eraser touches ───────────────────────────────────────── */
function fakeRedis() {
  const m = new Map(), sets = new Map();
  const match = (k, pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(k);
  return {
    async scan(cursor, opts, pat) { const all = [...m.keys(), ...sets.keys()].filter(k => match(k, pat)); return ['0', all]; },
    async del(...ks) { let n = 0; for (const k of ks) { if (m.delete(k)) n++; if (sets.delete(k)) n++; } return n; },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); },
    async sMembers(k) { return [...(sets.get(k) || [])]; },
    async sAdd(k, ...v) { const s = sets.get(k) || new Set(); v.forEach(x => s.add(x)); sets.set(k, s); },
    _m: m, _sets: sets,
  };
}

/* ── the fake storage (MinIO): records removals, can fail on cue ────────────────────────────────── */
const fakeStorage = {
  async delete(bucketType, filename) {
    if (failNextDelete) { failNextDelete = false; throw new Error('minio exploded'); }
    removedObjects.push(bucketType + '/' + filename);
  },
};

before(async () => {
  if (skip) return;
  admin = new pg.Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  pool = new pg.Pool({ ...conn, database: DB });
  // the real schema + every migration, in order (a fresh install's shape)
  await pool.query(fs.readFileSync(path.join(serverDir, 'db', 'schema.sql'), 'utf8'));
  // media_owners is boot-created (utils/mediaMapping.js), not in schema.sql: create its exact shape here
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_owners (
      bucket_type VARCHAR(20)  NOT NULL,
      filename    VARCHAR(500) NOT NULL,
      owner_id    UUID         NOT NULL,
      book_id     UUID,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bucket_type, filename)
    );
    CREATE INDEX IF NOT EXISTS idx_media_owners_owner ON media_owners(owner_id);
    CREATE INDEX IF NOT EXISTS idx_media_owners_book ON media_owners(book_id);`);
  const mdir = path.join(serverDir, 'db', 'migrations');
  for (const f of fs.readdirSync(mdir).filter(f => f.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(mdir, f), 'utf8'));
  }
  // the receiver on a real express app (no cookie/session needed: it is a raw-body route)
  const { createIdentityEvents } = await import('../identityEvents.js');
  const { createClient } = await import(path.join(serverDir, 'vendor', 'sai-auth-client', 'index.cjs'));
  const client = createClient({
    issuer: ISS, clientId: 'stories', clientSecret: 'client-secret-for-tests',
    redirectUri: 'https://stories.test/auth/portal/callback', cookieSecret: crypto.randomBytes(32).toString('base64'),
    fetch: async (url) => {
      jwksLog.push(String(url));
      if (String(url).endsWith('/oidc/jwks')) return { status: 200, text: async () => JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: KID, use: 'sig', alg: 'ES256' }] }) };
      return { status: 200, text: async () => JSON.stringify({ issuer: ISS, authorization_endpoint: ISS + '/oidc/authorize', token_endpoint: ISS + '/oidc/token', jwks_uri: ISS + '/oidc/jwks' }) };
    },
    jwksMinRefreshS: 0,
  });
  const redis = fakeRedis();
  const handler = createIdentityEvents({
    pool, storage: fakeStorage, redisClient: redis, client, appSecret: 's'.repeat(40),
    portalBase: 'http://portal-app.test', fetch: async (url, init) => {
      subjectCheckCalls++;
      return { status: 200, json: async () => subjectCheckAnswer };
    },
  });
  app = express();
  app.post('/auth/events', (req, res) => handler(req, res));
  srv = http.createServer(app);
  await new Promise(r => { srv.listen(0, r); });
  port = srv.address().port;
});

after(async () => {
  if (skip) { console.log('SKIP: ' + skip); return; }
  await pool.end();
  await admin.query(`DROP DATABASE ${DB}`);
  await admin.end();
  srv && srv.close();
});

const deliver = async (token, { type = 'application/secevent+jwt', xff } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}/auth/events`, {
    method: 'POST', headers: { 'content-type': type, ...(xff ? { 'x-forwarded-for': '1.2.3.4' } : {}) }, body: token,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const deliverDeleted = (sub, opts) => deliver(signEvent({
  iss: ISS, aud: 'stories', sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
  jti: nextJti(), events: deletedEvent(sub),
}), opts);

/* fixture: two people, each with a book, a chapter (+version), a media row, a media_owner + object, settings, keys */
let A = {}, B = {};
const seed = async () => {
  await pool.query(`DELETE FROM users`);                 // cascades every user-owned table
  await pool.query(`DELETE FROM media_owners`);          // no FK to users: wiped explicitly
  await pool.query(`DELETE FROM identity_events`);       // likewise (evt ids stay unique per test)
  const mk = async (email, sub, name) => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, tier, status, portal_sub, portal_linked_at, email_verified)
       VALUES ($1, $2, 'x', 'user', 'free', 'active', $3, NOW(), TRUE) RETURNING *`,
      [email, name, sub]);
    const { rows: [b] } = await pool.query(`INSERT INTO books (owner_id, title, version, transcripts) VALUES ($1, $2, 1, '{}'::jsonb) RETURNING *`, [u.id, 'Book of ' + name]);
    const { rows: [c] } = await pool.query(`INSERT INTO chapters (book_id, chapter_number, version, title, content) VALUES ($1, 1, 1, 'One', 'words') RETURNING *`, [b.id]);
    await pool.query(`INSERT INTO chapter_versions (chapter_id, version_number, content, created_by) VALUES ($1, 1, 'words', $2)`, [c.id, u.id]);
    await pool.query(`INSERT INTO media (book_id, media_type, filename, storage_path, bucket) VALUES ($1, 'image', 'x.png', 'images/x.png', 'book-images')`, [b.id]);
    await pool.query(`INSERT INTO media_owners (book_id, bucket_type, owner_id, filename) VALUES ($1, 'images', $2, $3)`, [b.id, u.id, 'img-' + u.id + '.png']);
    await pool.query(`INSERT INTO user_settings (user_id, preferences) VALUES ($1, '{"a":1}'::jsonb)`, [u.id]);
    await pool.query(`INSERT INTO custom_voices (owner_id, name, sample_filename, duration_sec, consent_at) VALUES ($1, 'voice', 'v.wav', 3, NOW())`, [u.id]);
    await pool.query(`INSERT INTO payments (user_id, amount, currency, status, stripe_payment_intent_id) VALUES ($1, 999, 'usd', 'succeeded', $2)`, [u.id, 'pi_' + u.id]);
    await pool.query(`INSERT INTO subscriptions (user_id, tier, status, stripe_subscription_id, stripe_customer_id, current_period_start, current_period_end) VALUES ($1, 'premium', 'active', $2, $3, NOW(), NOW() + INTERVAL '30 days')`, [u.id, 'sub_' + u.id, 'cus_' + u.id]);
    return u;
  };
  A = { user: await mk('a@x.com', 'u_' + 'a'.repeat(16), 'A'), key: 'u_' + 'a'.repeat(16) };
  B = { user: await mk('b@x.com', 'u_' + 'b'.repeat(16), 'B'), key: 'u_' + 'b'.repeat(16) };
  removedObjects.length = 0;
};
const counts = async () => {
  const q = async (sql) => Number((await pool.query(sql)).rows[0].n);   // pg COUNT returns a STRING (bigint)
  return {
    users: await q(`SELECT COUNT(*) n FROM users`),
    books: await q(`SELECT COUNT(*) n FROM books`),
    chapters: await q(`SELECT COUNT(*) n FROM chapters`),
    media: await q(`SELECT COUNT(*) n FROM media`),
    owners: await q(`SELECT COUNT(*) n FROM media_owners`),
    payments: await q(`SELECT COUNT(*) n FROM payments`),
    subs: await q(`SELECT COUNT(*) n FROM subscriptions`),
    settings: await q(`SELECT COUNT(*) n FROM user_settings`),
    events: await q(`SELECT COUNT(*) n FROM identity_events`),
  };
};

test('the FK map the eraser relies on matches the REAL schema (every erased table has that users FK)', { skip }, async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT conrelid::regclass::text t FROM pg_constraint WHERE contype='f' AND confrelid='users'::regclass`);
  const withFk = new Set(rows.map(r => r.t));
  const { USER_TABLES } = await import('../erasure.js');
  const missing = USER_TABLES.filter(({ t }) => !withFk.has(t));
  assert.deepEqual(missing.map(x => x.t), [], 'tables the eraser deletes that have NO users FK (schema drift): ' + missing.map(x => x.t).join(','));
  for (const child of (await import('../erasure.js')).CASCADE_CHILDREN) {
    const parent = { chapters: 'books', chapter_versions: 'chapters', media: ['books', 'chapters'] }[child];
    const ps = Array.isArray(parent) ? parent : [parent];
    const ok = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid=$1::regclass AND confrelid=ANY($2::regclass[]) AND confdeltype='c' LIMIT 1`,
      [child, ps]);
    assert(ok.rows.length, `${child} must cascade from ${ps.join('/')} (the eraser relies on it)`);
  }
});

test('a deleted account: everything of the person is gone, the other person is untouched, money rows keep their amounts', { skip }, async () => {
  await seed();
  subjectCheckAnswer = { gone: [A.key], disabled: [] };
  const r = await deliverDeleted(A.key);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const c = await counts();
  assert.equal(c.users, 2, 'the user row stays as a tombstone (money FKs need it)');
  assert.equal(c.books, 1, 'only B keeps a book');
  assert.equal(c.chapters, 1, 'only B keeps a chapter (cascade took A\'s)');
  assert.equal(c.media, 1, 'only B keeps media rows');
  assert.equal(c.owners, 1, 'A\'s media_owners row is gone');
  assert.equal(c.settings, 1, 'A\'s settings are gone');
  assert.deepEqual(removedObjects, ['images/img-' + A.user.id + '.png'], 'exactly A\'s object was removed');
  assert.equal(c.payments, 2, 'money rows are NOT deleted');
  assert.equal(c.subs, 2, 'money rows are NOT deleted');
  const { rows: [pa] } = await pool.query(`SELECT amount, user_id FROM payments WHERE user_id = $1`, [A.user.id]);
  assert.equal(Number(pa.amount), 999, 'the amount survives (cents; integer column)');
  const { rows: [ua] } = await pool.query(`SELECT status, email, name, portal_sub, password_hash, email_verified FROM users WHERE id = $1`, [A.user.id]);
  assert.equal(ua.status, 'erased');
  assert.equal(ua.portal_sub, null, 'the person is unreachable by their sub afterwards');
  assert.ok(/^erased-.*@invalid\.invalid$/.test(ua.email), 'the email is pseudonymised: ' + ua.email);
  assert.equal(ua.name, 'Erased account');
  assert.ok(ua.password_hash.startsWith('$2'), 'the password is replaced by one nobody knows');
  assert.equal(ua.email_verified, false);
  const { rows: [ub] } = await pool.query(`SELECT status, portal_sub, email FROM users WHERE id = $1`, [B.user.id]);
  assert.equal(ub.status, 'active');
  assert.equal(ub.portal_sub, B.key, 'B is untouched');
  assert.equal(ub.email, 'b@x.com');
  assert.equal(c.events, 1, 'the deletion evt is recorded (forever)');
  const { rows: [ev] } = await pool.query(`SELECT type, sub FROM identity_events`);
  assert.equal(ev.type, 'account-deleted');
});

test('the same evt again is a no-op 202; a fresh evt for an erased sub is a no-op 202; an unknown sub is a no-op 202', { skip }, async () => {
  await seed();
  subjectCheckAnswer = { gone: [A.key], disabled: [] };
  const token = (sub, events) => signEvent({ iss: ISS, aud: 'stories', sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, jti: nextJti(), events });
  const first = await deliver(token(A.key, deletedEvent(A.key)));
  assert.equal(first.status, 202);
  const again = await deliver(token(A.key, { 'https://schemas.solutionsai.co.uk/event/account-deleted': { evt: JSON.parse(Buffer.from(token(A.key, deletedEvent(A.key)).split('.')[1], 'base64url')).events['https://schemas.solutionsai.co.uk/event/account-deleted'].evt, at: 1 } }));
  assert.equal(again.status, 202, 'the same evt = 202');
  const fresh = await deliver(token(A.key, deletedEvent(A.key)));
  assert.equal(fresh.status, 202, 'a NEW evt for an already-erased sub = 202 that changes nothing');
  subjectCheckAnswer = { gone: ['u_' + 'f'.repeat(16)], disabled: [] };   // the portal says this stranger is gone too
  const unknown = await deliver(token('u_' + 'f'.repeat(16), deletedEvent('u_' + 'f'.repeat(16))));
  assert.equal(unknown.status, 202, 'a sub Stories never had = 202 (idempotent, not a 404)');
  assert.equal((await counts()).users, 2, 'nothing changed');
});

test('a forged token, a wrong aud, an expired token and a wrong typ are 400 and erase NOTHING', { skip }, async () => {
  await seed();
  const before = await counts();
  const base = { iss: ISS, sub: A.key, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, jti: nextJti(), events: deletedEvent(A.key) };
  // forged (signed by us, but aud tells the truth): a REAL signature the portal did not make — use a second key
  const { privateKey: pk2 } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const forge = (claims, key = privateKey) => {
    const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'secevent+jwt', kid: KID }));
    const p = b64u(JSON.stringify(claims));
    return h + '.' + p + '.' + b64u(crypto.sign('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' }));
  };
  assert.equal((await deliver(forge(base, pk2))).status, 400, 'a wrong signature is 400');
  assert.equal((await deliver(forge({ ...base, aud: 'drive' }))).status, 400, 'an event for another app is 400');
  assert.equal((await deliver(forge({ ...base, iat: Math.floor(Date.now() / 1000) - 400, exp: Math.floor(Date.now() / 1000) + 300 }))).status, 400, 'an old iat is 400');
  const wrongTyp = (() => { const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID })); const p = b64u(JSON.stringify(base)); return h + '.' + p + '.' + b64u(crypto.sign('sha256', Buffer.from(h + '.' + p), { key: privateKey, dsaEncoding: 'ieee-p1363' })); })();
  assert.equal((await deliver(wrongTyp)).status, 400, 'an ID-token typ is never an event');
  assert.equal((await deliver(forge(base), { type: 'application/json' })).status, 415, 'a wrong content-type is 415');
  assert.deepEqual(await counts(), before, 'nothing was erased by any of them');
});

test('subjects/check says ok (or cannot be reached): nothing is erased and the answer is 503', { skip }, async () => {
  await seed();
  subjectCheckAnswer = { gone: [], disabled: [] };
  const r = await deliverDeleted(A.key);
  assert.equal(r.status, 503, 'not gone = retry');
  assert.equal((await counts()).users, 2, 'nobody was touched');
  assert.equal((await counts()).books, 2);
  subjectCheckAnswer = { gone: 'yes' };                       // a malformed answer must never become "ok"
  const r2 = await deliverDeleted(A.key);
  assert.equal(r2.status, 503, 'an unreadable portal answer = 503, never an erase');
  assert.equal((await counts()).books, 2);
});

test('an erase that fails half-way answers 5xx and a retry finishes it (the object removal is retried)', { skip }, async () => {
  await seed();
  subjectCheckAnswer = { gone: [A.key], disabled: [] };
  failNextDelete = true;
  const r = await deliverDeleted(A.key);
  assert.equal(r.status, 500, 'a failed erase is a 5xx, never "done"');
  assert.equal((await counts()).users, 2, 'the user row is untouched (the transaction rolled back)');
  assert.equal((await counts()).owners, 2, 'the media_owners row is untouched');
  assert.ok(!removedObjects.includes('images/img-' + A.user.id + '.png'), 'the failed object was NOT removed (the erase stops before its rows move)');
  const r2 = await deliverDeleted(A.key);
  assert.equal(r2.status, 202, 'the retry finishes the erase');
  assert.equal((await counts()).owners, 1);
  assert.equal((await counts()).books, 1);
});

test('a request through a proxy (X-Forwarded-For) gets a stranger\'s 404', { skip }, async () => {
  const r = await deliverDeleted(A.key, { xff: true });
  assert.equal(r.status, 404);
});

test('disabled then enabled: sign-in blocks, sessions die, an erased account is never resurrected', { skip }, async () => {
  await seed();
  const mk = (type, sub, at) => {
    const uri = { 'account-disabled': 'https://schemas.solutionsai.co.uk/event/account-disabled', 'account-enabled': 'https://schemas.solutionsai.co.uk/event/account-enabled', 'backchannel-logout': 'http://schemas.openid.net/event/backchannel-logout' }[type];
    return signEvent({ iss: ISS, aud: 'stories', sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, jti: nextJti(), events: { [uri]: { evt: evtId(), at } } });
  };
  const { rows: [u0] } = await pool.query(`SELECT token_version FROM users WHERE portal_sub = $1`, [A.key]);
  let r = await deliver(mk('account-disabled', A.key, 1000));
  assert.equal(r.status, 202);
  const { rows: [u1] } = await pool.query(`SELECT status, token_version, state_event_at FROM users WHERE portal_sub = $1`, [A.key]);
  assert.equal(u1.status, 'suspended');
  assert.equal(u1.token_version, u0.token_version + 1, 'every issued JWT died');
  // a late retry of an OLDER disabled must not undo anything, and an enabled RESTORES
  r = await deliver(mk('account-enabled', A.key, 500));       // older than the disabled: ignored for the status...
  assert.equal(r.status, 202);
  const { rows: [u2] } = await pool.query(`SELECT status FROM users WHERE portal_sub = $1`, [A.key]);
  assert.equal(u2.status, 'suspended', 'an older enable does not undo a newer disable');
  r = await deliver(mk('account-enabled', A.key, 2000));
  const { rows: [u3] } = await pool.query(`SELECT status, token_version FROM users WHERE portal_sub = $1`, [A.key]);
  assert.equal(u3.status, 'active', 'a newer enable restores');
  // logout: sessions die again, status unchanged
  r = await deliver(mk('backchannel-logout', A.key, 3000));
  const { rows: [u4] } = await pool.query(`SELECT status, token_version FROM users WHERE portal_sub = $1`, [A.key]);
  assert.equal(u4.status, 'active');
  assert.equal(u4.token_version, u3.token_version + 1);
  // an erased account is never resurrected by an enabled event
  subjectCheckAnswer = { gone: [A.key], disabled: [] };
  await deliverDeleted(A.key);
  r = await deliver(mk('account-enabled', A.key, 9999));
  const { rows: [u5] } = await pool.query(`SELECT status, portal_sub FROM users WHERE id = $1`, [A.user.id]);
  assert.equal(u5.status, 'erased', 'an enabled event must not resurrect an erased account');
});
