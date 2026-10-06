// test:regress: the pre-merge review checks as one suite, run against the REAL
// server over HTTP. It boots server/index.js against a throwaway PostgreSQL and
// Redis, with a fake AI gateway, and pins the bugs that kept coming back:
//   - save path: real versions with the triggers live, 409 on stale, no
//     duplicate chapter insert, coded 403/404/409, chapter history
//   - roles: viewer/commenter refused, editor allowed, on books and RPG
//   - job status keyed by type:id (repeated Bull ids across users)
//   - one AI quota slot per request; grammar-check free
//   - the paywall switch reaches /api/subscriptions/my
//   - migrations: fresh install, prod-shaped baseline, failing migration
//
// Needs a THROWAWAY Postgres (superuser) and Redis on localhost:
//   POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_USER=postgres POSTGRES_PASSWORD=x \
//   REDIS_HOST=127.0.0.1 REDIS_PORT=56379 npm run test:regress
// It creates and drops its own databases (rg_*) and FLUSHES the Redis db.
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const JWT_SECRET = 'regress-secret';

const PG = {
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};
const REDIS = { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379) };

// the data-layer mode prod runs (manifests configmap): Postgres only
Object.assign(process.env, { USE_POSTGRES: 'true', READ_FROM_POSTGRES: 'true', DUAL_WRITE: 'false' });

if (!['127.0.0.1', 'localhost'].includes(PG.host) || !['127.0.0.1', 'localhost'].includes(REDIS.host)) {
  console.error('Refusing to run: POSTGRES_HOST and REDIS_HOST must be localhost (this suite drops databases and flushes Redis).');
  process.exit(2);
}

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

// ─── helpers ────────────────────────────────────────────────────────────────
async function admin(sql, params) {
  const c = new pg.Client({ ...PG, database: 'postgres' });
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}

async function freshDb(name) {
  await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${name}`);
  return new pg.Pool({ ...PG, database: name, max: 4 });
}

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// A fake SAI gateway: chat completions get a small JSON reply; a prompt
// containing GATEWAY_FAIL gets a 500 (to exercise the quota refund).
async function fakeGateway() {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (body.includes('GATEWAY_FAIL')) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: 'upstream down' } }));
        return;
      }
      const content = JSON.stringify({ name: 'Sir Test', role: 'Hero', description: 'Brave and kind.' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'sai-chat',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((r) => server.listen(port, r));
  return { url: `http://127.0.0.1:${port}/v1`, close: () => server.close() };
}

// Boot the real server. Resolves when /api/health answers, or with the exit
// code if the process dies first (a failed migration must exit, never serve).
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
    MINIO_ENDPOINT: '127.0.0.1',
    MINIO_PORT: '1',
    ...extraEnv,
  };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let servedHealth = false;
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r(undefined), 250))]);
    if (code !== undefined) return { exitCode: code, servedHealth, log, stop: async () => {} };
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.status === 200) { servedHealth = true; break; }
    } catch { /* not listening yet */ }
  }
  if (!servedHealth) { child.kill('SIGKILL'); throw new Error(`server never became healthy:\n${log.slice(-3000)}`); }

  const base = `http://127.0.0.1:${port}`;
  return {
    base, log: () => log, exitCode: null, servedHealth,
    stop: async () => { child.kill('SIGTERM'); await exited; },
  };
}

function api(base) {
  return async (method, url, token, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  };
}

async function makeUser(db, label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@regress.local`;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, name, tier) VALUES ($1, 'x', $2, 'free') RETURNING id`,
    [email, label]
  );
  await db.query(
    `INSERT INTO quotas (user_id, max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs)
     VALUES ($1, 3, 50000, 30, 10, 1) ON CONFLICT (user_id) DO NOTHING`,
    [rows[0].id]
  );
  const token = jwt.sign({ userId: rows[0].id, email, tokenVersion: 1 }, JWT_SECRET, { expiresIn: '1h' });
  return { id: rows[0].id, email, token };
}

async function addCollaborator(db, bookId, user, role) {
  await db.query(
    `INSERT INTO collaborators (book_id, email, role, status, user_id) VALUES ($1, $2, $3, 'active', $4)`,
    [bookId, user.email, role, user.id]
  );
}

