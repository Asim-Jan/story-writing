// STORIES-ON-DRIVE: the storage seam against the REAL server over HTTP.
//
// Boots server/index.js against a throwaway PostgreSQL + Redis (like test:regress) and a FAKE
// Drive app API (fake-drive-http.mjs: the /app/v1 subset the vendored _drive-client speaks; the
// server is pointed at it with DRIVE_APP_API_URL). Since 2.23.79 Drive is the ONLY media store:
// NO MinIO variable is set anywhere in this suite and none may be needed.
//
// Pins:
//   - the server boots and serves media with no MINIO_* at all (2.23.76 gated every media route
//     on a MinIO bucket check at boot).
//   - POST /api/media/upload puts the bytes in the uploader's Drive and records media_owners.
//     drive_ref/drive_node/drive_size; a Drive outage is a retryable 503 (there is no fallback).
//   - GET /api/media/:bucketType/:filename streams from DRIVE (the Drive owner is the asset's
//     owner, not the requester), Range passes through; an object Drive does not hold is 404;
//     Drive down is 503; Drive not configured is 503.
//   - DELETE removes the Drive copy and the row; Drive down = 503 and NOTHING is deleted.
//   - ACL still rules: another user's file 404s regardless of where the bytes live.
//   - the caretaker: an uploader with no portal_sub lands under the caretaker's sub path.
//
// Needs a THROWAWAY Postgres (superuser) and Redis on localhost:
//   POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_USER=postgres POSTGRES_PASSWORD=x \
//   REDIS_HOST=127.0.0.1 REDIS_PORT=56379 node server/tests/drive.test.js
// It creates and drops its own database (rg_drive) and FLUSHES the Redis db.
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import { fakeDrive, FAKE_DRIVE_SECRET } from './fake-drive-http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const JWT_SECRET = 'drive-secret';

const PG = {
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};
const REDIS = { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379) };

Object.assign(process.env, { USE_POSTGRES: 'true', READ_FROM_POSTGRES: 'true', DUAL_WRITE: 'false' });
for (const k of Object.keys(process.env)) if (/^(MINIO_|AWS_S3_|REGRESS_MINIO_)/.test(k)) delete process.env[k];   // no MinIO anywhere

if (!['127.0.0.1', 'localhost'].includes(PG.host) || !['127.0.0.1', 'localhost'].includes(REDIS.host)) {
  console.error('Refusing to run: POSTGRES_HOST and REDIS_HOST must be localhost (this suite drops databases and flushes Redis).');
  process.exit(2);
}

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function admin(sql, params) {
  const c = new pg.Client({ ...PG, database: 'postgres' });
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/* ── boot the real server ─────────────────────────────────────────────────────────────────── */

async function bootServer(database, extraEnv = {}) {
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    JWT_SECRET,
    POSTGRES_HOST: PG.host,
    POSTGRES_PORT: String(PG.port),
    POSTGRES_USER: PG.user,
    POSTGRES_PASSWORD: PG.password,
    POSTGRES_DB: database,
    POSTGRES_SSL: 'false',
    REDIS_HOST: REDIS.host,
    REDIS_PORT: String(REDIS.port),
    REDIS_PASSWORD: '',
    STORY_DRIVE_PUT_BASE_MS: '20',   // the upload retry's backoff, shortened so an outage test is quick
    ...extraEnv,
  };
  console.log(`    [boot] spawning the server on :${port}`);
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const LOGF = `/tmp/drive-server-${port}.log`;
  const lf = fs.openSync(LOGF, 'w');
  child.stdout.on('data', (d) => { log += d; fs.writeSync(lf, d); });
  child.stderr.on('data', (d) => { log += d; fs.writeSync(lf, d); });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  let servedHealth = false;
  const bootT0 = Date.now();
  const deadline = bootT0 + 600000;   // a fresh database runs schema.sql + every z-migration: minutes on a cold container
  while (Date.now() < deadline) {
    const waited = await Promise.race([exited.then(() => 'exit'), new Promise((r) => setTimeout(() => r(undefined), 250))]);
    if (waited === 'exit') return { exitCode: true, servedHealth, log, stop: async () => {} };
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (r.status === 200) { servedHealth = true; break; }
    } catch (e) { if (!bootServer._connErr) { bootServer._connErr = 1; console.log(`    [boot] not listening yet (${Math.round((Date.now()-bootT0)/1000)} s): ${e.message.slice(0,80)}`); } }
  }
  if (!servedHealth) { child.kill('SIGKILL'); throw new Error(`server never became healthy:\n${log.slice(-3000)}`); }
  return {
    base: `http://127.0.0.1:${port}`,
    log: () => log,
    exitCode: null,
    servedHealth,
    stop: async () => { child.kill('SIGTERM'); await exited; },
  };
}

