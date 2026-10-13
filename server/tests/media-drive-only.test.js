// MinIO retired (2.23.79): SAI Drive is the ONLY media store. Unit tests, no database, no network:
// the REAL MediaStorage + the REAL DriveStorage logic over the vendored in-process fake Drive
// (server/vendor/drive-client/fake.cjs, the same fake the client's conformance suite runs against).
// No MINIO_* or AWS_* variable is set anywhere in this file, and nothing may try to reach one.
//   node --test server/tests/media-drive-only.test.js      (npm run test:media)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

for (const k of Object.keys(process.env)) if (/^(MINIO_|AWS_)/.test(k)) delete process.env[k];

const require = createRequire(import.meta.url);
const { createFakeDrive } = require('../vendor/drive-client/fake.cjs');
const { MediaStorage } = await import('../services/mediaStorage.js');
const { driveStorage } = await import('../services/driveStorage.js');
const { createEraser } = await import('../portalAuth/erasure.js');

const OWNER = 'u_1111111111111111';
const OTHER = 'u_2222222222222222';
const CARETAKER = 'u_f37d34dea1d20271';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/* A DriveStorage (the app's own class, its put/stream/remove logic untouched) wired to the fake. */
function world({ capBytes = 50 * 1024 * 1024, maxFileBytes = 20 * 1024 * 1024, owners = {} } = {}) {
  const fake = createFakeDrive({
    apps: { version: 1, apps: [{ id: 'stories', name: 'Stories', projects: ['story-writing'], secretEnv: 'APPS_SECRET_STORIES', trusted: true, capBytes, maxFileBytes, allowTags: ['final', 'intermediate', 'source'] }] },
  });
  const drive = Object.create(Object.getPrototypeOf(driveStorage));
  Object.assign(drive, { client: fake.client({ appId: 'stories' }), enabled: true, caretaker: CARETAKER });
  drive.ownerOfBook = async (bookId) => (bookId === 'b0000000-0000-4000-8000-000000000001' ? { id: 'owner-of-book', portal_sub: OWNER } : null);
  drive.userFromId = async (id) => (id === 'api-user' ? { id, portal_sub: OTHER } : null);
  const recorded = [];
  const media = new MediaStorage({
    drive,
    deps: {
      ownerSubOf: async (bt, fn) => owners[`${bt}/${fn}`] || null,
      recordOwner: async (bt, fn, rec) => { recorded.push({ bt, fn, ...rec }); owners[`${bt}/${fn}`] = rec.drive.ownerSub; },
      bookOf: async (id) => (id === 'b0000000-0000-4000-8000-000000000001' ? { id, title: 'The Lighthouse' } : null),
    },
  });
  return { fake, drive, media, recorded, owners };
}

const readAll = async (stream) => { const c = []; for await (const x of stream) c.push(x); return Buffer.concat(c); };

/* ── uploads ─────────────────────────────────────────────────────────────────────────────────── */

test('upload: no MinIO configured anywhere — the bytes land in the OWNER\'s Drive and the ref is recorded', async () => {
  const { media, recorded, drive } = world();
  const r = await media.upload('images', PNG, 'visual-1.png', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } });
  assert.equal(r.storageKey, 'images/visual-1.png');
  assert.equal(r.contentType, 'image/png');
  assert.equal(r.drive.ok, true);
  assert.equal(r.drive.ownerSub, OWNER);
  assert.equal(r.drive.ref, 'story:images:visual-1.png');
  assert.deepEqual(recorded.map(x => [x.bt, x.fn, x.ownerId, x.drive.ref]), [['images', 'visual-1.png', 'u1', 'story:images:visual-1.png']]);
  const st = await drive.statFor(OWNER, 'images', 'visual-1.png');
  assert.equal(st.size, PNG.length);
});

test('upload: no driveUser + a bookId = the book owner\'s Drive, in the book\'s folder (the films/scenes path)', async () => {
  const { media, recorded } = world();
  const r = await media.upload('videos', Buffer.from('film'), 'film-1.mp4', { bookId: 'b0000000-0000-4000-8000-000000000001' }, null, {});
  assert.equal(r.drive.ownerSub, OWNER);
  assert.match(r.drive.path, /^u_1111111111111111\/The Lighthouse \(b0000000\)\/Films\/film-1\.mp4$/);
  assert.equal(recorded[0].ownerId, 'owner-of-book', 'the owner row is written by upload() itself (2.23.76 left stitched films with NO row)');
});