const dbVersion = async (db, bookId) => (await db.query('SELECT version FROM books WHERE id = $1', [bookId])).rows[0].version;

// ─── 1. fresh install + the HTTP suite ──────────────────────────────────────
async function mainSuite(gateway) {
  console.log('\n== fresh install');
  const db = await freshDb('rg_main');
  const srv = await bootServer('rg_main', { SAI_API_BASE_URL: gateway.url, SAI_API_KEY: 'test', FEATURE_UNLOCK_TIER: 'basic' });
  const call = api(srv.base);
  try {
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'books'`
    )).rows.map(r => r.column_name);
    check('fresh install has the legacy-migration columns (notes, metadata, audio_files)',
      ['notes', 'metadata', 'audio_files', 'transcripts'].every(c => cols.includes(c)));
    const migs = (await db.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n;
    check('fresh install ran every migration file', migs === fs.readdirSync(path.join(SERVER_DIR, 'db', 'migrations')).filter(f => f.endsWith('.sql')).length);

    const owner = await makeUser(db, 'owner');
    const editor = await makeUser(db, 'editor');
    const commenter = await makeUser(db, 'commenter');
    const viewer = await makeUser(db, 'viewer');
    const stranger = await makeUser(db, 'stranger');
    const book = (await db.query(
      `INSERT INTO books (owner_id, title, description) VALUES ($1, 'Regress', 'd') RETURNING id, version`, [owner.id]
    )).rows[0];
    await addCollaborator(db, book.id, editor, 'editor');
    await addCollaborator(db, book.id, commenter, 'commenter');
    await addCollaborator(db, book.id, viewer, 'viewer');

    console.log('\n== save path (PUT /api/books/:id, triggers live)');
    let r = await call('PUT', `/api/books/${book.id}`, owner.token, { title: 'One', chapters: [], version: book.version });
    check('save 1 = 200', r.status === 200, `got ${r.status}`);
    check('save 1 returns the real DB version', r.json?.version === await dbVersion(db, book.id), `${r.json?.version} vs ${await dbVersion(db, book.id)}`);
    const v1 = r.json?.version;
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { title: 'Two', chapters: [], version: v1 });
    check('save 2 with the returned version = 200 (no 409 on every second save)', r.status === 200, `got ${r.status}`);
    const v2 = r.json?.version;
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { title: 'Stale', version: v1 });
    check('stale save = 409', r.status === 409, `got ${r.status}`);
    check('stale save changed nothing', (await db.query('SELECT title FROM books WHERE id = $1', [book.id])).rows[0].title === 'Two');

    // new chapters with client ids, then the client adopts server ids by number (as useBook does)
    let chapters = [
      { id: Date.now(), number: 1, title: 'Ch 1', content: 'one two three' },
      { id: Date.now() + 1, number: 2, title: 'Ch 2', content: 'four five six' },
    ];
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { chapters, version: v2 });
    check('new chapters save = 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    const byNumber = new Map((r.json?.chapters || []).map(c => [String(c.number), c]));
    chapters = chapters.map(c => ({ ...c, id: byNumber.get(String(c.number))?.id ?? c.id }));
    let v = r.json?.version;
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { chapters, version: v });
    check('re-save after adopting server ids = 200', r.status === 200, `got ${r.status}`);
    const nCh = (await db.query('SELECT COUNT(*)::int AS n FROM chapters WHERE book_id = $1 AND deleted_at IS NULL', [book.id])).rows[0].n;
    check('exactly one row per chapter (no re-insert)', nCh === 2, `rows=${nCh}`);
    v = r.json?.version;

    const hist0 = (await db.query(`SELECT COUNT(*)::int AS n FROM chapter_versions cv JOIN chapters c ON c.id = cv.chapter_id WHERE c.book_id = $1`, [book.id])).rows[0].n;
    chapters = chapters.map(c => c.number === 1 ? { ...c, content: c.content + ' extra'.repeat(150) } : c);
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { chapters, version: v });
    const hist1 = (await db.query(`SELECT COUNT(*)::int AS n FROM chapter_versions cv JOIN chapters c ON c.id = cv.chapter_id WHERE c.book_id = $1`, [book.id])).rows[0].n;
    check('chapter-only save = 200', r.status === 200, `got ${r.status}`);
    check('chapter history grows on a content change', hist1 > hist0, `${hist0} -> ${hist1}`);
    const vAfterChapters = r.json?.version;
    check('chapter-only save returns the real DB version', vAfterChapters === await dbVersion(db, book.id));

    r = await call('PUT', `/api/books/${book.id}`, owner.token, { chapters, version: v });
    check('STALE chapter-only save = 409 (no silent overwrite)', r.status === 409, `got ${r.status}`);

    const before = (await db.query('SELECT title, version FROM books WHERE id = $1', [book.id])).rows[0];
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { title: 'Wipe', chapters: [], version: vAfterChapters });
    const after = (await db.query('SELECT title, version FROM books WHERE id = $1', [book.id])).rows[0];
    check('empty-chapters payload over existing chapters = 409', r.status === 409, `got ${r.status}`);
    check('...and the book row is untouched (atomic)', before.title === after.title && before.version === after.version);

    // two new chapters with no number: each gets its own, no UNIQUE 500
    const book2 = (await db.query(
      `INSERT INTO books (owner_id, title) VALUES ($1, 'Unnumbered') RETURNING id, version`, [owner.id]
    )).rows[0];
    r = await call('PUT', `/api/books/${book2.id}`, owner.token, {
      version: book2.version,
      chapters: [{ id: 1, number: '', title: 'A', content: 'a' }, { id: 2, number: '', title: 'B', content: 'b' }],
    });
    const nums = (await db.query('SELECT chapter_number FROM chapters WHERE book_id = $1 ORDER BY chapter_number', [book2.id])).rows.map(x => x.chapter_number);
    check('unnumbered new chapters save = 200 with distinct numbers', r.status === 200 && nums.join(',') === '1,2', `status ${r.status}, numbers ${nums}`);

    console.log('\n== roles on save');
    const cur = await dbVersion(db, book.id);
    r = await call('PUT', `/api/books/${book.id}`, editor.token, { title: 'Editor', version: cur });
    check('editor save = 200', r.status === 200, `got ${r.status}`);
    r = await call('PUT', `/api/books/${book.id}`, editor.token, { title: 'Editor stale', version: cur });
    check('stale editor save = 409 (not 500)', r.status === 409, `got ${r.status}`);
    const cur2 = await dbVersion(db, book.id);
    for (const [who, u] of [['commenter', commenter], ['viewer', viewer], ['stranger', stranger]]) {
      r = await call('PUT', `/api/books/${book.id}`, u.token, { title: who, version: cur2 });
      check(`${who} save = 403`, r.status === 403, `got ${r.status}`);
    }

    console.log('\n== paywall switch');
    r = await call('GET', '/api/subscriptions/my', owner.token);
    check('/api/subscriptions/my carries unlocked_features', Array.isArray(r.json?.unlocked_features) && r.json.unlocked_features.includes('media_generation'),
      JSON.stringify(r.json));

    console.log('\n== AI quota');
    const used = async () => (await db.query('SELECT ai_requests_today FROM quotas WHERE user_id = $1', [owner.id])).rows[0].ai_requests_today;
    const settle = () => new Promise((res) => setTimeout(res, 400)); // the refund runs on 'close'
    const q0 = await used();
    r = await call('POST', '/api/generate', owner.token, { type: 'character', prompt: 'a brave knight' });
    await settle();
    check('/api/generate succeeds against the gateway', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
    check('one request = one quota slot', (await used()) === q0 + 1, `${q0} -> ${await used()}`);
    const qBeforeFail = await used();
    r = await call('POST', '/api/generate', owner.token, { type: 'character', prompt: 'GATEWAY_FAIL knight' });
    await settle();
    check('a gateway failure (5xx) refunds the slot', r.status >= 500 && (await used()) === qBeforeFail, `status ${r.status}, ${qBeforeFail} -> ${await used()}`);
    const q1 = await used();
    r = await call('POST', '/api/grammar-check', owner.token, { text: 'This are a test.' });
    check('grammar-check does not use AI quota', (await used()) === q1, `${q1} -> ${await used()}`);
    const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const doubled = src.split('\n').filter(l => /app\.(get|post|put|delete)\(/.test(l) && (l.match(/consumeAIQuota/g) || []).length > 1);
    check('no route mounts consumeAIQuota twice', doubled.length === 0, doubled.join(' | ').slice(0, 300));

    console.log('\n== RPG roles');
    r = await call('PUT', `/api/rpg/${book.id}`, viewer.token, { rpgData: { x: 1 } });
    check('viewer RPG write = 403', r.status === 403, `got ${r.status}`);
    r = await call('PUT', `/api/rpg/${book.id}`, commenter.token, { rpgData: { x: 1 } });
    check('commenter RPG write = 403', r.status === 403, `got ${r.status}`);
    r = await call('PUT', `/api/rpg/${book.id}`, editor.token, { rpgData: { x: 1 } });
    check('editor RPG write = 200', r.status === 200, `got ${r.status}`);
    r = await call('GET', `/api/rpg/${book.id}`, viewer.token);
    check('RPG GET returns the saved campaign (no double parse)', r.status === 200 && r.json?.rpgData?.x === 1, `got ${r.status} ${JSON.stringify(r.json)}`);

    console.log('\n== parked API keys');
    r = await call('GET', '/api/external/books');
    check('/api/external/* = 404 without auth', r.status === 404, `got ${r.status}`);

    console.log('\n== job status keyed by type:id');
    const redis = createClient({ url: `redis://${REDIS.host}:${REDIS.port}` });
    await redis.connect();
    const queue = await import('../jobs/queue.js');
    await queue.initializeJobTracking();
    const refA = await queue.storeJobMetadata('901', owner.id, book.id, 'image', { description: 'A image' });
    const refB = await queue.storeJobMetadata('901', stranger.id, book.id, 'audio', { description: 'B audio' });
    check('same Bull id, different refs', refA === 'image:901' && refB === 'audio:901', `${refA} ${refB}`);
    await queue.updateJobStatus({ id: 901, queue: { name: 'audio-generation' } }, { progress: 50, result: 'B-result' });
    check('a processor update lands on its own job only',
      (await queue.getJobStatus(refA)).result === null && (await queue.getJobStatus(refB)).result === 'B-result');
    check('a bare id resolves to nothing', (await queue.getJobStatus('901')) === null);
    r = await call('GET', `/api/jobs/${refA}`, owner.token);
    check('owner reads their job by ref', r.status === 200 && r.json?.jobId === refA, `got ${r.status}`);
    r = await call('GET', `/api/jobs/${refA}`, stranger.token);
    check('another user cannot read it', r.status === 403, `got ${r.status}`);
    r = await call('GET', '/api/jobs', owner.token);
    check('the job list shows only the user\'s own jobs', (r.json?.jobs || []).length === 1 && r.json.jobs[0].jobId === refA);
    r = await call('DELETE', `/api/jobs/${refA}`, owner.token);
    check('delete = 200', r.status === 200, `got ${r.status}`);
    check('delete removed only that job', (await queue.getJobStatus(refA)) === null && (await queue.getJobStatus(refB))?.userId === stranger.id);
    await redis.quit();

    console.log('\n== server-side writes keep concurrent edits');
    Object.assign(process.env, {
      POSTGRES_DB: 'rg_main', POSTGRES_SSL: 'false', POSTGRES_HOST: PG.host, POSTGRES_PORT: String(PG.port),
      POSTGRES_USER: PG.user, POSTGRES_PASSWORD: PG.password,
    });
    const { BookDataService } = await import('../db/dataService.js');
    // a job that loaded the book earlier must not revert a title saved since
    const cur3 = await dbVersion(db, book.id);
    r = await call('PUT', `/api/books/${book.id}`, owner.token, { title: 'Saved mid-job', version: cur3 });
    await BookDataService.applyServerWrite(book.id, owner.id, (fresh) => ({
      audio_files: { ...(fresh.audioFiles || {}), ch1: { url: 'x' } },
    }));
    const row = (await db.query('SELECT title, audio_files FROM books WHERE id = $1', [book.id])).rows[0];
    check('applyServerWrite keeps the user\'s newer title and adds the job result',
      row.title === 'Saved mid-job' && row.audio_files?.ch1?.url === 'x', JSON.stringify(row));
  } finally {
    await srv.stop();
    await db.end();
  }
}

