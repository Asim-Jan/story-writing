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

// 1x1 PNG, and a small WAV whose header carries a LIST chunk (the bridge's do)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function makeWav(pcmBytes) {
  const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')]);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(24000, 12); fmt.writeUInt32LE(48000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const dataHdr = Buffer.alloc(8); dataHdr.write('data', 0); dataHdr.writeUInt32LE(pcmBytes, 4);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, dataHdr, Buffer.alloc(pcmBytes, 7)]);
  const riff = Buffer.alloc(8); riff.write('RIFF', 0); riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

// A fake SAI gateway. Chat gets a small JSON reply (a prompt containing
// GATEWAY_FAIL gets a 500, to exercise the quota refund); images get a PNG;
// speech gets a WAV. Every request body is recorded for the assertions.
async function fakeGateway() {
  const port = await freePort();
  const requests = [];
  const videoJobs = new Map();
  const failedOnce = new Set();
  // a real 1-second MP4 for the video path (ffmpeg joins the clips)
  const { default: ffmpegPath } = await import('ffmpeg-static');
  const clipPath = path.join(os.tmpdir(), `regress-clip-${process.pid}.mp4`);
  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath]);
    ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* not json */ }
      requests.push({ path: req.url, body: parsed });
      if (req.url.endsWith('/systemone')) {
        const answers = {};
        for (const [id] of Object.entries(parsed?.questions || {})) {
          const st = String(parsed?.state?.[id] || '').toLowerCase();
          answers[id] = { type: 'choice', choice: /copyright|dedicat/.test(st) ? 'front' : /about the author/.test(st) ? 'back' : 'chapter', confidence: 0.9 };
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ model: 'sai-decide', answers }));
        return;
      }
      if (req.url.includes('/audio/voices')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.url.includes('qwen')
          ? { object: 'list', data: [{ id: 'Serena', name: 'Serena', kind: 'preset', language: 'English' }, { id: 'v_someone', kind: 'clone' }] }
          : { model: 'vibevoice', voices: ['en-emma_woman', 'de-spk0_man'] }));
        return;
      }
      if (req.url.endsWith('/audio/transcriptions')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ text: 'hello from the sample' }));
        return;
      }
      if (req.url.endsWith('/models') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ object: 'list', data: ['sai-chat', 'sai-chat-fast', 'sai-decide'].map(id => ({ id, object: 'model' })) }));
        return;
      }
      if (req.url.endsWith('/images/generations')) {
        res.setHeader('Content-Type', 'application/json');
        if (parsed?.model === 'character-sheet-quad' || body.includes('GATEWAY_FAIL')) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { message: 'render failed', type: 'media_bridge_error' } }));
          return;
        }
        res.end(JSON.stringify({ created: 0, model: parsed?.model, data: [{ b64_json: PNG_B64 }] }));
        return;
      }
      if (req.url.endsWith('/video/generations')) {
        const jobId = `v${requests.length}`;
        videoJobs.set(jobId, parsed?.prompt || '');
        res.statusCode = 202;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'running', job_id: jobId }));
        return;
      }
      if (req.url.includes('/video/jobs/')) {
        res.setHeader('Content-Type', 'application/json');
        // a prompt containing FAIL_ONCE fails its first render (a transient Station error)
        const prompt = videoJobs.get(req.url.split('/').pop()) || '';
        if (prompt.includes('FAIL_ONCE') && !failedOnce.has(prompt)) {
          failedOnce.add(prompt);
          res.statusCode = 500;
          res.end(JSON.stringify({ status: 'failed', error: 'generation failed: weight is on cpu' }));
          return;
        }
        res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/files/clip.mp4`, seconds: 1 }));
        return;
      }
      if (req.url === '/files/clip.mp4') {
        res.setHeader('Content-Type', 'video/mp4');
        res.end(fs.readFileSync(clipPath));
        return;
      }
      if (req.url.endsWith('/audio/speech')) {
        res.setHeader('Content-Type', 'audio/wav');
        res.end(makeWav(1000));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (body.includes('GATEWAY_FAIL')) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: 'upstream down' } }));
        return;
      }
      const sys = String(parsed?.messages?.[0]?.content || '');
      const usr = String(parsed?.messages?.[1]?.content || '');
      let content = JSON.stringify({ name: 'Sir Test', role: 'Hero', description: 'Brave and kind.' });
      if (/find where chapters start/.test(sys)) {
        const nums = [...usr.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]));
        content = JSON.stringify({ chapters: nums.length > 4 ? [{ start: nums[0], title: 'Chapter 1' }, { start: nums[Math.floor(nums.length / 2)], title: 'Chapter 2' }, { start: 99999, title: 'bogus' }] : [] });
      } else if (/read one chapter of a novel/.test(sys)) {
        content = JSON.stringify({ summary: 'Mira finds a map.', characters: [{ name: 'Mira Vale', role: 'protagonist', description: 'A cartographer', appearance: 'copper hair' }],
          locations: [{ name: 'The Lighthouse', type: 'building', description: 'On a cliff' }], events: [{ title: 'Map found', description: 'She finds it.' }], plot: [{ title: 'The map', description: 'It leads somewhere.' }] });
      } else if (/one-paragraph overview/.test(sys)) {
        content = JSON.stringify({ overview: 'A cartographer follows a map.' });
      }
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'sai-chat',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((r) => server.listen(port, r));
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => server.close() };
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
    MINIO_PORT: process.env.REGRESS_MINIO_PORT || '1',
    MINIO_ACCESS_KEY: process.env.REGRESS_MINIO_USER || 'unused',
    MINIO_SECRET_KEY: process.env.REGRESS_MINIO_PASSWORD || 'unused',
    MINIO_USE_SSL: 'false',
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
    stop: async () => {
      child.kill('SIGTERM');
      // a server that ignores SIGTERM delays every k8s rollout by the grace period: fail, don't hang
      const t = setTimeout(() => { check('the server exits on SIGTERM', false, 'still running 15 s later, killed'); child.kill('SIGKILL'); }, 15000);
      await exited;
      clearTimeout(t);
    },
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
    return { status: r.status, json };
  };
  fn.base = base;
  return fn;
}

async function makeUser(db, label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@regress.local`;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, name, tier) VALUES ($1, 'x', $2, 'free') RETURNING id`,
    [email, label]
  );
  await db.query(
    `INSERT INTO quotas (user_id, max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs)
     VALUES ($1, 3, 50000, 30, 100, 1)
     ON CONFLICT (user_id) DO UPDATE SET max_ai_requests_per_day = 100`,
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

    console.log('\n== AI model backbone');
    {
      const chatModels = () => gateway.requests.filter(q => q.path.endsWith('/chat/completions')).map(q => q.body?.model);
      let n = chatModels().length;
      await call('POST', '/api/generate', owner.token, { type: 'character', prompt: 'a cartographer' });
      check('by default the Writer role calls sai-chat-fast', chatModels().slice(n).includes('sai-chat-fast') && !chatModels().slice(n).includes('sai-chat'), chatModels().slice(n).join(','));
      r = await call('GET', '/api/admin/ai-models', owner.token);
      check('non-admins cannot read the model settings', r.status === 403, `got ${r.status}`);
      await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [owner.id]);
      r = await call('GET', '/api/admin/ai-models', owner.token);
      check('admin sees both roles and the gateway\'s chat models', r.status === 200 && r.json?.roles?.writer?.model === 'sai-chat-fast' && r.json?.available?.includes('sai-chat') && !r.json?.available?.includes('sai-decide'),
        JSON.stringify(r.json).slice(0, 200));
      r = await call('PUT', '/api/admin/ai-models', owner.token, { writer: 'gpt-9' });
      check('an unknown model is refused', r.status === 400, `got ${r.status}`);
      r = await call('PUT', '/api/admin/ai-models', owner.token, { writer: 'sai-chat' });
      n = chatModels().length;
      await call('POST', '/api/generate', owner.token, { type: 'character', prompt: 'a cartographer' });
      check('switching the Writer to sai-chat takes effect without a restart', r.status === 200 && chatModels().slice(n).includes('sai-chat'), chatModels().slice(n).join(','));
      r = await call('POST', '/api/admin/ai-models/test', owner.token, { model: 'sai-chat-fast' });
      check('the model test call answers', r.status === 200 && r.json?.ok === true && typeof r.json?.ms === 'number');
      await call('PUT', '/api/admin/ai-models', owner.token, { writer: 'sai-chat-fast' });
      await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [owner.id]);
    }

    console.log('\n== chat wiring');
    const chatCalls = gateway.requests.filter(q => q.path.endsWith('/chat/completions'));
    check('every chat call turns thinking off', chatCalls.length > 0 && chatCalls.every(q => q.body?.chat_template_kwargs?.enable_thinking === false),
      `${chatCalls.length} calls`);
    // every AI route is metered (these five were free until 2.23.34)
    const unmetered = ['/api/parse-transcript-to-comic', '/api/books/:bookId/analyze-import', '/api/rpg/ai-dm/generate-quest',
      '/api/rpg/ai-dm/generate-balanced-encounter', '/api/rpg/ai-dm/narrate']
      .filter(route => !src.split('\n').some(l => l.includes(`app.post('${route}'`) && l.includes('consumeAIQuota')));
    check('the AI routes that used to be free now use AI quota', unmetered.length === 0, unmetered.join(', '));

    await mediaChecks({ call, db, gateway, owner, stranger, book });

    console.log('\n== a database built from scratch has the same structure as prod (z104)');
    const tpl = await db.query(`INSERT INTO books (owner_id, title, is_template) VALUES (NULL, 'Template', TRUE) RETURNING id`).catch(e => ({ error: e.message }));
    check('a template book (no owner) can be stored', !tpl.error, tpl.error);
    if (!tpl.error) await db.query('DELETE FROM books WHERE id = $1', [tpl.rows[0].id]);
    const viewCols = async (v) => (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [v])).rows.map(r => r.column_name);
    const [bookCols, activeCols] = [await viewCols('books'), await viewCols('active_books')];
    const notInView = bookCols.filter(c => !activeCols.includes(c));
    check('active_books carries every book column', notInView.length === 0, notInView.join(', '));

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

// ─── media wiring: images, character references, speech ─────────────────
async function mediaChecks({ call, db, gateway, owner, stranger, book }) {
  console.log('\n== media wiring');
  if (!process.env.REGRESS_MINIO_PORT) {
    console.log('  (skipped: set REGRESS_MINIO_PORT/USER/PASSWORD to a throwaway MinIO)');
    return;
  }
  const imageCalls = () => gateway.requests.filter(q => q.path.endsWith('/images/generations'));
  const usedQuota = async () => (await db.query('SELECT ai_requests_today FROM quotas WHERE user_id = $1', [owner.id])).rows[0].ai_requests_today;
  const character = { id: 'c1', name: 'Mira', gender: 'woman', age: 30, hairColor: 'copper', eyeColor: 'grey', build: 'wiry' };
  // POST starts a job (202 + jobId); poll until it finishes
  const refJob = async (token, body) => {
    const start = await call('POST', '/api/characters/reference', token, body);
    if (start.status !== 202) return start;
    for (let i = 0; i < 100; i++) {
      await new Promise(res => setTimeout(res, 100));
      const r = await call('GET', `/api/characters/reference/jobs/${start.json.jobId}`, token);
      if (r.status !== 202) return { ...r, jobId: start.json.jobId };
    }
    return { status: 0, json: { error: 'timed out' } };
  };

  let r = await call('POST', '/api/characters/reference-prompt', owner.token, { kind: 'qwen-sheet', character, style: 'ink' });
  check('reference-prompt: Qwen sheet prompt carries the character', r.status === 200 && r.json.model === 'qwen-image-2.1' && /copper hair/.test(r.json.prompt) && r.json.size === '1536x1024',
    JSON.stringify(r.json).slice(0, 200));
  r = await call('POST', '/api/characters/reference-prompt', owner.token, { kind: 'turnaround', character });
  check('reference-prompt: turnaround uses the character-sheet recipe', r.json?.model === 'character-sheet' && r.json?.needsSourceImage === true);
  r = await call('POST', '/api/characters/reference-prompt', owner.token, { kind: 'nonsense', character });
  check('reference-prompt: unknown kind = 400', r.status === 400);

  // turnaround with no portrait: a portrait first, then the sheet as an EDIT of it
  const before = imageCalls().length;
  const q0 = await usedQuota();
  r = await refJob(owner.token, { bookId: book.id, kind: 'turnaround', character });
  const made = imageCalls().slice(before);
  check('turnaround without a portrait: job done with reference + portrait', r.status === 200 && r.json?.status === 'done' && r.json?.reference?.kind === 'turnaround' && r.json?.portrait?.kind === 'portrait',
    `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  check('...the portrait is text-to-image (flux2-klein-9b, no input image)', made[0]?.body?.model === 'flux2-klein-9b' && !made[0]?.body?.image);
  check('...the sheet is character-sheet WITH the portrait as a data URL, at 1536x1024',
    made[1]?.body?.model === 'character-sheet' && /^data:image\/png;base64,/.test(made[1]?.body?.image || '') && made[1]?.body?.size === '1536x1024');
  await new Promise(res => setTimeout(res, 300));
  check('...one request = one quota slot', (await usedQuota()) === q0 + 1, `${q0} -> ${await usedQuota()}`);
  const refUrl = r.json?.reference?.imageUrl;
  let img = await fetch(`${call.base}${refUrl}`, { headers: { Authorization: `Bearer ${owner.token}` } });
  check('...the sheet is readable by its owner', img.status === 200);
  img = await fetch(`${call.base}${refUrl}`, { headers: { Authorization: `Bearer ${stranger.token}` } });
  check('...and not by another user', img.status === 404);
  const peek = await call('GET', `/api/characters/reference/jobs/${r.jobId}`, stranger.token);
  check('...and the job itself is not readable by another user', peek.status === 404, `got ${peek.status}`);
  const turnaroundJson = r.json;

  // a sheet that fails after its portrait: the portrait comes back, slot kept
  const qa = await usedQuota();
  r = await refJob(owner.token, { bookId: book.id, kind: 'turnaround-quad', character });
  await new Promise(res => setTimeout(res, 300));
  check('a failed sheet still returns the portrait it made', r.json?.status === 'failed' && r.json?.portrait?.kind === 'portrait', JSON.stringify(r.json).slice(0, 200));
  check('...and keeps the quota slot (a render was produced)', (await usedQuota()) === qa + 1, `${qa} -> ${await usedQuota()}`);
  // nothing produced at all: refunded
  const qb = await usedQuota();
  r = await refJob(owner.token, { bookId: book.id, kind: 'portrait', character: { ...character, name: 'GATEWAY_FAIL' } });
  await new Promise(res => setTimeout(res, 300));
  check('a job that produced nothing fails and refunds the slot', r.json?.status === 'failed' && !r.json?.portrait && (await usedQuota()) === qb, `${qb} -> ${await usedQuota()} ${JSON.stringify(r.json).slice(0, 120)}`);

  // using someone else's image as the source is refused
  r = await refJob(stranger.token, { kind: 'turnaround', character: { ...character, imageUrl: refUrl } });
  check('another user\'s image as the source fails (not found)', r.json?.status === 'failed' && /not found/i.test(r.json?.error || ''), JSON.stringify(r.json).slice(0, 160));

  // the Comic tab's old route works again
  r = await call('POST', '/api/generate-character-reference', owner.token, { bookId: book.id, characterId: 'c1', character: { ...character, imageUrl: turnaroundJson?.portrait?.imageUrl || refUrl } });
  check('old /api/generate-character-reference = 200 with imageUrl', r.status === 200 && /^\/api\/media\/images\//.test(r.json?.imageUrl || ''), `got ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);

  // a comic panel with one character who has a portrait is a Qwen edit of it
  const portraitUrl = (await refJob(owner.token, { bookId: book.id, kind: 'portrait', character })).json?.reference?.imageUrl;
  const b2 = imageCalls().length;
  r = await call('POST', '/api/generate-comic-panel', owner.token, { bookId: book.id, sceneDescription: 'she opens the door', characters: [{ ...character, imageUrl: portraitUrl }] });
  const panel = imageCalls()[b2];
  check('comic panel with a lone portrait = qwen-image-2.1 edit of it', r.status === 200 && panel?.body?.model === 'qwen-image-2.1' && /^data:image/.test(panel?.body?.image || ''),
    `status ${r.status} model ${panel?.body?.model}`);

  // old DALL-E sizes map to sizes the bridge renders
  const b3 = imageCalls().length;
  r = await call('POST', '/api/generate-image', owner.token, { prompt: 'a lighthouse', size: '1792x1024', bookId: book.id });
  check('generate-image maps 1792x1024 to 1536x864', r.status === 200 && imageCalls()[b3]?.body?.size === '1536x864', `size ${imageCalls()[b3]?.body?.size}`);

  // ── book media jobs: progress and results outlive the screen ──
  const jobsUrl = `/api/books/${book.id}/media-jobs`;
  const waitJob = async (token, jobId) => {
    for (let i = 0; i < 600; i++) {
      const list = await call('GET', jobsUrl, token);
      const job = (list.json?.jobs || []).find(j => j.jobId === jobId);
      if (job && job.status !== 'running') return job;
      await new Promise(res => setTimeout(res, 200));
    }
    return null;
  };
  const qj = await usedQuota();
  r = await call('POST', jobsUrl, owner.token, { type: 'image', target: { type: 'location', id: 'loc1' }, params: {} });
  await new Promise(res => setTimeout(res, 300));
  check('media job: a bad request = 400 and costs no quota', r.status === 400 && (await usedQuota()) === qj, `status ${r.status}`);
  r = await call('POST', jobsUrl, owner.token, { type: 'image', target: { type: 'location', id: 'loc1' }, params: { prompt: 'a misty harbour' } });
  check('media job: start = 202 with a running job', r.status === 202 && r.json?.job?.status === 'running' && r.json?.job?.target?.id === 'loc1', `status ${r.status}`);
  const imageJobId = r.json?.job?.jobId;
  let listed = await call('GET', jobsUrl, owner.token);
  check('media job: listed for its book while it runs or right after', (listed.json?.jobs || []).some(j => j.jobId === imageJobId));
  let done = await waitJob(owner.token, imageJobId);
  check('media job: image done with an imageUrl the owner can read', done?.status === 'done' && /^\/api\/media\/images\//.test(done?.result?.imageUrl || '') &&
    (await fetch(`${call.base}${done.result.imageUrl}`, { headers: { Authorization: `Bearer ${owner.token}` } })).status === 200, JSON.stringify(done).slice(0, 200));
  listed = await call('GET', jobsUrl, stranger.token);
  check('media job: another user\'s list does not show it', (listed.json?.jobs || []).length === 0);
  r = await call('POST', `${jobsUrl}/${imageJobId}/ack`, owner.token);
  listed = await call('GET', jobsUrl, owner.token);
  check('media job: ack removes it from the list', r.status === 200 && !(listed.json?.jobs || []).some(j => j.jobId === imageJobId));

  r = await call('POST', jobsUrl, owner.token, { type: 'reference', target: { type: 'character', id: 'c1' }, params: { kind: 'turnaround', character } });
  done = await waitJob(owner.token, r.json?.job?.jobId);
  check('media job: reference done with reference + portrait', done?.status === 'done' && done?.result?.reference?.kind === 'turnaround' && done?.result?.portrait?.kind === 'portrait');
  await call('POST', `${jobsUrl}/${done?.jobId}/ack`, owner.token);

  // a job whose process died (no heartbeat for minutes) reads as interrupted
  {
    const redis = createClient({ url: `redis://${REDIS.host}:${REDIS.port}` });
    await redis.connect();
    const ghost = { jobId: 'ghost-1', userId: owner.id, bookId: book.id, type: 'image', target: { type: 'cover', id: null }, label: 'x',
      status: 'running', progress: {}, result: null, error: null, startedAt: new Date(Date.now() - 600000).toISOString(),
      updatedAt: new Date(Date.now() - 600000).toISOString(), finishedAt: null };
    await redis.set('mjob:ghost-1', JSON.stringify(ghost), { EX: 600 });
    await redis.zAdd(`mjobs:book:${book.id}:${owner.id}`, { score: Date.now(), value: 'ghost-1' });
    listed = await call('GET', jobsUrl, owner.token);
    const g = (listed.json?.jobs || []).find(j => j.jobId === 'ghost-1');
    check('media job: a stale running job is reported as interrupted', g?.status === 'failed' && /interrupted/i.test(g?.error || ''), JSON.stringify(g));
    await call('POST', `${jobsUrl}/ghost-1/ack`, owner.token);
    await redis.quit();
  }

  // animation: per-scene progress and a project result (the server does not write the book).
  // The book's cast has Mira with a portrait, so her scenes are drawn from it.
  const portraitForFilm = (await refJob(owner.token, { bookId: book.id, kind: 'portrait', character })).json?.reference?.imageUrl;
  await db.query('UPDATE books SET characters = $2 WHERE id = $1', [book.id, JSON.stringify([{ id: 'c1', name: 'Mira Vale', imageUrl: portraitForFilm }])]);
  const versionBefore = (await db.query('SELECT version FROM books WHERE id = $1', [book.id])).rows[0].version;
  const filmStart = gateway.requests.length;
  r = await call('POST', jobsUrl, owner.token, { type: 'animation', target: { type: 'animation', id: 't1' }, params: {
    options: { style: 'animated' },
    scenes: [{ sceneNumber: 1, title: 'A', visualPrompt: 'Mira climbs the lighthouse stairs', characters: ['Mira'], duration: 1 },
      { sceneNumber: 2, title: 'B', visualPrompt: 'Mira looks out at the waves FAIL_ONCE', characters: ['mira vale'], duration: 1 }] } });
  const animId = r.json?.job?.jobId;
  let sawProgress = false;
  for (let i = 0; i < 300; i++) {
    const j = (await call('GET', jobsUrl, owner.token)).json?.jobs?.find(x => x.jobId === animId);
    if (j?.progress?.scenes?.some(sc => sc.status === 'completed' || sc.status === 'rendering')) sawProgress = true;
    if (j && j.status !== 'running') { done = j; break; }
    await new Promise(res => setTimeout(res, 500));
  }
  check('media job: animation reports per-scene progress', sawProgress);
  check('media job: animation done with a project and a playable film', done?.status === 'done' && /^\/api\/media\/videos\//.test(done?.result?.project?.finalVideo?.videoUrl || '') &&
    done?.result?.project?.finalVideo?.duration === 2, JSON.stringify(done).slice(0, 240));
  check('media job: the server did not write the book (no 409 for the user)', (await db.query('SELECT version FROM books WHERE id = $1', [book.id])).rows[0].version === versionBefore);
  const filmCalls = gateway.requests.slice(filmStart);
  const keyframes = filmCalls.filter(q => q.path.endsWith('/images/generations') && q.body?.model === 'qwen-image-2.1');
  const starts = filmCalls.filter(q => q.path.endsWith('/video/generations'));
  check('film: a 16:9 keyframe per scene (qwen-image-2.1, 1280x720, canvas:size)',
    keyframes.length === 2 && keyframes.every(k => k.body.size === '1280x720' && k.body.canvas === 'size'), `${keyframes.length} keyframes`);
  check('film: scene 1 keyframe references the character\'s portrait', /^data:image\//.test(keyframes[0]?.body?.image || '') && /image 1 is Mira Vale/.test(keyframes[0]?.body?.prompt || ''),
    (keyframes[0]?.body?.prompt || '').slice(0, 200));
  check('film: scene 2 keyframe references the portrait AND the previous clip\'s last frame', keyframes[1]?.body?.images?.length === 2 && /previous shot/.test(keyframes[1]?.body?.prompt || ''));
  check('film: every clip starts from its keyframe, in the locked style, never "realistic"',
    starts.length === 3 && starts.every(v => /^data:image\//.test(v.body?.image || '') && /stylised 3D animated/.test(v.body?.prompt || '') && !/realistic/i.test(v.body?.prompt || '')),
    (starts[0]?.body?.prompt || '').slice(0, 160));
  check('film: a clip that fails once is retried and the scene still renders',
    done?.result?.project?.scenes?.[1]?.status === 'completed' && starts.length === 3,
    `scene2 ${done?.result?.project?.scenes?.[1]?.status}`);
  check('film: the project records the style, keyframes and cast',
    done?.result?.project?.style === 'animated' && done.result.project.scenes.every(sc => /^\/api\/media\/images\/keyframe-/.test(sc.keyframeUrl || '') && sc.cast?.[0] === 'Mira Vale'));
  await call('POST', `${jobsUrl}/${animId}/ack`, owner.token);

  // ── import (rebuilt): ePub structure, formats, review ops, create once, analysis ──
  await importChecks({ call, db, owner, stranger, jobsUrl, waitJob });
  // ── audiobook voices: presets, custom clones, the audiobook job ──
  {
    r = await call('GET', '/api/audiobook/voices', owner.token);
    check('voices: both engines\' presets, clones on the shared engine hidden',
      r.json?.vibevoice?.some(v => v.id === 'en-emma_woman' && /Emma \(English, woman\)/.test(v.name)) && r.json?.qwen?.length === 1 && Array.isArray(r.json?.custom),
      JSON.stringify(r.json).slice(0, 220));
    const { default: ffmpegPath } = await import('ffmpeg-static');
    const tone = async (secs) => {
      const f = path.join(os.tmpdir(), `regress-voice-${secs}-${process.pid}.wav`);
      await new Promise((ok, bad) => spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${secs}`, f]).on('exit', c => (c === 0 ? ok() : bad(new Error('ffmpeg')))));
      return fs.readFileSync(f);
    };
    const upload = async (fields, wav) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (wav) fd.append('sample', new Blob([wav], { type: 'audio/wav' }), 'sample.wav');
      const res = await fetch(`${call.base}/api/voices`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` }, body: fd });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const five = await tone(5);
    r = await upload({ name: 'Narrator' }, five);
    check('custom voice: refused without consent', r.status === 400 && /permission/.test(r.json?.error || ''), JSON.stringify(r.json));
    r = await upload({ name: 'Too short', consent: 'true' }, await tone(1));
    check('custom voice: a 1-second sample is refused', r.status === 400 && /too short/.test(r.json?.error || ''));
    r = await upload({ name: 'Narrator', consent: 'true' }, five);
    const voice = r.json?.voice;
    check('custom voice: created, transcribed automatically, sample playable by its owner',
      r.status === 201 && voice?.transcript === 'hello from the sample' && Math.abs(voice?.durationSec - 5) < 0.2 &&
      (await fetch(`${call.base}${voice.sampleUrl}`, { headers: { Authorization: `Bearer ${owner.token}` } })).status === 200,
      JSON.stringify(r.json).slice(0, 200));
    const other = await fetch(`${call.base}${voice?.sampleUrl}`, { headers: { Authorization: `Bearer ${stranger.token}` } });
    check('custom voice: the sample is private', other.status === 404);

    const before = gateway.requests.length;
    const pv = await fetch(`${call.base}/api/audiobook/preview`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: { engine: 'qwen', customVoiceId: voice?.id } }) });
    const pvSpeech = gateway.requests.slice(before).find(q => q.path.endsWith('/audio/speech'));
    check('preview in a cloned voice: MP3 back; the bridge got qwen3-tts + the sample + its transcript',
      pv.status === 200 && pv.headers.get('content-type') === 'audio/mpeg' && pvSpeech?.body?.model === 'qwen3-tts' &&
      /^data:audio\/wav;base64,/.test(pvSpeech?.body?.ref_audio || '') && pvSpeech?.body?.ref_text === 'hello from the sample',
      `status ${pv.status} model ${pvSpeech?.body?.model}`);
    const strangerPv = await fetch(`${call.base}/api/audiobook/preview`, { method: 'POST', headers: { Authorization: `Bearer ${stranger.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: { engine: 'qwen', customVoiceId: voice?.id } }) });
    check('another user cannot speak with someone else\'s cloned voice', strangerPv.status === 404, `got ${strangerPv.status}`);

    const chapterIds = (await db.query('SELECT id FROM chapters WHERE book_id = $1 AND deleted_at IS NULL ORDER BY chapter_number', [book.id])).rows.map(x => x.id);
    r = await call('POST', jobsUrl, owner.token, { type: 'audiobook', target: { type: 'audiobook', id: null }, params: { voice: { engine: 'vibevoice', voice: 'en-emma_woman' }, chapterIds } });
    const ab = await waitJob(owner.token, r.json?.job?.jobId);
    const files = Object.values(ab?.result?.files || {});
    check('audiobook job: one MP3 per saved chapter', ab?.status === 'done' && files.length === chapterIds.length && files.every(f => f.format === 'mp3' && /\.mp3$/.test(f.audioUrl)),
      JSON.stringify(ab).slice(0, 220));
    const mp3 = await fetch(`${call.base}${files[0]?.audioUrl}`, { headers: { Authorization: `Bearer ${owner.token}`, Range: 'bytes=0-99' } });
    check('audio answers Range requests (Safari seeking)', mp3.status === 206 && mp3.headers.get('content-range')?.startsWith('bytes 0-99/') && (await mp3.arrayBuffer()).byteLength === 100,
      `status ${mp3.status} ${mp3.headers.get('content-range')}`);
    await call('POST', `${jobsUrl}/${ab?.jobId}/ack`, owner.token);

    r = await call('DELETE', `/api/voices/${voice?.id}`, owner.token);
    const gone = await fetch(`${call.base}/api/audiobook/preview`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: { engine: 'qwen', customVoiceId: voice?.id } }) });
    check('a deleted voice is gone', r.status === 200 && gone.status === 404);
  }

  // long text to speech = one valid WAV
  const longText = 'The tide came in slowly over the black sand. '.repeat(250); // ~11k chars, 3 chunks
  r = await call('POST', '/api/generate-audio', owner.token, { text: longText, voice: 'nova', bookId: book.id });
  const speechCalls = gateway.requests.filter(q => q.path.endsWith('/audio/speech'));
  check('long text is spoken in several chunks', r.status === 200 && speechCalls.length >= 3, `status ${r.status}, ${speechCalls.length} calls`);
  check('...each chunk under VibeVoice\'s 3000-character cut-off', speechCalls.every(q => (q.body?.input || '').length <= 2800),
    `max ${Math.max(...speechCalls.map(q => (q.body?.input || '').length))}`);
  if (r.status === 200) {
    const wav = Buffer.from(await (await fetch(`${call.base}${r.json.audioUrl}`, { headers: { Authorization: `Bearer ${owner.token}` } })).arrayBuffer());
    const dataIdx = wav.indexOf('data', 12, 'ascii');
    const dataLen = wav.readUInt32LE(dataIdx + 4);
    check('...merged into ONE valid WAV (one data chunk, sizes add up)',
      wav.readUInt32LE(4) === wav.length - 8 && dataLen === wav.length - dataIdx - 8 && wav.indexOf('RIFF', 4, 'ascii') === -1,
      `riff ${wav.readUInt32LE(4)} len ${wav.length} data ${dataLen}`);
  }
}

// ─── book import ──────────────────────────────────────────────────────────
async function importChecks({ call, db, owner, stranger, jobsUrl, waitJob }) {
  console.log('\n== book import');
  const { default: JSZip } = await import('jszip');
  const xhtml = (title, body, type = '') => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body${type ? ` epub:type="${type}"` : ''}>${body}</body></html>`;
  const para = (n, word) => Array.from({ length: n }, (_, i) => `<p>${word} sentence ${i} walks along the cliff and the lighthouse keeper&#8217;s lamp burns.</p>`).join('');
  const epub = new JSZip();
  epub.file('mimetype', 'application/epub+zip');
  epub.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  epub.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Keeper</dc:title><dc:creator>Ada Writer</dc:creator><dc:language>en</dc:language></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="copy" href="copyright.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="about" href="about.xhtml" media-type="application/xhtml+xml"/></manifest>
    <spine><itemref idref="cover"/><itemref idref="copy"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="about"/></spine></package>`);
  epub.file('OEBPS/nav.xhtml', xhtml('Contents', '<nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">One: The Storm</a></li><li><a href="text/ch2.xhtml#start">Two: The Map</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="copyright-page" href="copyright.xhtml">Copyright</a></li></ol></nav>'));
  epub.file('OEBPS/cover.xhtml', xhtml('Cover', '<img src="cover.jpg"/>'));
  epub.file('OEBPS/copyright.xhtml', xhtml('Copyright', '<p>Copyright 2026 Ada Writer. All rights reserved.</p>'));
  epub.file('OEBPS/text/ch1.xhtml', xhtml('ch1', `<h1>Chapter One</h1>${para(30, 'Storm')}`, 'bodymatter chapter'));
  epub.file('OEBPS/text/ch2.xhtml', xhtml('ch2', `<h1>Chapter Two</h1>${para(30, 'Map')}`, 'bodymatter chapter'));
  epub.file('OEBPS/about.xhtml', xhtml('About', '<h2>About the Author</h2><p>Ada Writer lives by the sea.</p>'));
  const epubBuf = await epub.generateAsync({ type: 'nodebuffer' });

  const upload = async (token, name, buf) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), name);
    const res = await fetch(`${call.base}/api/imports`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const settle = async (token, id) => {
    for (let i = 0; i < 300; i++) {
      const r = await call('GET', `/api/imports/${id}`, token);
      if (r.json?.import && r.json.import.status !== 'parsing') return r.json.import;
      await new Promise(res => setTimeout(res, 100));
    }
    return null;
  };

  let r = await upload(owner.token, 'book.zip', Buffer.from('nope'));
  check('import: an unsupported file type = 400', r.status === 400);
  r = await upload(owner.token, 'The Keeper.epub', epubBuf);
  check('import: upload = 202, parsing in the background', r.status === 202 && r.json?.import?.status === 'parsing');
  let imp = await settle(owner.token, r.json?.import?.id);
  const kinds = (imp?.chapters || []).map(c => `${c.kind}:${c.title}`);
  check('ePub: title and author from the package', imp?.status === 'review' && imp.title === 'The Keeper' && imp.author === 'Ada Writer', JSON.stringify(imp).slice(0, 200));
  check('ePub: spine order, TOC titles (their "One:" numbering dropped), front/back matter classified, image-only cover skipped',
    kinds.join('|') === 'front:Copyright|chapter:The Storm|chapter:The Map|back:About the Author', kinds.join('|'));
  const ch1 = await call('GET', `/api/imports/${imp?.id}/chapters/1`, owner.token);
  check('ePub: entities decoded, paragraphs kept', /keeper’s lamp/.test(ch1.json?.chapter?.content || '') && (ch1.json?.chapter?.content || '').split('\n\n').length >= 30);
  r = await call('GET', `/api/imports/${imp?.id}`, stranger.token);
  check('import: another user cannot see it', r.status === 404);

  // review ops: small edits, never the whole book
  r = await call('PATCH', `/api/imports/${imp?.id}/chapters`, owner.token, { ops: [{ op: 'nonsense' }] });
  check('review: a bad op = 400', r.status === 400);
  const c1len = (ch1.json?.chapter?.content || '').length;
  r = await call('PATCH', `/api/imports/${imp?.id}/chapters`, owner.token, { ops: [
    { op: 'rename', index: 1, title: 'The Storm' },
    { op: 'split', index: 1, at: Math.floor(c1len / 2), title: 'The Storm, part 2' },
    { op: 'merge', index: 2 },
    { op: 'kind', index: 0, kind: 'front' },
  ] });
  const after = r.json?.import?.chapters || [];
  check('review: rename, split, merge and kind apply in order', r.status === 200 && after.length === 4 && after[1].title === 'The Storm' && after[2].title === 'The Storm, part 2' && after[2].wordCount > 300,
    after.map(c => `${c.kind}:${c.title}:${c.wordCount}`).join('|'));

  // create once
  const booksBefore = (await db.query('SELECT COUNT(*)::int n FROM books WHERE owner_id = $1', [owner.id])).rows[0].n;
  const [first, second] = await Promise.all([
    call('POST', `/api/imports/${imp?.id}/create`, owner.token, {}),
    call('POST', `/api/imports/${imp?.id}/create`, owner.token, {}),
  ]);
  const bookId = first.json?.bookId || second.json?.bookId;
  const booksAfter = (await db.query('SELECT COUNT(*)::int n FROM books WHERE owner_id = $1', [owner.id])).rows[0].n;
  check('create: two clicks at once make ONE book', bookId && first.json?.bookId === second.json?.bookId && booksAfter === booksBefore + 1,
    `${first.status}/${second.status} ${booksBefore}->${booksAfter}`);
  const rows = (await db.query('SELECT chapter_number, title FROM chapters WHERE book_id = $1 AND deleted_at IS NULL ORDER BY chapter_number', [bookId])).rows;
  check('create: only story sections, numbered in order', rows.map(x => `${x.chapter_number}:${x.title}`).join('|') === '1:The Storm|2:The Storm, part 2', rows.map(x => `${x.chapter_number}:${x.title}`).join('|'));
  const job = (first.json?.analysisJob || second.json?.analysisJob);
  const analysed = job ? await (async () => {
    for (let i = 0; i < 300; i++) {
      const l = await call('GET', `/api/books/${bookId}/media-jobs`, owner.token);
      const j = (l.json?.jobs || []).find(x => x.jobId === job.jobId);
      if (j && j.status !== 'running') return j;
      await new Promise(res => setTimeout(res, 200));
    }
    return null;
  })() : null;
  check('analysis job: characters, locations, plotlines, summaries per chapter, overview',
    analysed?.status === 'done' && analysed.result.characters[0]?.name === 'Mira Vale' && analysed.result.characters[0]?.mentions === 2 &&
    analysed.result.locations.length === 1 && Object.keys(analysed.result.chapterSummaries).length === 2 && analysed.result.overview,
    JSON.stringify(analysed).slice(0, 220));

  r = await upload(owner.token, 'The Keeper.epub', epubBuf);
  check('duplicate: the same file again says which book it made', r.json?.import?.duplicateOf?.bookId === bookId);
  await call('DELETE', `/api/imports/${r.json?.import?.id}`, owner.token);

  // Word: heading styles split the chapters; text before the first heading is kept
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  docx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  docx.file('word/styles.xml', '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  const wp = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  docx.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${wp('A note before the story begins.')}${wp('The Arrival', 'Heading1')}${wp('She came by boat.')}${wp('The Departure', 'Heading1')}${wp('He left by train.')}</w:body></w:document>`);
  r = await upload(owner.token, 'novel.docx', await docx.generateAsync({ type: 'nodebuffer' }));
  imp = await settle(owner.token, r.json?.import?.id);
  check('Word: split on Heading 1, the opening note kept as "Opening", title from the file name',
    (imp?.chapters || []).map(c => c.title).join('|') === 'Opening|The Arrival|The Departure' && /note before/.test(imp.chapters[0].preview) && imp.title === 'novel',
    (imp?.chapters || []).map(c => `${c.kind}:${c.title}`).join('|'));

  // text in Windows-1252 with smart quotes, chapter headings, a preamble
  const cp1252 = Buffer.concat([Buffer.from('A preamble that is not a chapter.\n\nChapter 1\n\nShe said \x93hello\x94 and smiled.\n\nCHAPTER TWO\n\nThe end.', 'latin1')]);
  r = await upload(owner.token, 'old.txt', cp1252);
  imp = await settle(owner.token, r.json?.import?.id);
  check('text: Windows-1252 decoded, headings split, nothing dropped',
    (imp?.chapters || []).length === 3 && /\u201chello\u201d/.test(imp.chapters[1].preview) && /preamble/.test(imp.chapters[0].preview),
    JSON.stringify((imp?.chapters || []).map(c => c.preview)).slice(0, 220));

  r = await upload(owner.token, 'notes.md', Buffer.from('# Part One\n\nAlpha text.\n\n# Part Two\n\nBeta text.'));
  imp = await settle(owner.token, r.json?.import?.id);
  check('Markdown: split on # headings', (imp?.chapters || []).map(c => c.title).join('|') === 'Part One|Part Two');

  // no headings at all: the model finds the chapters from numbered paragraphs; bogus numbers are ignored
  const plain = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'word '.repeat(90)}`).join('\n\n');
  r = await upload(owner.token, 'unbroken.txt', Buffer.from(plain));
  imp = await settle(owner.token, r.json?.import?.id);
  check('no headings: AI finds the chapters, validated, every paragraph kept',
    (imp?.chapters || []).filter(c => c.source === 'ai').length === 2 && imp.warnings.some(w => /found by AI/.test(w)) &&
    imp.chapters.reduce((n, c) => n + c.wordCount, 0) === 40 * 92,
    JSON.stringify(imp?.chapters?.map(c => [c.source, c.wordCount])) + ' ' + JSON.stringify(imp?.warnings));
  r = await call('GET', '/api/imports', owner.token);
  check('imports list: recent imports to resume', r.status === 200 && r.json.imports.length >= 4 && r.json.imports[0].chapters === undefined);
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
    // like prod: 09 counted as applied, yet ai_generations has none of its columns or trigger
    await db.query(`DROP TRIGGER IF EXISTS trg_update_cost_summary ON ai_generations;
      ALTER TABLE ai_generations DROP COLUMN IF EXISTS prompt_tokens, DROP COLUMN IF EXISTS completion_tokens,
        DROP COLUMN IF EXISTS total_tokens, DROP COLUMN IF EXISTS estimated_cost_usd`);

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
    await db.query(`INSERT INTO ai_generations (user_id, tool_type, prompt, result, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
      VALUES ($1, 'character', 'p', '{}', 'sai-chat-fast', 10, 5, 15, 0.001)`, [u]);
    const summary = (await db.query('SELECT total_tokens, text_requests FROM ai_cost_summary WHERE user_id = $1', [u])).rows[0];
    check('first boot: z103 restored the ai_generations cost columns and the daily summary trigger',
      summary?.total_tokens === 15 && summary?.text_requests === 1, JSON.stringify(summary));
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