function api(base) {
  const fn = async (method, url, token, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json, headers: r.headers };
  };
  fn.base = base;
  return fn;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function main() {
  await admin(`DROP DATABASE IF EXISTS rg_drive WITH (FORCE)`);
  await admin(`CREATE DATABASE rg_drive`);
  const db = new pg.Client({ ...PG, database: 'rg_drive' });
  await db.connect();

  const drive = await fakeDrive();
  const redis = createClient({ url: `redis://${REDIS.host}:${REDIS.port}` });
  await redis.connect();
  await redis.flushDb();
  await redis.quit();

  console.log('\n== the upload puts the bytes in the owner\'s Drive and records the ref');
  const caretaker = 'u_f37d34dea1d20271';
  const srv = await bootServer('rg_drive', {
    DRIVE_APP_API_URL: drive.url,
    DRIVE_APP_API_SECRET: FAKE_DRIVE_SECRET,
    DRIVE_CARETAKER_SUB: caretaker,
  });
  const srvLog = typeof srv.log === 'function' ? srv.log() : String(srv.log || '');
  check('the server booted with Drive storage on', srv.servedHealth === true && srv.exitCode == null, `exitCode=${srv.exitCode}`);
  if (srv.exitCode !== undefined) { console.log('server log:\n' + srvLog.slice(-3000)); }

  const apiH = api(srv.base);
  const mkUser = async (label, sub) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@drive.local`;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, name, tier, portal_sub) VALUES ($1, 'x', $2, 'free', $3) RETURNING id`,
      [email, label, sub]);
    const token = jwt.sign({ userId: rows[0].id, email, tokenVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
    return { id: rows[0].id, email, token, sub };
  };
  const asim = await mkUser('asim', 'u_1111111111111111');

  // The upload route (the one place a test can drive the whole path over HTTP):
  // /api/upload/:bucketType — multipart is awkward; find the JSON image-generation route instead.
  // The REAL seam the suite can reach: the media read + the migration's own ref recording.
  // For the WRITE path, exercise driveStorage directly through the server's own modules is not
  // possible over HTTP — so this suite pins the READ path + the recorded-ref behaviour, and the
  // write path is pinned by driving the route that generates an image (needs the AI gateway;
  // skipped here) — instead: seed media_owners the way upload() would, and pin the read logic.
  const { rows: ownRow } = await db.query(
    `INSERT INTO media_owners (bucket_type, filename, owner_id, book_id, drive_ref, drive_node, drive_size)
     VALUES ('images', 'driven.png', $1, NULL, 'story:images:driven.png', 'n_abc123', $2) RETURNING 1`,
    [asim.id, PNG.length]);

  // give the fake Drive the bytes (the migration's put did this)
  drive.objects.set('story:images:driven.png', { bytes: PNG, contentType: 'image/png', path: `${asim.sub}/Covers/driven.png`, node: 'n_seed0001' });

  console.log('\n== the read path streams from Drive when drive_ref is recorded');
  const srvPort = Number(new URL(srv.base).port);
  const { execSync } = await import('child_process');
  let listeners = '(lsof unavailable)';
  try { listeners = execSync(`lsof -iTCP:${srvPort} -sTCP:LISTEN -P 2>/dev/null | tail -2`).toString().trim(); } catch {}
  console.log(`    [read] srv.base=${srv.base} listeners: ${listeners.replace(/\n/g, ' | ')}`);
  const r1 = await fetch(`${srv.base}/api/media/images/driven.png`, { headers: { Authorization: `Bearer ${asim.token}` } });
  const buf1 = Buffer.from(await r1.arrayBuffer());
  if (r1.status !== 200) {
    console.log(`    [read] r1 status=${r1.status} body=${buf1.toString('utf8').slice(0,200)}`);
    await new Promise((r) => setTimeout(r, 1500));   // let the child's stdout flush before dumping its log
    console.log('SERVER LOG TAIL:\n' + String(typeof srvLog === 'function' ? srvLog() : srvLog).slice(-2500));
  }
  check('served from Drive (200, the right bytes)', r1.status === 200 && buf1.equals(PNG), `status ${r1.status}`);
  check('the content type comes from the Drive copy', r1.headers.get('content-type') === 'image/png');
  check('the Drive call named the ASSET OWNER as X-Sub', drive.requests.some(q => q.sub === 'u_1111111111111111' && q.path.startsWith('/app/v1/projects/story-writing/by-ref/')));
  const rangeR = await fetch(`${srv.base}/api/media/images/driven.png`, { headers: { Authorization: `Bearer ${asim.token}`, Range: 'bytes=0-9' } });
  const rangeBuf = Buffer.from(await rangeR.arrayBuffer());
  check('Range is honoured on the Drive stream', rangeR.status === 206 && rangeBuf.equals(PNG.subarray(0, 10)));

  console.log('\n== an object Drive does not hold is a 404 (MinIO is gone: no fallback, no 500)');
  const { rows: u2 } = await db.query(`INSERT INTO users (email, password_hash, name, tier, portal_sub) VALUES ('u2-x@drive.local', 'x', 'u2', 'free', 'u_2222222222222222') RETURNING id`);
  const legacyOwner = { id: u2[0].id, token: jwt.sign({ userId: u2[0].id, email: 'u2-x@drive.local', tokenVersion: 1 }, JWT_SECRET, { expiresIn: '1h' }) };
  await db.query(`INSERT INTO media_owners (bucket_type, filename, owner_id) VALUES ('images', 'legacy.png', $1)`, [legacyOwner.id]);
  const r2 = await apiH('GET', '/api/media/images/legacy.png', legacyOwner.token);
  check('a MinIO-era row with no bytes anywhere = 404 (not 503 forever, not 500)', r2.status === 404, `status ${r2.status}`);
  check('...looked up in the caretaker\'s Drive (where an ownerless upload lands), the only other place', drive.requests.some(q => q.sub === caretaker && q.path.includes('legacy')));
  check('the boot log never mentions a MinIO initialisation', !/MinIO initialization failed|minio/i.test(srvLog), srvLog.match(/.*minio.*/i)?.[0] || '');

  console.log('\n== POST /api/media/upload with NO MinIO configured: the bytes go to the uploader\'s Drive');
  const up = async (token, buf, name, type = 'image/png') => {
    const fd = new FormData();
    fd.append('bucketType', 'images');
    fd.append('file', new Blob([buf], { type }), name);
    const r = await fetch(`${srv.base}/api/media/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const u1 = await up(asim.token, PNG, 'cover.png');
  const upName = u1.json?.filename || '';
  check('upload = 200 with a media URL', u1.status === 200 && /^\/api\/media\/images\/upload-.*\.png$/.test(u1.json?.url || ''), `status ${u1.status} ${JSON.stringify(u1.json)}`);
  check('...the response carries no Drive ref, node or path', u1.json && !('drive' in u1.json) && !JSON.stringify(u1.json).includes('story:'));
  check('...the bytes are in the UPLOADER\'s Drive', drive.objects.get(`story:images:${upName}`)?.bytes.equals(PNG) && drive.objects.get(`story:images:${upName}`)?.path.startsWith(`${asim.sub}/`));
  const upRow = (await db.query(`SELECT drive_ref, drive_owner, drive_size FROM media_owners WHERE bucket_type = 'images' AND filename = $1`, [upName])).rows[0];
  check('...and media_owners records the ref + owner + size', upRow?.drive_ref === `story:images:${upName}` && upRow?.drive_owner === asim.sub && Number(upRow?.drive_size) === PNG.length, JSON.stringify(upRow));
  const back = await fetch(`${srv.base}${u1.json?.url}`, { headers: { Authorization: `Bearer ${asim.token}` } });
  check('...and reads back byte-for-byte', back.status === 200 && Buffer.from(await back.arrayBuffer()).equals(PNG));
  drive.mode.failUploads = true;
  const u2r = await up(asim.token, PNG, 'cover2.png');
  drive.mode.failUploads = false;
  check('Drive down during an upload = 503 (retryable), never a 500 and never a half-stored file', u2r.status === 503, `status ${u2r.status}`);

  console.log('\n== a storage-guarded route is no longer gated on MinIO (2.23.76: 503 for the life of the pod)');
  const vo = await fetch(`${srv.base}/api/voices`, { method: 'POST', headers: { Authorization: `Bearer ${asim.token}` }, body: new FormData() });
  check('POST /api/voices (one of the formerly MinIO-gated routes) reaches its own validation, not a storage 503', vo.status === 400, `status ${vo.status}`);

  console.log('\n== the caretaker case: a migrated object whose owner has no portal_sub still streams (drive_owner is the truth)');
  const { rows: u3 } = await db.query(`INSERT INTO users (email, password_hash, name, tier, portal_sub) VALUES ('unlinked-x@drive.local', 'x', 'u3', 'free', NULL) RETURNING id`);
  const unlinkedOwner = { id: u3[0].id, token: jwt.sign({ userId: u3[0].id, email: 'unlinked-x@drive.local', tokenVersion: 1 }, JWT_SECRET, { expiresIn: '1h' }) };
  await db.query(
    `INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref, drive_node, drive_size, drive_owner)
     VALUES ('images', 'migrated.png', $1, 'story:images:migrated.png', 'n_mig0001', $2, 'u_f37d34dea1d20271')`,
    [unlinkedOwner.id, PNG.length]);
  drive.objects.set('story:images:migrated.png', { bytes: PNG, contentType: 'image/png', path: 'u_f37d34dea1d20271/_unowned/Covers/migrated.png', node: 'n_mig0001' });
  const rMig = await fetch(`${srv.base}/api/media/images/migrated.png`, { headers: { Authorization: `Bearer ${unlinkedOwner.token}` } });
  const migBuf = Buffer.from(await rMig.arrayBuffer());
  check('an unlinked owner\'s migrated file streams from the CARETAKER\'s Drive', rMig.status === 200 && migBuf.equals(PNG), `status ${rMig.status}`);
  check('the Drive call named the CARETAKER sub', drive.requests.some(q => q.sub === caretaker && q.path.includes('migrated')));

  console.log('\n== ACL still rules over Drive-held bytes');
  const r3 = await apiH('GET', '/api/media/images/driven.png', legacyOwner.token);
  check('another user\'s Drive-held file is 404', r3.status === 404, `status ${r3.status}`);


  console.log('\n== the delete removes the Drive copy first (while the owner row still names the Drive owner)');
  await db.query(
    `INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref, drive_node, drive_size, drive_owner)
     VALUES ('images', 'deleteme.png', $1, 'story:images:deleteme.png', 'n_del0001', $2, 'u_1111111111111111')`,
    [asim.id, PNG.length]);
  drive.objects.set('story:images:deleteme.png', { bytes: PNG, contentType: 'image/png', path: 'u_1111111111111111/Covers/deleteme.png', node: 'n_del0001' });
  const rd = await apiH('DELETE', '/api/media/images/deleteme.png', asim.token);
  check('the delete answers ok', rd.status === 200, `status ${rd.status}`);
  check('the Drive copy is gone', !drive.objects.has('story:images:deleteme.png'));
  check('the owner row is gone', (await db.query(`SELECT 1 FROM media_owners WHERE filename = 'deleteme.png'`)).rowCount === 0);
  await db.query(
    `INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref, drive_node, drive_size, drive_owner)
     VALUES ('images', 'keepme.png', $1, 'story:images:keepme.png', 'n_keep001', $2, 'u_1111111111111111')`,
    [asim.id, PNG.length]);
  drive.objects.set('story:images:keepme.png', { bytes: PNG, contentType: 'image/png', path: 'u_1111111111111111/Covers/keepme.png', node: 'n_keep001' });
  drive.mode.failDeletes = true;
  const rdDown = await apiH('DELETE', '/api/media/images/keepme.png', asim.token);
  drive.mode.failDeletes = false;
  check('Drive down during a delete = 503 and NOTHING is deleted (the retry redoes it)', rdDown.status === 503 &&
    drive.objects.has('story:images:keepme.png') && (await db.query(`SELECT 1 FROM media_owners WHERE filename = 'keepme.png'`)).rowCount === 1, `status ${rdDown.status}`);

  console.log('\n== review fixes (follow-up to 2.23.79): 416, closed accounts, row-less objects, node-id deletes, voice deletes');
  {
    // 1. a Range past the end is the browser's error: 416 with the size, not a retryable 503
    const r416 = await fetch(`${srv.base}/api/media/images/driven.png`, { headers: { Authorization: `Bearer ${asim.token}`, Range: 'bytes=99999-' } });
    check('a Range past the end = 416 with Content-Range bytes */<size>', r416.status === 416 && r416.headers.get('content-range') === `bytes */${PNG.length}`, `status ${r416.status} ${r416.headers.get('content-range')}`);

    // 7. the holder's Drive account is closed (403 gone): 404, not a 503 the browser retries forever
    drive.mode.closedSubs.add(asim.sub);
    const rGone = await fetch(`${srv.base}/api/media/images/driven.png`, { headers: { Authorization: `Bearer ${asim.token}` } });
    drive.mode.closedSubs.delete(asim.sub);
    check('a read from an account Drive already closed (403 gone) = 404', rGone.status === 404, `status ${rGone.status}`);

    // 4. an object with NO ownership row: a book that merely MENTIONS its name no longer grants access
    drive.objects.set('story:images:orphan.png', { bytes: PNG, contentType: 'image/png', path: 'Covers/orphan.png', node: 'n_orphan01' });
    await db.query(`INSERT INTO books (owner_id, title, description) VALUES ($1, 'Mentions', 'see /api/media/images/orphan.png')`, [legacyOwner.id]);
    const rOrphan = await apiH('GET', '/api/media/images/orphan.png', legacyOwner.token);
    const dOrphan = await apiH('DELETE', '/api/media/images/orphan.png', legacyOwner.token);
    check('a row-less object is NOT readable or deletable by a user whose book text names it', rOrphan.status === 404 && dOrphan.status === 404 && drive.objects.has('story:images:orphan.png'), `${rOrphan.status} ${dOrphan.status}`);
    check('...and the refusal does not record that user as its owner', (await db.query(`SELECT 1 FROM media_owners WHERE filename = 'orphan.png'`)).rowCount === 0);
    const { rows: ct } = await db.query(`INSERT INTO users (email, password_hash, name, tier, portal_sub) VALUES ('caretaker-x@drive.local', 'x', 'ct', 'free', $1) RETURNING id`, [caretaker]);
    const ctToken = jwt.sign({ userId: ct[0].id, email: 'caretaker-x@drive.local', tokenVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
    const rCt = await fetch(`${srv.base}/api/media/images/orphan.png`, { headers: { Authorization: `Bearer ${ctToken}` } });
    check('...the caretaker (whose Drive holds ownerless objects) still can', rCt.status === 200, `status ${rCt.status}`);

    // 2. the delete route: the ref was let go but the recorded node is still in the project
    await db.query(`INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref, drive_node, drive_size, drive_owner)
      VALUES ('images', 'detached.png', $1, 'story:images:detached.png', 'n_det0001', $2, $3)`, [asim.id, PNG.length, asim.sub]);
    drive.detached.set('n_det0001', { bytes: PNG, contentType: 'image/png', path: `${asim.sub}/Covers/moved-by-person.png`, node: 'n_det0001' });
    const rDet = await apiH('DELETE', '/api/media/images/detached.png', asim.token);
    check('delete: a copy whose ref was let go is found by its node id and removed (not reported gone while it exists)', rDet.status === 200 && !drive.detached.has('n_det0001'), `status ${rDet.status}`);

    // 5. deleting a cloned voice: Drive errors surface (503, nothing deleted); success clears the owner row
    await db.query(`INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref, drive_node, drive_size, drive_owner)
      VALUES ('audio', 'voice-sample-x.wav', $1, 'story:audio:voice-sample-x.wav', 'n_voice001', 4, $2)`, [asim.id, asim.sub]);
    drive.objects.set('story:audio:voice-sample-x.wav', { bytes: Buffer.from('RIFF'), contentType: 'audio/wav', path: 'x', node: 'n_voice001' });
    const { rows: [v] } = await db.query(`INSERT INTO custom_voices (owner_id, name, sample_filename, duration_sec, consent_at) VALUES ($1, 'Me', 'voice-sample-x.wav', 5, NOW()) RETURNING id`, [asim.id]);
    drive.mode.failDeletes = true;
    const vDown = await apiH('DELETE', `/api/voices/${v.id}`, asim.token);
    drive.mode.failDeletes = false;
    const kept = (await db.query(`SELECT 1 FROM custom_voices WHERE id = $1`, [v.id])).rowCount === 1 && drive.objects.has('story:audio:voice-sample-x.wav');
    check('voice delete with Drive down = 503 and NOTHING deleted (it was swallowed: the recording stayed in Drive with no row)', vDown.status === 503 && kept, `status ${vDown.status}`);
    const vOk = await apiH('DELETE', `/api/voices/${v.id}`, asim.token);
    check('voice delete: the sample leaves Drive, the voice row AND its media_owners row go',
      vOk.status === 200 && !drive.objects.has('story:audio:voice-sample-x.wav') &&
      (await db.query(`SELECT 1 FROM custom_voices WHERE id = $1`, [v.id])).rowCount === 0 &&
      (await db.query(`SELECT 1 FROM media_owners WHERE filename = 'voice-sample-x.wav'`)).rowCount === 0, `status ${vOk.status}`);
  }

  console.log('\n== Drive down = 503 (the browser retries)');
  const { rows: own2 } = await db.query(
    `INSERT INTO media_owners (bucket_type, filename, owner_id, drive_ref) VALUES ('images', 'down.png', $1, 'story:images:down.png')`, [asim.id]);
  drive.objects.set('story:images:down.png', { bytes: PNG, contentType: 'image/png', path: 'x', node: 'n_seed0002' });
  const failingDrive = await fakeDrive({ failGets: true });
  await srv.stop();
  const srvDown = await bootServer('rg_drive', {
    DRIVE_APP_API_URL: failingDrive.url,
    DRIVE_APP_API_SECRET: FAKE_DRIVE_SECRET,
    DRIVE_CARETAKER_SUB: caretaker,
  });
  const r4b = await fetch(`${srvDown.base}/api/media/images/down.png`, { headers: { Authorization: `Bearer ${asim.token}` } });
  check('a failing Drive answers 503', r4b.status === 503, `status ${r4b.status}`);
  await srvDown.stop();
  failingDrive.close();


  console.log('\n== Drive not configured = media answers 503 (there is no other store), the rest of the app runs');
  const srvOff = await bootServer('rg_drive', { DRIVE_APP_API_SECRET: '' });
  const before = drive.requests.length;
  const r5b = await fetch(`${srvOff.base}/api/media/images/driven.png`, { headers: { Authorization: `Bearer ${asim.token}` } });
  check('a read with storage unconfigured = 503 (retryable), not a 500', r5b.status === 503, `status ${r5b.status}`);
  const vo2 = await fetch(`${srvOff.base}/api/voices`, { method: 'POST', headers: { Authorization: `Bearer ${asim.token}` }, body: new FormData() });
  check('a storage-guarded route with storage unconfigured = 503 before any work', vo2.status === 503, `status ${vo2.status}`);
  check('no Drive call was made', drive.requests.length === before);
  const h = await (await fetch(`${srvOff.base}/api/health`)).json();
  check('health reports the store, and the pod stays healthy', h?.services?.storage?.backend === 'sai-drive' && h?.services?.storage?.status === 'not configured' && !('minio' in (h?.services || {})), JSON.stringify(h?.services?.storage));
  await srvOff.stop();

  console.log('\n== driveStorage unit behaviours (the client, for real)');
  const { driveStorage } = await import('../services/driveStorage.js');
  // reset the singleton's env view for a unit pass
  const mod = await import('../services/driveStorage.js');
  const ds = Object.create(Object.getPrototypeOf(mod.driveStorage));
  Object.assign(ds, { client: null, enabled: false, caretaker: caretaker });
  process.env.DRIVE_APP_API_SECRET = FAKE_DRIVE_SECRET;
  process.env.DRIVE_APP_API_URL = drive.url;
  process.env.DRIVE_CARETAKER_SUB = caretaker;
  const c = ds.initialize();
  check('initialize builds the client when the secret is set', !!c && ds.enabled);
  const put1 = await ds.put('videos', Buffer.from('film-bytes'), 'final-x.mp4', { portal_sub: 'u_1111111111111111' });
  check('put goes to the uploader\'s own Drive', put1.ok && put1.path.startsWith('u_1111111111111111/Films/'), JSON.stringify(put1));
  check('the ref scheme is story:<bucket>:<file>', put1.ok && put1.ref === 'story:videos:final-x.mp4');
  const put2 = await ds.put('images', PNG, 'noone.png', { });
  check('an uploader with no portal_sub lands with the caretaker (at the top: no sub segment)', put2.ok && put2.path.startsWith('Covers/') && put2.ownerSub === caretaker, JSON.stringify(put2));
  const put3 = await ds.put('images', PNG, 'same-ref.png', { portal_sub: 'u_1111111111111111' });
  const nodeA = put3.node;
  const put4 = await ds.put('images', PNG, 'same-ref.png', { portal_sub: 'u_1111111111111111' });
  check('put is idempotent by ref (same bytes = same node, no error)', put4.ok && put4.node === nodeA);
  const put5 = await ds.put('audio', Buffer.from(''), 'x.wav', { portal_sub: 'u_1111111111111111' });
  check('an empty buffer still stores (a real case: a zero-length chapter)', put5.ok);

  await db.query(`DELETE FROM media_owners`);
  drive.objects.clear();
  await db.end();
  await drive.close();
  console.log(`\ndrive storage: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