// ─── 2. a database shaped like prod: old schema + legacy files, no tracker ──
async function prodShapedSuite() {
  console.log('\n== prod-shaped database (baseline)');
  const fixture = path.join(__dirname, 'fixtures', 'schema-2.23.32.sql');
  const db = await freshDb('rg_prod');
  try {
    await db.query(fs.readFileSync(fixture, 'utf8'));
    // the 13 legacy files hand-applied in order, like prod, and no
    // schema_migrations table (the shape the 2026-10-06 prod-clone rehearsal had)
    const migDir = path.join(SERVER_DIR, 'db', 'migrations');
    for (const f of fs.readdirSync(migDir).filter(f => /^\d/.test(f)).sort()) {
      await db.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
    }
    const u = (await db.query(`INSERT INTO users (email, password_hash, name) VALUES ('p@regress.local', 'x', 'P') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO books (owner_id, title) VALUES ($1, 'Prod book')`, [u]);
    const snapshot = async () => JSON.stringify((await db.query('SELECT id, title, version FROM books ORDER BY id')).rows);
    const before = await snapshot();

    let srv = await bootServer('rg_prod');
    const applied = (await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
    check('first boot: baselined the 13 legacy files and applied the new ones',
      applied.length === fs.readdirSync(path.join(SERVER_DIR, 'db', 'migrations')).filter(f => f.endsWith('.sql')).length,
      applied.join(','));
    check('first boot: the 13 legacy files were BASELINED, not re-run',
      /baseline: marked 13 pre-runner migration/.test(srv.log()) && !/applying 01_/.test(srv.log()));
    check('first boot: z98 applied (token_version exists)',
      (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='token_version'`)).rowCount === 1);
    check('first boot: existing book rows untouched', (await snapshot()) === before);
    await srv.stop();

    srv = await bootServer('rg_prod');
    check('second boot: nothing new applied', (await db.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n === applied.length);
    check('second boot: book rows still untouched', (await snapshot()) === before);
    await srv.stop();
  } finally {
    await db.end();
  }
}

// ─── 3. a failing migration exits before serving ────────────────────────────
async function failingMigrationSuite() {
  console.log('\n== failing migration');
  const db = await freshDb('rg_fail');
  const bad = path.join(SERVER_DIR, 'db', 'migrations', 'z999_regress_broken.sql');
  fs.writeFileSync(bad, 'SELECT * FROM this_table_does_not_exist;\n');
  try {
    const srv = await bootServer('rg_fail');
    check('the server exits non-zero', srv.exitCode !== null && srv.exitCode !== 0, `exit=${srv.exitCode}`);
    check('...and never answered /api/health', srv.servedHealth === false);
    if (srv.exitCode === null) await srv.stop();
  } finally {
    fs.unlinkSync(bad);
    await db.end();
  }
}

// ─── runner ─────────────────────────────────────────────────────────────────
(async () => {
  // schema.sql up to 2.23.32 grants to a hardcoded story_user role
  await admin(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'story_user') THEN CREATE ROLE story_user LOGIN; END IF; END $$`);
  const redis = createClient({ url: `redis://${REDIS.host}:${REDIS.port}` });
  await redis.connect();
  await redis.flushDb();
  await redis.quit();
  const gateway = await fakeGateway();
  try {
    await mainSuite(gateway);
    await prodShapedSuite();
    await failingMigrationSuite();
  } catch (err) {
    failures.push(`suite error: ${err.message}`);
    console.error(err);
  } finally {
    gateway.close();
    for (const d of ['rg_main', 'rg_prod', 'rg_fail']) await admin(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) console.log('FAILED:\n - ' + failures.join('\n - '));
  process.exit(failures.length ? 1 : 0);
})();
