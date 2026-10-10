// The catch-up sweep (STORIES-DELETION.md section 12) against a REAL throwaway Postgres + a fake portal:
//   PORTAL_TEST_PG_HOST=127.0.0.1 PORTAL_TEST_PG_PORT=57432 PORTAL_TEST_PG_USER=postgres PORTAL_TEST_PG_PASSWORD=x \
//     node --test server/portalAuth/tests/catchup.test.js
// Covers: a missed deletion is pulled and applied through the receiver's own handleToken (the person erased); the
// cursor persists (a restart replays nothing); the subjects/check sweep erases a gone sub with NO queue event (the
// backstop); a wrong app secret aborts the sweep without erasing anything. ONE before() hook on purpose: this
// Node's node:test builds the module state per test context, so hooks must not split module state.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';
import pg from 'pg';

const E = process.env;
const enabled = ['127.0.0.1', 'localhost'].includes(E.PORTAL_TEST_PG_HOST) && !!E.PORTAL_TEST_PG_USER;
const skip = enabled ? false : 'set PORTAL_TEST_PG_HOST=127.0.0.1 (+ _PORT _USER _PASSWORD) to run against a throwaway Postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const DB = 'identity_cu_' + process.pid;
const conn = { host: E.PORTAL_TEST_PG_HOST, port: Number(E.PORTAL_TEST_PG_PORT || 5432), user: E.PORTAL_TEST_PG_USER, password: E.PORTAL_TEST_PG_PASSWORD };
let admin, pool, fakePortal, portalPort, handler;
let queueRows = [];
let removedObjects = [];
let subjectAnswer = { gone: [], disabled: [] };        // the receiver's subjects/check
let goneAnswer = { gone: [], disabled: [] };           // the sweep's subjects/check
const APP_SECRET = 'good'.repeat(13).slice(0, 40);     // what the fake portal expects

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

before(async () => {
  if (skip) return;
  admin = new pg.Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  pool = new pg.Pool({ ...conn, database: DB });
  await pool.query(fs.readFileSync(path.join(serverDir, 'db', 'schema.sql'), 'utf8'));
  await pool.query(`CREATE TABLE IF NOT EXISTS media_owners (bucket_type VARCHAR(20) NOT NULL, filename VARCHAR(500) NOT NULL, owner_id UUID NOT NULL, book_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (bucket_type, filename))`);
  const mdir = path.join(serverDir, 'db', 'migrations');
  for (const f of fs.readdirSync(mdir).filter(f => f.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(mdir, f), 'utf8'));

  fakePortal = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ok = req.headers['x-app-secret'] === APP_SECRET;
    if (u.pathname === '/api/apps/events') {
      if (!ok) { res.writeHead(403); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ events: queueRows, next: queueRows.length ? queueRows[queueRows.length - 1].seq : 0 }));
    }
    if (u.pathname === '/api/apps/subjects/check') {
      let b = '';
      req.on('data', c => b += c);
      req.on('end', () => {
        if (!ok) { res.writeHead(403); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(goneAnswer));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => { fakePortal.listen(0, '127.0.0.1', r); });
  portalPort = fakePortal.address().port;

  // the receiver, wired exactly as index.js wires it
  const { createIdentityEvents } = await import('../identityEvents.js');
  const { createClient } = await import(path.join(serverDir, 'vendor', 'sai-auth-client', 'index.cjs'));
  const client = createClient({
    issuer: ISS, clientId: 'stories', clientSecret: 'client-secret-for-tests',
    redirectUri: 'https://stories.test/auth/portal/callback', cookieSecret: crypto.randomBytes(32).toString('base64'),
    fetch: async (url) => String(url).endsWith('/oidc/jwks')
      ? { status: 200, text: async () => JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: KID, use: 'sig', alg: 'ES256' }] }) }
      : { status: 200, text: async () => JSON.stringify({ issuer: ISS, authorization_endpoint: ISS + '/oidc/authorize', token_endpoint: ISS + '/oidc/token', jwks_uri: ISS + '/oidc/jwks' }) },
    jwksMinRefreshS: 0,
  });
  handler = createIdentityEvents({
    pool, storage: { async delete(bt, fn) { removedObjects.push(bt + '/' + fn); } },
    redisClient: null, client, appSecret: 's'.repeat(40),
    portalBase: 'http://portal-app.test', fetch: async () => ({ status: 200, json: async () => subjectAnswer }),
  });
});

after(async () => {
  if (skip) { console.log('SKIP: ' + skip); return; }
  await pool.end(); await admin.query(`DROP DATABASE ${DB}`); await admin.end(); fakePortal.close();
});