test('upload: a caller that knows only { userId } (API key) still writes into THAT person\'s Drive', async () => {
  const { media } = world();
  const r = await media.upload('audio', Buffer.from('RIFF'), 'chapter-1.wav', {}, null, { driveUser: { userId: 'api-user' } });
  assert.equal(r.drive.ownerSub, OTHER);
});

test('upload: Drive not configured = 503 storage_unavailable (never a MinIO attempt)', async () => {
  const { media, drive } = world();
  drive.enabled = false; drive.client = null;
  const saved = process.env.DRIVE_APP_API_SECRET; delete process.env.DRIVE_APP_API_SECRET;
  try {
    await assert.rejects(media.upload('images', PNG, 'x.png', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } }),
      (e) => e.status === 503 && e.code === 'storage_unavailable' && /Failed to upload to storage/.test(e.message));
  } finally { if (saved !== undefined) process.env.DRIVE_APP_API_SECRET = saved; }
});

test('upload: Drive down = retryable 503; over the app cap = 413 (there is no fallback store)', async () => {
  const { media, fake } = world({ capBytes: 1000, maxFileBytes: 1000 });
  fake.admin.failNext(1);
  await assert.rejects(media.upload('images', PNG, 'down.png', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } }), (e) => e.status === 503 && e.retryable === true);
  await assert.rejects(media.upload('videos', Buffer.alloc(5000), 'big.mp4', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } }), (e) => e.status === 413);
});

test('upload: an unknown bucket type is refused before any store call', async () => {
  const { media } = world();
  await assert.rejects(media.upload('exports', PNG, 'x.png'), (e) => e.status === 400);
});

/* ── reads ───────────────────────────────────────────────────────────────────────────────────── */

test('reads: open/getStream/getFile/downloadTo all come from the HOLDER\'s Drive by ref', async () => {
  const { media } = world();
  const film = Buffer.alloc(200 * 1024, 7);
  await media.upload('videos', film, 'clip-1.mp4', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } });
  const g = await media.open('videos', 'clip-1.mp4', { range: 'bytes=0-9' });
  assert.equal(g.status, 206);
  assert.equal((await readAll(g.stream)).length, 10);
  assert.ok((await readAll(await media.getStream('videos', 'clip-1.mp4'))).equals(film));
  assert.ok((await media.getFile('videos', 'clip-1.mp4')).equals(film));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
  try {
    const out = await media.downloadTo('videos', 'clip-1.mp4', path.join(dir, 'clip.mp4'));
    assert.ok(fs.readFileSync(out).equals(film), 'streamed to disk byte-for-byte');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reads: no owner row = the caretaker\'s Drive (where an ownerless upload lands)', async () => {
  const { media, drive } = world();
  await drive.put('images', PNG, 'ownerless.png', null);       // subOf(null) = the caretaker
  assert.ok((await media.getFile('images', 'ownerless.png')).equals(PNG));
});

test('reads: a missing object is NotFound/404; Drive down is a retryable 503; getFile stops at its cap', async () => {
  const { media, fake } = world();
  await assert.rejects(media.getFile('images', 'nope.png'), (e) => e.code === 'NotFound' && e.status === 404);
  await media.upload('images', PNG, 'ok.png', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } });
  fake.admin.failNext(1);
  await assert.rejects(media.getStream('images', 'ok.png'), (e) => e.status === 503);
  await assert.rejects(media.getFile('images', 'ok.png', { maxBytes: 10 }), (e) => e.code === 'too_large');
});

/* ── deletes and erasure ─────────────────────────────────────────────────────────────────────── */

test('delete: removes the Drive copy; a second delete is { gone } (idempotent), never a throw', async () => {
  const { media, drive } = world();
  await media.upload('images', PNG, 'del.png', {}, null, { driveUser: { id: 'u1', portal_sub: OWNER } });
  assert.equal((await media.delete('images', 'del.png')).removed, true);
  assert.equal(await drive.statFor(OWNER, 'images', 'del.png'), null);
  assert.deepEqual(await media.delete('images', 'del.png'), { gone: true });
});