const seed = async () => {
  await pool.query('DELETE FROM users'); await pool.query('DELETE FROM media_owners'); await pool.query('DELETE FROM identity_events');
  await pool.query("DELETE FROM app_settings WHERE key LIKE 'identity_catchup%'");
  removedObjects = [];
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (email, name, password_hash, role, tier, status, portal_sub, portal_linked_at, email_verified)
     VALUES ('c@x.com', 'C', 'x', 'user', 'free', 'active', $1, NOW(), TRUE) RETURNING *`, ['u_' + 'c'.repeat(16)]);
  const { rows: [b] } = await pool.query(`INSERT INTO books (owner_id, title, version, transcripts) VALUES ($1, 'C book', 1, '{}'::jsonb) RETURNING *`, [u.id]);
  await pool.query(`INSERT INTO media_owners (bucket_type, owner_id, filename) VALUES ('images', $1, 'img-c.png')`, [u.id]);
  return u;
};
const evtId = () => 'evt_' + crypto.randomBytes(12).toString('hex');
const mkDeletedToken = (sub) => signEvent({
  iss: ISS, aud: 'stories', sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
  jti: 'jti_' + crypto.randomBytes(12).toString('hex'),
  events: { 'https://schemas.solutionsai.co.uk/event/account-deleted': { evt: evtId(), at: Math.floor(Date.now() / 1000) } } });
const startCu = async ({ onToken, onSubGone }) => {
  const { startCatchUp } = await import('../catchup.js');
  return startCatchUp({ pool, appSecret: APP_SECRET, portalBase: `http://127.0.0.1:${portalPort}`, onToken, onSubGone });
};

test('a missed deletion is pulled and applied through the receiver path: the person is erased, the cursor persists', { skip }, async () => {
  const u = await seed();
  subjectAnswer = { gone: [u.portal_sub], disabled: [] };
  const tok = mkDeletedToken(u.portal_sub);
  const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
  const evt = payload.events['https://schemas.solutionsai.co.uk/event/account-deleted'].evt;
  queueRows = [{ seq: 7, evt, type: 'account-deleted', token: tok }];
  const { createEraser } = await import('../erasure.js');
  const cu = await startCu({
    onToken: async (x) => await handler.handleToken(x),
    onSubGone: async (sub) => { await createEraser({ pool, storage: { async delete() {} }, redis: null, log: console }).eraseBySub(sub); },
  });
  const r = await cu.run();
  assert.equal(r.queue.pulled, 1, JSON.stringify(r));
  assert.equal(r.queue.applied, 1);
  const { rows: [u2] } = await pool.query('SELECT status, portal_sub FROM users WHERE id = $1', [u.id]);
  assert.equal(u2.status, 'erased', 'the missed deletion was caught up');
  assert.equal(u2.portal_sub, null);
  const cur = (await pool.query("SELECT value FROM app_settings WHERE key = 'identity_catchup_cursor'")).rows[0].value;
  assert.equal(String(cur), '7', 'the cursor persisted');
  queueRows = [];
  const r2 = await cu.run();
  assert.equal(r2.queue.pulled, 0, 'a second run replays nothing');
  cu._test.stop();
});

test('the subjects/check sweep erases a gone sub even with NO queue event (the backstop)', { skip }, async () => {
  const u = await seed();
  queueRows = []; goneAnswer = { gone: [u.portal_sub], disabled: [] };
  const { createEraser } = await import('../erasure.js');
  const cu = await startCu({
    onToken: async (x) => await handler.handleToken(x),
    onSubGone: async (sub) => { await createEraser({ pool, storage: { async delete(bt, fn) { removedObjects.push(bt + '/' + fn); } }, redis: null, log: console }).eraseBySub(sub); },
  });
  const r = await cu.run();
  assert.equal(r.sweep.checked, 1, JSON.stringify(r.sweep));
  assert.equal(r.sweep.gone, 1, 'the gone sub was erased by the sweep');
  const { rows: [u2] } = await pool.query('SELECT status FROM users WHERE id = $1', [u.id]);
  assert.equal(u2.status, 'erased');
  assert.ok(removedObjects.includes('images/img-c.png'), 'the object went too');
  cu._test.stop();
});

test('a wrong app secret aborts the sweep (403 from the portal) and erases NOTHING', { skip }, async () => {
  const u = await seed();
  queueRows = []; goneAnswer = { gone: [u.portal_sub], disabled: [] };
  const { startCatchUp } = await import('../catchup.js');
  const bad = startCatchUp({ pool, appSecret: 'wrong', portalBase: `http://127.0.0.1:${portalPort}`, onToken: async () => ({}), onSubGone: async () => { throw new Error('must not be called'); } });
  await assert.rejects(() => bad.run(), /answered 403/);
  const { rows: [u2] } = await pool.query('SELECT status FROM users WHERE id = $1', [u.id]);
  assert.equal(u2.status, 'active', 'nothing was erased');
  bad._test.stop();
});