/* A pool that answers the eraser's queries (the eraser's SQL is pinned against a REAL schema by
   portalAuth/tests/identityEvents.test.js; here only the media step's behaviour matters). */
function fakePool({ sub, userId, mediaRows }) {
  const log = [];
  const query = async (sql, params) => {
    log.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
    if (/FROM users WHERE portal_sub/.test(sql)) return { rows: params[0] === sub ? [{ id: userId, status: 'active' }] : [] };
    if (/FROM media_owners WHERE owner_id/.test(sql) && /^SELECT/.test(sql.trim())) return { rows: mediaRows };
    if (/COUNT\(\*\) FROM payments/.test(sql)) return { rows: [{ n: 0 }] };
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release() {} }), log };
}

test('erasure: succeeds with NO MinIO — own-Drive copies are left to Drive\'s account erasure, caretaker copies are removed', async () => {
  const { media, drive } = world();
  // A's own upload (in A's Drive) and a migrated one held by the caretaker
  await media.upload('images', PNG, 'mine.png', {}, null, { driveUser: { id: 'A', portal_sub: OWNER } });
  await drive.put('videos', Buffer.from('film'), 'migrated.mp4', null);
  const pool = fakePool({ sub: OWNER, userId: 'A', mediaRows: [
    { bucket_type: 'images', filename: 'mine.png', drive_ref: 'story:images:mine.png', drive_owner: OWNER },
    { bucket_type: 'videos', filename: 'migrated.mp4', drive_ref: 'story:videos:migrated.mp4', drive_owner: CARETAKER },
    { bucket_type: 'images', filename: 'never-stored.png', drive_ref: null, drive_owner: null },   // MinIO-era row, bytes long gone
  ] });
  const r = await createEraser({ pool, storage: media, redis: null, log: { info() {}, error() {} } }).eraseBySub(OWNER);
  assert.equal(r.done, true);
  assert.equal(r.counts.media, 2, 'the caretaker copy removed + the bytes-less row counted as gone');
  assert.equal(r.counts.mediaLeftToDrive, 1, 'A\'s own Drive copy: Drive\'s own account erasure (APPS-INTEGRATION section 7)');
  assert.equal(await drive.statFor(CARETAKER, 'videos', 'migrated.mp4'), null, 'the caretaker-held copy is gone from the caretaker\'s Drive');
  assert.ok(pool.log.some(l => /^DELETE FROM media_owners WHERE owner_id/.test(l)), 'the rows go after the objects');
});

test('erasure: a Drive outage stops the erase (503 + retry), and the retry finishes it', async () => {
  const { media, drive, fake } = world();
  await drive.put('videos', Buffer.from('film'), 'migrated.mp4', null);
  const rows = [{ bucket_type: 'videos', filename: 'migrated.mp4', drive_ref: 'story:videos:migrated.mp4', drive_owner: CARETAKER }];
  const eraser = () => createEraser({ pool: fakePool({ sub: OWNER, userId: 'A', mediaRows: rows }), storage: media, redis: null, log: { info() {}, error() {} } });
  fake.admin.failNext(1);
  await assert.rejects(eraser().eraseBySub(OWNER), (e) => e.status === 503);
  const r = await eraser().eraseBySub(OWNER);
  assert.equal(r.done, true);
  assert.equal(r.counts.media, 1);
});

test('erasure: an object Drive no longer has (or a closed holder account) counts as gone', async () => {
  const { media, fake } = world();
  const rows = [{ bucket_type: 'images', filename: 'x.png', drive_ref: 'story:images:x.png', drive_owner: OTHER }];
  fake.admin.setState(OTHER, 'erased');
  const r = await createEraser({ pool: fakePool({ sub: OWNER, userId: 'A', mediaRows: rows }), storage: media, redis: null, log: { info() {}, error() {} } }).eraseBySub(OWNER);
  assert.equal(r.done, true);
  assert.equal(r.counts.media, 1);
});

test('no module the backend loads for media imports a MinIO or S3 client', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  for (const f of ['services/mediaStorage.js', 'services/videoAssembler.js', 'services/filmExport.js', 'services/filmDirector.js',
    'services/characterReferences.js', 'services/voices.js', 'portalAuth/erasure.js', 'index.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /from 'minio'|require\('minio'\)|@aws-sdk|minioAvailable|requireMinIO/, f);
  }
});

