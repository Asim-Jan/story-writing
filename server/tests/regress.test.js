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
  // a real tone for speech that asks for one ("TONE") and an MP3 music bed
  const tonePath = path.join(os.tmpdir(), `regress-tone-${process.pid}.wav`);
  const musicPath = path.join(os.tmpdir(), `regress-music-${process.pid}.mp3`);
  for (const [file, args] of [[tonePath, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '24000', '-ac', '1']], [musicPath, ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-c:a', 'libmp3lame', '-b:a', '64k']]]) {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', ...args, file]);
      ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });
  }
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
        res.end(/TONE/.test(parsed?.input || '') ? fs.readFileSync(tonePath) : makeWav(1000));
        return;
      }
      if (req.url.endsWith('/audio/music')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ model: 'ace-step-1.5', seed: 1, seconds: parsed?.seconds, b64_mp3: fs.readFileSync(musicPath).toString('base64') }));
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
        content = JSON.stringify({ summary: 'Mira finds a map.', characters: [{ name: 'Mira Vale', role: 'protagonist', description: 'A cartographer', appearance: 'copper hair' }, { name: 'Mira', role: 'supporting', description: 'Short form' }],
          locations: [{ name: 'The Lighthouse', type: 'building', description: 'On a cliff' }, ...(/Known places so far: The Lighthouse/.test(usr) ? [{ name: 'Lighthouse - exterior', type: 'building', description: 'Seen from the sea' }] : [])], events: [{ title: 'Map found', description: 'She finds it.' }], plot: [{ title: 'The map', description: 'It leads somewhere.' }] });
      } else if (/check how an imported book was split/.test(sys)) {
        // a rule-based stand-in for the model: a chapter that ends mid-sentence
        // continues in the next; a "Bonus" section is back matter; plus junk
        // (an index out of range, a kind that is already right) to be filtered
        const rows = [...usr.matchAll(/^\[(\d+)\] kind=(\w+) words=\d+ title="([^"]*)" \| starts: "[^"]*" \| ends: "([^"]*)"$/gm)]
          .map(m => ({ index: Number(m[1]), kind: m[2], title: m[3], ends: m[4] }));
        const merges = rows.filter((x, i) => x.kind === 'chapter' && rows[i + 1]?.kind === 'chapter' && !/[.!?"”’]$/.test(x.ends)).map(x => ({ index: x.index, reason: 'ends mid-sentence' }));
        const kinds = rows.filter(x => /bonus/i.test(x.title) && x.kind !== 'back').map(x => ({ index: x.index, kind: 'back', reason: 'a bonus scene, not the story' }));
        content = JSON.stringify({ kinds: [...kinds, { index: 99, kind: 'back' }, { index: 0, kind: rows[0]?.kind }], merges, titles: [{ index: 0, title: 'Not generic so ignored' }] });
      } else if (/note everything they reveal about ONE character/.test(sys)) {
        // notes per batch of passages: a fact per chapter heading it was shown
        const heads = [...usr.matchAll(/^\[#(\d+) [^\]]*\]$/gm)].map(m => Number(m[1]));
        content = JSON.stringify({ facts: [
          ...(/copper/.test(usr) ? [{ about: 'looks', fact: 'copper hair', chapter: heads[0] }] : []),
          ...(/her brother Tomas/.test(usr) ? [{ about: 'relationship', fact: 'Tomas is her brother', with: 'Tomas Reed', chapter: heads.at(-1) }] : []),
          { about: 'personality', fact: 'stubborn', chapter: heads.at(-1) },
        ] });
      } else if (/checking the opening frame of one scene before it is animated/.test(sys)) {
        const parts = Array.isArray(parsed?.messages?.[1]?.content) ? parsed.messages[1].content : [];
        const pics = parts.filter(x => x.type === 'image_url' && /^data:image\/jpeg;base64,/.test(x.image_url?.url || '')).length;
        content = JSON.stringify({ verdict: 'fix', notes: [`saw ${pics} pictures`, 'Mara is too small in the frame'], prompt: 'Medium shot at dusk: Mara Quinn climbs the last steps to the lighthouse.' });
      } else if (/reviewing the cut of a short film/.test(sys)) {
        content = JSON.stringify({ overall: 'Slow the ending down.', scenes: [
          { sceneNumber: 2, note: 'Hold the lamp moment longer.', duration: 8, transition: 'fade' },
          { sceneNumber: 1, note: 'Fine opening.', duration: 30, transition: 'fade' },
          { sceneNumber: 99, note: 'no such scene' }, { sceneNumber: 2, note: 'a second entry' }] });
      } else if (/You write the voice-over for a short film/.test(sys)) {
        // far too long, so the server trims it at a sentence
        content = JSON.stringify({ narration: 'The keeper climbed alone. '.repeat(40).trim() });
      } else if (/check the opening frame of a film scene/.test(sys)) {
        // the frame has the scene's text and a JPEG; "TWIN_ONCE" = the first draw shows someone twice
        const parts = Array.isArray(parsed?.messages?.[1]?.content) ? parsed.messages[1].content : [];
        const text = parts.filter(x => x.type === 'text').map(x => x.text).join(' ');
        const jpeg = /^data:image\/jpeg;base64,/.test(parts.find(x => x.type === 'image_url')?.image_url?.url || '');
        const twin = jpeg && /TWIN_ONCE/.test(text) && !failedOnce.has('twin');
        if (twin) failedOnce.add('twin');
        content = JSON.stringify(twin ? { figures: 2, duplicated: true, note: 'Olive appears twice.' } : { figures: jpeg ? 1 : 0, duplicated: false, note: jpeg ? 'fine' : 'no image' });
      } else if (/check a novel's list of locations for duplicates/.test(sys)) {
        // Mira's flat and the cottage on Harrow Lane are one home; plus a group with a bad index
        const rows = [...usr.matchAll(/^\[(\d+)\] ([^|]+?) \|/gm)].map(m => ({ i: Number(m[1]), name: m[2] }));
        const at = (n) => rows.find(r => r.name === n)?.i;
        content = JSON.stringify({ groups: [{ same: [at("Mira's flat"), at('The cottage on Harrow Lane')], keep: at('The cottage on Harrow Lane'), reason: 'Both are where Mira lives.' },
          { same: [99, at('Harbour Cafe')], keep: 99 }] });
      } else if (/sort the capitalised names found in a novel/.test(sys)) {
        // Aslan is a person (named more fully), Harrow Bay a place, the Admiralty neither; plus an invented name
        const rows = [...usr.matchAll(/^\[(\d+)\] ([^|]+?) \|/gm)].map(m => ({ i: Number(m[1]), name: m[2] }));
        const at = (n) => rows.find(r => r.name === n)?.i;
        content = JSON.stringify({ people: [{ name: 'Captain Aslan', from: [at('Aslan')], role: 'minor', description: 'An old sailor.' }, { name: 'Zed Invented', from: [at('Admiralty')] }],
          places: [{ name: 'Harrow Bay', from: [at('Harrow Bay')], type: 'bay', description: 'The harbour.' }] });
      } else if (/how ONE storyline develops/.test(sys)) {
        const heads = [...usr.matchAll(/^\[#(\d+) [^\]]*\]$/gm)].map(m => Number(m[1]));
        content = JSON.stringify({ facts: heads.map(n => ({ about: 'event', fact: `the map matters in chapter ${n}`, chapter: n })) });
      } else if (/profile of one storyline/.test(sys)) {
        const current = JSON.parse(usr.match(/CURRENT profile: (\{.*\})/)?.[1] || '{}');
        content = JSON.stringify({ type: 'Main', description: 'Mira follows her father\'s chart to the sea cave.', themes: 'Grief and trust.', conflicts: current.conflicts || 'Tomas against Mira.',
          people: ['Mira Vale', 'Nobody Here'], places: ['Gull Lighthouse'], related: ['A plot that is not there'], sources: { description: [1, 2], themes: [2] } });
      } else if (/fill in the timeline events of one chapter/.test(sys)) {
        // one reply per chapter: a time that moves on, a place from the list, a scene type to normalise
        const rows = [...usr.matchAll(/^\[(\d+)\] "([^"]*)"/gm)].map(m => ({ index: Number(m[1]), title: m[2] }));
        const date = /copper hair/.test(usr) ? 'Day one' : /her brother Tomas/.test(usr) ? 'That night' : 'Some day';
        content = JSON.stringify({ events: rows.map(r => (/NOT HERE/.test(r.title) ? { index: r.index, missing: true }
          : { index: r.index, date, location: 'The Gull Lighthouse', sceneType: 'Dialogue', description: `About ${r.title}` })) });
      } else if (/catalogue details of a novel/.test(sys)) {
        // keeps the author's genre, says "Young Adult" (normalised by the server), adds a tagline and a blurb
        const current = JSON.parse(usr.match(/CURRENT details: (\{.*\})/)?.[1] || '{}');
        content = JSON.stringify({ genre: current.genre || 'Mystery', targetAudience: 'Young Adult', tagline: 'Some maps should stay lost.',
          blurb: /Mira Vale/.test(usr) ? 'Mira Vale comes home to finish her father\'s map.' : 'A story.' });
      } else if (/note everything they reveal about ONE place/.test(sys)) {
        content = JSON.stringify({ facts: /Gull Lighthouse/.test(usr) ? [{ about: 'history', fact: 'her father kept the light', chapter: 1 }] : [] });
      } else if (/write a location profile for a novel/.test(sys)) {
        const current = JSON.parse(usr.match(/CURRENT profile: (\{.*\})/)?.[1] || '{}');
        content = JSON.stringify({ type: 'lighthouse', description: current.description || '', history: 'Her father kept the light until he vanished.', significance: '',
          aliases: ['the Gull', 'The Gull Lighthouse'], sources: { history: [1] } });
      } else if (/write a character profile for a novel/.test(sys)) {
        // echoes the current background (unchanged = not a suggestion), says
        // "unknown" for age (a blank, dropped), and names someone not in the cast
        const current = JSON.parse(usr.match(/CURRENT profile: (\{.*\})/)?.[1] || '{}');
        content = JSON.stringify({ hairColor: 'Copper', age: 'unknown', background: current.background || '', personality: 'Stubborn and curious.',
          relationships: [{ name: 'Tomas', type: 'sibling', description: 'Her older brother' }, { name: 'Nobody Here', type: 'Friend' }],
          aliases: ['Mira Vale', 'Mi'], sources: { hairColor: ['Chapter 1'], personality: [2] } });
      } else if (/breaking an animation screenplay into the SHOTS/.test(sys)) {
        content = JSON.stringify({ shots: [
          { sceneNumber: 4, title: 'Tower', visualPrompt: 'The white tower in the storm.', cameraDirection: 'wide shot', duration: 8, characters: [], location: 'Gull Lighthouse (exterior)', transition: 'fade' },
          { sceneNumber: 9, title: 'Eye', visualPrompt: 'Mira says "It\'s dark." in close-up.', cameraDirection: 'extreme close-up', duration: 7, characters: ['Mira Vale'], location: 'The Gull Lighthouse', transition: 'continue' },
        ] });
      } else if (/adapt one chapter of a novel into an animation screenplay/.test(sys)) {
        content = 'TITLE: The Keeper\n\nEXT. THE GULL LIGHTHOUSE - NIGHT\n\nSETTING: Black cliffs, a white tower, rain.\n\nMira Vale (31, copper hair, oilskin coat) climbs the steps.\n\nCUT TO:\n\nINT. THE GULL LIGHTHOUSE - NIGHT\n\nSETTING: The lamp room, brass and glass.\n\nShe lights the lamp.';
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

// PORTAL_ONLY against a HEALTHY provider (the preload answers the probe's two documents), on the real server and database:
// the independent review's findings 1, 2, 3 and 6a at the HTTP level.
async function portalOnlyEnforced(db, gateway) {
  console.log('\n== PORTAL_ONLY enforced (healthy provider), break-glass, reset-then-link, session lifetimes');
  const { default: bcrypt } = await import('bcryptjs');
  const PW = 'Correct-Horse-9!';
  const mk = async (label, { role = 'user', sub = null, verified = true } = {}) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@regress.local`;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, name, tier, role, portal_sub, email_verified) VALUES ($1, $2, $3, 'free', $4, $5, $6) RETURNING id, token_version`,
      [email, bcrypt.hashSync(PW, 4), label, role, sub, verified]);
    return { id: rows[0].id, email, version: rows[0].token_version };
  };
  const tokenFor = (u, over = {}, expiresIn = '1h') => jwt.sign({ userId: u.id, email: u.email, tokenVersion: u.version, ...over }, JWT_SECRET, { expiresIn });
  const redis = createClient({ url: `redis://${REDIS.host}:${REDIS.port}` });
  await redis.connect();
  const resetKeys = async () => { const ks = new Set(); for await (const k of redis.scanIterator({ MATCH: 'password_reset:*', COUNT: 100 })) ks.add(k); return ks; };
  const srv = await bootServer('rg_main', {
    SAI_API_BASE_URL: gateway.url, SAI_API_KEY: 'test', PORTAL_OIDC: '1', PORTAL_ISSUER: 'https://portal.test', PORTAL_CLIENT_SECRET: 'regress-client-secret',
    PORTAL_SESSION_SECRET: 'regress-session-secret-0123456789abcdef', APP_URL: 'https://stories.invalid', PORTAL_ONLY: '1',
    NODE_OPTIONS: `--import=${path.join(__dirname, 'fake-portal-fetch.mjs')}`,
  });
  try {
    const call = api(srv.base);
    let r;
    for (let i = 0; i < 40; i++) { r = await call('GET', '/api/health'); if (r.json?.services?.portalAuth?.providerHealthy) break; await new Promise(res => setTimeout(res, 250)); }
    check('the provider probe succeeds in the background; PORTAL_ONLY is enforced', r.json?.services?.portalAuth?.providerHealthy === true && r.json?.services?.portalAuth?.only === true, JSON.stringify(r.json?.services?.portalAuth));
    r = await call('GET', '/api/auth/portal/config');
    check('public config: only = true (enforced), no secret', r.json?.only === true && Object.keys(r.json).length === 3, JSON.stringify(r.json));

    const reader = await mk('reader');
    const boss = await mk('boss', { role: 'admin' });
    r = await call('POST', '/api/auth/login', null, { email: reader.email, password: PW });
    check('1a. enforced: a normal account is refused, even with the right password (403 PORTAL_ONLY)', r.status === 403 && r.json?.code === 'PORTAL_ONLY', `got ${r.status}`);
    r = await call('POST', '/api/auth/login', null, { email: boss.email, password: PW });
    check('1a. break-glass: an ADMIN signs in with the password', r.status === 200 && !!r.json?.token, `got ${r.status}`);
    r = await call('POST', '/api/auth/login', null, { email: boss.email, password: 'wrong' });
    check('1a. ...and a wrong admin password is a plain 401', r.status === 401, `got ${r.status}`);
    r = await call('POST', '/api/auth/register', null, { email: 'new@regress.local', password: PW, name: 'N' });
    check('1a. local sign-up is refused for everyone (403 PORTAL_ONLY)', r.status === 403 && r.json?.code === 'PORTAL_ONLY', `got ${r.status}`);

    // 2. forgot / reset
    const linked = await mk('linked', { sub: 'u_regresslinked0001' });
    const loose = await mk('loose', { verified: false });
    let before = await resetKeys();
    r = await call('POST', '/api/auth/forgot-password', null, { email: linked.email });
    let after = await resetKeys();
    check('2. forgot-password for a SAI Cloud-linked account: the generic 200, and NO reset token is made', r.status === 200 && /If an account exists/.test(r.json?.message || '') && after.size === before.size, `got ${r.status}`);
    before = after;
    r = await call('POST', '/api/auth/forgot-password', null, { email: loose.email });
    after = await resetKeys();
    check('2. forgot-password for an UNLINKED account still works (a reset token is made)', r.status === 200 && after.size === before.size + 1, `got ${r.status}, keys ${before.size}->${after.size}`);
    await redis.set('password_reset:regress-linked', linked.id, { EX: 600 });
    r = await call('POST', '/api/auth/reset-password', null, { token: 'regress-linked', newPassword: 'Str0ng-Pass-Phrase!9' });
    check('2. reset-password for a linked account is refused while enforced (403 PORTAL_ONLY)', r.status === 403 && r.json?.code === 'PORTAL_ONLY', `got ${r.status}`);
    const oldJwt = tokenFor(loose);
    await redis.set('password_reset:regress-loose', loose.id, { EX: 600 });
    r = await call('POST', '/api/auth/reset-password', null, { token: 'regress-loose', newPassword: 'Str0ng-Pass-Phrase!9' });
    const lrow = (await db.query('SELECT email_verified, email_verification_token, token_version FROM users WHERE id = $1', [loose.id])).rows[0];
    check('2. reset-password for an unlinked, UNVERIFIED account works and marks the email verified', r.status === 200 && lrow.email_verified === true && lrow.email_verification_token === null, `got ${r.status} ${JSON.stringify(lrow)}`);
    check('2. ...and bumps token_version, so the old JWT dies', lrow.token_version === loose.version + 1 && (await call('GET', '/api/auth/me', oldJwt)).status === 401);
    r = await call('POST', '/api/auth/login', null, { email: loose.email, password: 'Str0ng-Pass-Phrase!9' });
    check('2. ...and under enforced PORTAL_ONLY that non-admin still cannot use the new password to sign in (SAI Cloud is the door)', r.status === 403);

    // 6a. change-password
    const lifetime = (tok) => { const d = jwt.decode(tok); return d.exp - d.iat; };
    const portalUser = await mk('portaluser', { sub: 'u_regressportal0002' });
    r = await call('POST', '/api/auth/change-password', tokenFor(portalUser, { via: 'portal' }, '1h'), { currentPassword: PW, newPassword: 'Str0ng-Pass-Phrase!9' });
    const t1 = r.json?.token;
    check('6a. a portal session of 1 h gets a replacement token of <= 1 h, not 7 days', r.status === 200 && lifetime(t1) <= 3600 && lifetime(t1) > 3000 && jwt.decode(t1).via === 'portal', `got ${r.status} ${t1 && lifetime(t1)}`);
    const portalUser2 = await mk('portaluser2', { sub: 'u_regressportal0003' });
    r = await call('POST', '/api/auth/change-password', tokenFor(portalUser2, {}, '7d'), { currentPassword: PW, newPassword: 'Str0ng-Pass-Phrase!9' });
    check('6a. a linked user holding a 7-day password token is capped at 24 h', r.status === 200 && lifetime(r.json?.token) <= 86400, `got ${r.status} ${r.json?.token && lifetime(r.json.token)}`);
    const plain = await mk('plainpw');
    r = await call('POST', '/api/auth/change-password', tokenFor(plain, {}, '1h'), { currentPassword: PW, newPassword: 'Str0ng-Pass-Phrase!9' });
    check('6a. an unlinked password user keeps the 7 days they always had', r.status === 200 && lifetime(r.json?.token) === 7 * 24 * 3600, `got ${r.status}`);
    r = await call('GET', '/api/auth/me', t1);
    check('6a. the replacement token works (it carries the bumped token_version)', r.status === 200, `got ${r.status}`);

    // the hidden administrator sign-in page, on the real server (index.js wiring, Redis-backed budget, real bcrypt, real JWT).
    // Each check uses its own client address (X-Forwarded-For: <client>, <proxy>; two trusted hops) so this section does not
    // spend the per-IP budgets the checks around it measure.
    {
      const boss2 = await mk('boss2', { role: 'admin' });
      const boss3 = await mk('boss3', { role: 'admin' });
      const reader2 = await mk('reader2');
      let cn = 0;
      const marked = (body, { ip = `203.0.${cn++ % 250}.5`, headers = {}, raw } = {}) => fetch(srv.base + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Stories-Entry': 'admin-local-login', Origin: srv.base, 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': `${ip}, 10.9.9.9`, ...headers },
        body: raw !== undefined ? raw : JSON.stringify(body),
      });
      const page = await fetch(srv.base + '/admin/local-login');
      const html = await page.text();
      check('admin page: served with no-store, noindex, no-referrer, frame-ancestors none; email + password form; administrators only',
        page.status === 200 && /no-store/.test(page.headers.get('cache-control') || '') && /noindex/.test(page.headers.get('x-robots-tag') || '')
        && page.headers.get('referrer-policy') === 'no-referrer' && /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') || '')
        && /type="password"/.test(html) && /administrators only/i.test(html), `got ${page.status}`);
      const scr = await fetch(srv.base + '/admin/local-login.js');
      check('admin page: its script is served the same way', scr.status === 200 && /javascript/.test(scr.headers.get('content-type') || '') && /no-store/.test(scr.headers.get('cache-control') || ''), `got ${scr.status}`);
      let m = await marked({ email: boss2.email, password: PW });
      const mj = await m.json();
      check('admin page: an ADMIN signs in through the marked login; the token works and the HttpOnly cookie is set',
        m.status === 200 && !!mj.token && mj.user?.role === 'admin' && /^token=.*HttpOnly/i.test(m.headers.get('set-cookie') || '') && (await call('GET', '/api/auth/me', mj.token)).status === 200, `got ${m.status}`);
      const answers = [];
      for (const body of [{ email: boss2.email, password: 'wrong-pw' }, { email: reader2.email, password: PW }, { email: reader2.email, password: 'wrong-pw' }, { email: `ghost-${Date.now()}@regress.local`, password: PW }]) {
        const x = await marked(body);
        answers.push(`${x.status} ${JSON.stringify(await x.json())}`);
      }
      check('admin page: wrong password, a non-admin with the RIGHT password, and an unknown address all get the SAME 401 and text', new Set(answers).size === 1 && answers[0].startsWith('401 '), answers.join(' | '));
      m = await marked({ email: boss2.email, password: PW }, { headers: { Origin: 'https://evil.example' } });
      check('admin page: a foreign Origin is refused (403) before anything is checked', m.status === 403, `got ${m.status}`);
      m = await marked({ email: boss2.email, password: PW }, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
      check('admin page: Sec-Fetch-Site cross-site is refused (403)', m.status === 403, `got ${m.status}`);
      m = await marked(null, { raw: 'email=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      check('admin page: a form post is refused (415)', m.status === 415, `got ${m.status}`);
      m = await marked({ email: boss2.email, password: 'x'.repeat(5000) });
      check('admin page: a body over 2 KB is refused (413)', m.status === 413, `got ${m.status}`);
      const lockStatuses = [];
      for (let i = 0; i < 7; i++) lockStatuses.push((await marked({ email: boss3.email, password: `wrong-${i}` })).status);
      check('admin page: five failures per account lock it (401 x5, then 429), from five different addresses', lockStatuses.join(',') === '401,401,401,401,401,429,429', lockStatuses.join(','));
      check('...even for the right password, while another admin is unaffected', (await marked({ email: boss3.email, password: PW })).status === 429 && (await marked({ email: boss2.email, password: PW })).status === 200);
      const ipStatuses = [];
      for (let i = 0; i < 6; i++) ipStatuses.push((await marked({ email: `spray${i}-${Date.now()}@regress.local`, password: 'x' }, { ip: `198.51.100.${10 + i}` })).status);
      check('admin page: five failures from one /24 lock the whole class (a sixth, different address and host, is 429)', ipStatuses.join(',') === '401,401,401,401,401,429', ipStatuses.join(','));
      check('admin page: the budget lives in Redis (shared across replicas)', (await redis.keys('stories:admin-login:*')).length >= 2);
      const slog = srv.log();
      const auditLines = slog.split('\n').filter((l) => l.startsWith('[admin-local-login]'));
      check('admin page: audit lines exist for success, failure, refused and locked',
        ['success', 'failure', 'refused', 'locked'].every((o) => auditLines.some((l) => l.includes(`outcome=${o}`))), auditLines.slice(0, 3).join(' | '));
      check('admin page: no audit or log line carries the addresses typed here, the password, or the client address',
        ![boss2.email, boss3.email, reader2.email, PW, 'wrong-pw', '198.51.100.10', 'wrong-0'].some((x) => slog.includes(x)));
      r = await call('POST', '/api/auth/login', null, { email: reader2.email, password: PW });
      check('admin page: the marker grants nothing; the normal endpoint still refuses a non-admin under PORTAL_ONLY (403)', r.status === 403 && r.json?.code === 'PORTAL_ONLY', `got ${r.status}`);
    }

    // second review, finding 3: the PORTAL_ONLY refusal runs AFTER the limiters, so a flood of blocked logins is throttled
    // before each one costs a database query. (Last in this section: it spends this client's whole per-IP budget.)
    const same = [];
    for (let i = 0; i < 8; i++) same.push((await call('POST', '/api/auth/login', null, { email: reader.email, password: 'x' })).status);
    const s429 = same.indexOf(429);   // this address was already refused once above, so the 5th refusal in all is the last 403
    check('3. the same blocked address is rate limited after 5 refusals (403 ..., then 429 and stays 429)', s429 === 4 && same.slice(0, s429).every(c => c === 403) && same.slice(s429).every(c => c === 429), same.join(','));
    const varied = [];
    for (let i = 0; i < 45; i++) varied.push((await call('POST', '/api/auth/login', null, { email: `flood${i}-${Date.now()}@regress.local`, password: 'x' })).status);
    const first429 = varied.indexOf(429);
    check('3. a flood that changes the address every time is rate limited too (per-IP budget), and stays limited', first429 > 0 && first429 <= 31 && varied.slice(first429).every(c => c === 429) && varied.slice(0, first429).every(c => c === 403), varied.join(','));
  } finally {
    await srv.stop();
    await redis.quit();
  }
}

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

    // delete a chapter and renumber the rest IN ONE SAVE: the sync used to
    // update 4 -> 3 before deleting the old 3 and hit UNIQUE(book_id, chapter_number)
    // (reuses book2: a new book would push the owner over the book quota later checks need)
    const book3 = { id: book2.id, version: await dbVersion(db, book2.id) };
    r = await call('PUT', `/api/books/${book3.id}`, owner.token, {
      version: book3.version,
      chapters: ['1', '2', '3', '4', '5'].map(n => ({ id: Number(n), number: n, title: `T${n}`, content: `text ${n}` })),
    });
    const saved = (await call('GET', `/api/books/${book3.id}`, owner.token)).json;
    const { deleteChapter: dropChapter } = await import('../../src/utils/chapters.js');
    const t3 = saved?.chapters?.find(c => c.title === 'T3');
    r = await call('PUT', `/api/books/${book3.id}`, owner.token, { version: saved?.version, chapters: dropChapter(saved?.chapters || [], t3?.id) });
    const order3 = async () => (await db.query('SELECT chapter_number, title FROM chapters WHERE book_id = $1 ORDER BY chapter_number', [book3.id])).rows.map(x => `${x.chapter_number}:${x.title}`).join(' ');
    let got3 = await order3();
    check('delete chapter 3 and renumber in one save = 200: 1:T1 2:T2 3:T4 4:T5', r.status === 200 && got3 === '1:T1 2:T2 3:T4 4:T5', `status ${r.status} ${JSON.stringify(r.json?.error || '')} | ${got3}`);
    const again = (await call('GET', `/api/books/${book3.id}`, owner.token)).json;
    r = await call('PUT', `/api/books/${book3.id}`, owner.token, {
      version: again?.version,
      chapters: (again?.chapters || []).map(c => (c.title === 'T1' ? { ...c, number: '2' } : c.title === 'T2' ? { ...c, number: '1' } : c)),
    });
    got3 = await order3();
    check('swapping two chapter numbers saves (no collision mid-save)', r.status === 200 && got3 === '1:T2 2:T1 3:T4 4:T5', `status ${r.status} | ${got3}`);

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

    await mediaChecks({ call, db, gateway, owner, editor, stranger, book });

    console.log('\n== chapter numbers and headings');
    const ui = await import('../../src/utils/chapters.js');
    const srvCh = await import('../utils/chapters.js');
    const headingCases = [[{ number: '2', title: 'Chapter One' }, 'Chapter One'], [{ number: '1', title: 'Prologue' }, 'Prologue'],
      [{ number: '3', title: 'The Storm' }, 'Chapter 3: The Storm'], [{ number: '4', title: '' }, 'Chapter 4'], [{ number: '9', title: 'Part Two: The Sea' }, 'Part Two: The Sea'],
      [{ number: '5', title: 'Epilogue' }, 'Epilogue'], [{ number: '6', title: 'Chapterhouse' }, 'Chapter 6: Chapterhouse']];
    const badHeadings = headingCases.filter(([c, want]) => ui.chapterHeading(c) !== want || srvCh.chapterHeading(c) !== want).map(([c, want]) => `${JSON.stringify(c)} -> ${ui.chapterHeading(c)} / ${srvCh.chapterHeading(c)} (want ${want})`);
    check('a chapter whose title names it reads as its title ("Chapter One", not "Chapter 2: Chapter One"), app and narration alike', badHeadings.length === 0, badHeadings.join('; '));
    check('no "Chapter N" label above a title that already says it', ui.chapterLabel({ number: '2', title: 'Chapter One' }) === null && ui.chapterLabel({ number: '3', title: 'The Storm' }) === 'Chapter 3'
      && ui.chapterBadge({ number: '1', title: 'Prologue' }) === null && ui.chapterBadge({ number: '3', title: 'The Storm' }) === 'Ch. 3');
    const five = ['1', '2', '3', '4', '5'].map(n => ({ id: `c${n}`, number: n, title: `T${n}` }));
    const chNums = (list) => ui.sortChapters(list).map(c => `${c.id}=${c.number}`).join(' ');
    check('deleting chapter 3 with renumber: 4 -> 3, 5 -> 4, 1-2 untouched', chNums(ui.deleteChapter(five, 'c3')) === 'c1=1 c2=2 c4=3 c5=4', chNums(ui.deleteChapter(five, 'c3')));
    check('deleting without renumber leaves the gap', chNums(ui.deleteChapter(five, 'c3', { renumber: false })) === 'c1=1 c2=2 c4=4 c5=5');
    const messy = [{ id: 'a', number: '1' }, { id: 'b', number: '4' }, { id: 'c', number: '4' }, { id: 'd', number: '' }, { id: 'e', number: '7' }];
    check('renumber: gaps, repeats and blanks become 1..N in reading order (blank last)',
      ui.needsRenumber(messy) && chNums(ui.renumberChapters(messy)) === 'a=1 b=2 c=3 e=4 d=5' && !ui.needsRenumber(ui.renumberChapters(messy)) && !ui.needsRenumber(five),
      chNums(ui.renumberChapters(messy)));

    console.log('\n== profile preferences');
    const voicePref = { engine: 'qwen', voice: 'Serena' };
    r = await call('PUT', '/api/users/settings', owner.token, { preferences: { defaultVoice: voicePref, autoSave: true, enableNotifications: true, theme: 'light' } });
    const prefs = (await call('GET', '/api/users/settings', owner.token)).json?.preferences;
    check('profile preferences come back after saving (they never did); the voice is a spec; no per-user model setting',
      r.status === 200 && prefs?.defaultVoice?.engine === 'qwen' && prefs?.defaultVoice?.voice === 'Serena' && !('defaultModel' in (prefs || {})), JSON.stringify(prefs));

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

    console.log('\n== imported chapter titles');
    // imported here, after the env above: the module opens a db pool
    const { stripChapterNumber } = await import('../import/imports.js');
    const titleCases = [['2. The Map', 'The Map'], ['Chapter 3: The Storm', 'The Storm'], ['One: The Storm', 'The Storm'], ['IV - The Bell', 'The Bell'],
      ['12 — Night', 'Night'], ['Chapter Twenty-One', 'Chapter Twenty-One'], ['Chapter Twenty-One: Home', 'Home'], ['Twenty-Two', 'Twenty-Two'],
      ['Chapter 3', 'Chapter 3'], ['Part One: The Sea', 'Part One: The Sea'], ['1984', '1984'], ['One Day in June', 'One Day in June']];
    const wrongTitles = titleCases.filter(([t, want]) => stripChapterNumber(t) !== want).map(([t, want]) => `${t} -> ${stripChapterNumber(t)} (want ${want})`);
    check('a title loses only its own number prefix ("Chapter Twenty-One" stays whole)', wrongTitles.length === 0, wrongTitles.join('; '));

    console.log('\n== sign in with SAI Cloud (real server, real Postgres)');
    const ucols = (await db.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('portal_sub','portal_linked_at')`)).rows;
    check('users has portal_sub + portal_linked_at, both nullable, unique index on portal_sub',
      ucols.length === 2 && ucols.every(c => c.is_nullable === 'YES')
      && (await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_portal_sub_key' AND indexdef LIKE '%UNIQUE%'`)).rowCount === 1);
    r = await call('GET', '/api/auth/portal/config');
    check('feature OFF by default: /api/auth/portal/config says so', r.status === 200 && r.json?.enabled === false && r.json?.only === false, JSON.stringify(r.json));
    r = await fetch(srv.base + '/auth/portal/login', { redirect: 'manual' });
    check('feature OFF: /auth/portal/login is a 404, not the SPA', r.status === 404, `got ${r.status}`);
    r = await call('GET', '/api/health');
    check('/api/health reports portalAuth as off', r.json?.services?.portalAuth?.enabled === false && r.json?.services?.portalAuth?.requested === false, JSON.stringify(r.json?.services?.portalAuth));
    const linkU = await makeUser(db, 'linkable');
    await db.query(`UPDATE users SET portal_sub = 'u_regress0000000001' WHERE id = $1`, [linkU.id]);
    r = await call('GET', '/api/auth/me', linkU.token);
    check('/api/auth/me reports portalLinked for a linked user', r.status === 200 && r.json?.user?.portalLinked === true, JSON.stringify(r.json?.user));
    r = await call('GET', '/api/auth/me', owner.token);
    check('/api/auth/me: not portal-linked for everyone else', r.json?.user?.portalLinked === false);

    // Settings: name, plans, sign out other devices, connect (off), the page's pure helpers
    {
      const su = await makeUser(db, 'settings');
      r = await call('PUT', '/api/users/profile', su.token, { name: '  Ada \u0007  Quill  ' });
      check('settings: PUT /api/users/profile saves a cleaned name', r.status === 200 && r.json?.user?.name === 'Ada Quill', JSON.stringify(r.json));
      r = await call('GET', '/api/auth/me', su.token);
      check('settings: /api/auth/me shows the new name and a member-since date', r.json?.user?.name === 'Ada Quill' && !Number.isNaN(Date.parse(r.json?.user?.createdAt)), JSON.stringify(r.json?.user));
      check('settings: an empty or 101-character name is refused', (await call('PUT', '/api/users/profile', su.token, { name: '   ' })).status === 400
        && (await call('PUT', '/api/users/profile', su.token, { name: 'x'.repeat(101) })).status === 400);
      r = await call('GET', '/api/plans', su.token);
      const byTier = Object.fromEntries((r.json?.plans || []).map((p) => [p.tier, p]));
      check('settings: /api/plans lists the three tiers from the enforced table (free 3 books, premium unlimited) and no checkout without Stripe',
        r.status === 200 && byTier.free?.limits?.books === 3 && byTier.premium?.limits?.books === 'Unlimited' && byTier.basic?.features?.media_generation === true && r.json?.checkout === false, JSON.stringify(r.json));
      r = await call('POST', '/api/auth/sign-out-others', su.token);
      const fresh = r.json?.token;
      check('settings: sign out other devices ends the old token and hands this one a fresh one',
        r.status === 200 && !!fresh && (await call('GET', '/api/auth/me', su.token)).status === 401 && (await call('GET', '/api/auth/me', fresh)).status === 200);
      r = await call('POST', '/api/auth/portal/attach', fresh, { password: 'x' });
      check('settings: Connect SAI Cloud is a 404 while the feature is off', r.status === 404, `got ${r.status}`);
      for (const pth of ['/admin/local-login', '/admin/local-login.js']) {
        const off = await fetch(call.base + pth);
        check(`admin sign-in page ${pth} is a JSON 404 while SAI Cloud sign-in is off (the normal form is the way in)`, off.status === 404 && /json/.test(off.headers.get('content-type') || ''), `got ${off.status}`);
      }
      r = await fetch(call.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stories-Entry': 'admin-local-login', Origin: call.base }, body: JSON.stringify({ email: 'nobody@regress.local', password: 'x' }) });
      check('...and a marked login is a 404 too, while an unmarked one still answers 401', r.status === 404 && (await call('POST', '/api/auth/login', null, { email: 'nobody@regress.local', password: 'x' })).status === 401, `got ${r.status}`);
      const h = await import('../../src/utils/settings.js');
      const aid = 'a'.repeat(32);
      check('settings helpers: meters, arrival from the URL, initials',
        h.meterOf(5, 10).pct === 50 && h.meterOf(30, 10).pct === 100 && h.meterOf(1, 999999).unlimited && h.meterOf(1, 0).unlimited
        && h.settingsArrival(`?settings=security&connect=${aid}`).connected === true && h.settingsArrival('?settings=security&connect=x').connected === false
        && h.settingsArrival('?settings=nope').section === 'account' && h.settingsArrival('?settings=plan&checkout=success').checkout === 'success'
        && h.settingsArrival('?book=1') === null && h.initialsOf('Ada Byron Lovelace') === 'AL' && h.initialsOf('', 'zed@x.y') === 'Z');
    }

    // second server on the same database, feature ON with an unreachable issuer + PORTAL_ONLY + SIGNUPS_CLOSED
    const on = await bootServer('rg_main', {
      SAI_API_BASE_URL: gateway.url, SAI_API_KEY: 'test', PORTAL_OIDC: '1', PORTAL_ISSUER: 'https://portal.invalid', PORTAL_CLIENT_SECRET: 'regress-client-secret',
      PORTAL_SESSION_SECRET: 'regress-session-secret-0123456789abcdef', APP_URL: 'https://stories.invalid', PORTAL_ONLY: '1', SIGNUPS_CLOSED: '1',
    });
    try {
      const onCall = api(on.base);
      r = await onCall('GET', '/api/auth/portal/config');
      check('feature ON, PORTAL_ONLY requested but the portal is UNREACHABLE: config says enabled, only=false (not enforced), signupsClosed (and no secret)', r.json?.enabled === true && r.json?.only === false && r.json?.signupsClosed === true && Object.keys(r.json).length === 3, JSON.stringify(r.json));
      r = await fetch(on.base + '/auth/portal/login', { redirect: 'manual' });
      check('feature ON, portal unreachable: login fails SOFT to the error page (no crash, no hang)', r.status === 302 && /\/auth\/portal\/error\?code=unavailable$/.test(r.headers.get('location') || ''), `${r.status} ${r.headers.get('location')}`);
      r = await onCall('POST', '/api/auth/login', null, { email: 'a@b.co', password: 'x' });
      check('...so password login still runs (401 bad credentials, not 403): an outage cannot lock everyone out', r.status === 401, `got ${r.status} ${JSON.stringify(r.json)}`);
      r = await onCall('POST', '/api/auth/register', null, { email: 'a@b.co', password: 'Passw0rd!x', name: 'A' });
      check('SIGNUPS_CLOSED: local sign-up answers 403', r.status === 403 && r.json?.code === 'SIGNUPS_CLOSED', `got ${r.status}`);
      r = await onCall('GET', '/api/auth/me', linkU.token);
      check('an existing session keeps working', r.status === 200, `got ${r.status}`);
      r = await onCall('GET', '/api/health');
      const pa = r.json?.services?.portalAuth;
      check('/api/health reports portalAuth on, provider NOT healthy, PORTAL_ONLY not enforced, without secrets',
        pa?.enabled === true && pa?.onlyRequested === true && pa?.only === false && pa?.providerHealthy === false && /NOT enforced/.test(pa?.note || '') && !JSON.stringify(r.json).includes('regress-client-secret'), JSON.stringify(pa));
    } finally {
      await on.stop();
    }
    await portalOnlyEnforced(db, gateway);

    // a misconfigured ON (no secrets) must leave the pod UP and the password login working
    const bad = await bootServer('rg_main', { SAI_API_BASE_URL: gateway.url, SAI_API_KEY: 'test', PORTAL_OIDC: '1', PORTAL_ONLY: '1', APP_URL: 'https://stories.invalid' });
    try {
      const badCall = api(bad.base);
      r = await badCall('GET', '/api/health');
      check('PORTAL_OIDC=1 without secrets: pod healthy, feature off with a reason', r.status === 200 && r.json?.services?.portalAuth?.enabled === false && /PORTAL_CLIENT_SECRET/.test(r.json?.services?.portalAuth?.reason || ''), JSON.stringify(r.json?.services?.portalAuth));
      r = await badCall('POST', '/api/auth/login', null, { email: 'nobody@regress.local', password: 'x' });
      check('...and PORTAL_ONLY is ignored then: password login still runs (401, not 403)', r.status === 401, `got ${r.status}`);
    } finally {
      await bad.stop();
    }
  } finally {
    await srv.stop();
    await db.end();
  }
}

// ─── media wiring: images, character references, speech ─────────────────
async function mediaChecks({ call, db, gateway, owner, editor, stranger, book }) {
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

  // ── the book's art style: every image of the book in one look ──
  // as the book's editor: the owner's 50-per-15-minutes AI limit is spent by now
  {
    const setStyle = (st) => db.query(`UPDATE books SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{artStyle}', $2::jsonb) WHERE id = $1`, [book.id, JSON.stringify(st)]);
    const imagesFrom = (from) => gateway.requests.slice(from).filter(q => q.path.endsWith('/images/generations'));
    await setStyle({ id: 'live-action' });
    let from = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'image', target: { type: 'location', id: 'loc1' }, params: { prompt: 'a misty harbour', context: { bookTitle: 'The Keeper' } } });
    done = await waitJob(editor.token, r.json?.job?.jobId);
    let img = imagesFrom(from).at(-1);
    const writer = gateway.requests.slice(from).find(q => /enhance image generation prompts/.test(q.body?.messages?.[0]?.content || ''));
    check('art style: a book image leads with the style, the other looks in the negative, the prompt writer told it is fixed',
      done?.status === 'done' && /^photorealistic/.test(img?.body?.prompt || '') && /cartoon/.test(img?.body?.negative || '') && /FIXED: photorealistic/.test(writer?.body?.messages?.[0]?.content || ''),
      `${done?.status} ${(img?.body?.prompt || '').slice(0, 60)} | ${img?.body?.negative}`);
    await call('POST', `${jobsUrl}/${done?.jobId}/ack`, editor.token);

    from = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'reference', target: { type: 'character', id: 'c1' }, params: { kind: 'portrait', character: { ...character, imageUrl: undefined } } });
    done = await waitJob(editor.token, r.json?.job?.jobId);
    img = imagesFrom(from).at(-1);
    check('art style: a portrait is drawn in it, its own negative kept and the style\'s added',
      done?.status === 'done' && /^photorealistic/.test(img?.body?.prompt || '') && /deformed hands/.test(img?.body?.negative || '') && /cartoon/.test(img?.body?.negative || ''),
      `${(img?.body?.prompt || '').slice(0, 60)} | ${img?.body?.negative}`);
    await call('POST', `${jobsUrl}/${done?.jobId}/ack`, editor.token);

    from = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'reference', target: { type: 'character', id: 'c1' }, params: { kind: 'portrait', character: { ...character, imageUrl: undefined }, style: 'oil painting' } });
    done = await waitJob(editor.token, r.json?.job?.jobId);
    img = imagesFrom(from).at(-1);
    check('art style: a style typed for one image wins, without the book style\'s negative',
      /^oil painting/.test(img?.body?.prompt || '') && !/cartoon/.test(img?.body?.negative || ''), `${(img?.body?.prompt || '').slice(0, 40)} | ${img?.body?.negative}`);
    await call('POST', `${jobsUrl}/${done?.jobId}/ack`, editor.token);

    from = gateway.requests.length;
    r = await call('POST', '/api/generate-comic-panel', editor.token, { bookId: book.id, sceneDescription: 'she opens the door', characters: [] });
    img = imagesFrom(from).at(-1);
    check('art style: a comic panel is the book\'s style as a panel', r.status === 200 && /^photorealistic.*comic panel composition/.test(img?.body?.prompt || '') && /cartoon/.test(img?.body?.negative || ''),
      `${r.status} ${(img?.body?.prompt || '').slice(0, 120)}`);
    from = gateway.requests.length;
    r = await call('POST', '/api/generate-comic-panel', stranger.token, { bookId: book.id, sceneDescription: 'x', characters: [] });
    img = imagesFrom(from).at(-1);
    check('art style: someone else\'s book lends no style', !/photorealistic/.test(img?.body?.prompt || ''), (img?.body?.prompt || '').slice(0, 80));

    await setStyle({ id: 'custom', custom: '1920s pulp magazine illustration' });
    from = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'image', target: { type: 'cover', id: null }, params: { prompt: 'a lighthouse' } });
    done = await waitJob(editor.token, r.json?.job?.jobId);
    img = imagesFrom(from).at(-1);
    check('art style: the author\'s own words work too', /^1920s pulp magazine illustration\. a lighthouse/.test(img?.body?.prompt || '') && !img?.body?.negative, (img?.body?.prompt || '').slice(0, 80));
    await call('POST', `${jobsUrl}/${done?.jobId}/ack`, editor.token);
    await db.query(`UPDATE books SET metadata = metadata - 'artStyle' WHERE id = $1`, [book.id]);
  }

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
  await db.query('UPDATE books SET characters = $2, locations = $3 WHERE id = $1', [book.id, JSON.stringify([{ id: 'c1', name: 'Mira Vale', imageUrl: portraitForFilm }]),
    JSON.stringify([{ id: 'l1', name: 'Gull Lighthouse', description: 'A white tower on black cliffs.', imageUrl: portraitForFilm }])]);
  const versionBefore = (await db.query('SELECT version FROM books WHERE id = $1', [book.id])).rows[0].version;
  const filmStart = gateway.requests.length;
  r = await call('POST', jobsUrl, owner.token, { type: 'animation', target: { type: 'animation', id: 't1' }, params: {
    options: { style: 'animated' },
    scenes: [{ sceneNumber: 1, title: 'A', visualPrompt: 'Mira climbs the lighthouse stairs', characters: ['Mira'], duration: 1 },
      { sceneNumber: 2, title: 'B', visualPrompt: 'Mira looks out at the waves FAIL_ONCE', characters: ['mira vale'], duration: 1, location: 'Gull Lighthouse (gallery)' },
      { sceneNumber: 3, title: 'C', visualPrompt: 'Mira keeps watching the waves', characters: ['Mira'], duration: 1, transition: 'continue' }] } });
  const animId = r.json?.job?.jobId;
  let sawProgress = false;
  for (let i = 0; i < 300; i++) {
    const j = (await call('GET', jobsUrl, owner.token)).json?.jobs?.find(x => x.jobId === animId);
    if (j?.progress?.scenes?.some(sc => sc.status === 'completed' || sc.status === 'rendering')) sawProgress = true;
    if (j && j.status !== 'running') { done = j; break; }
    await new Promise(res => setTimeout(res, 500));
  }
  check('media job: animation reports per-scene progress', sawProgress);
  const film = done?.result?.project?.finalVideo || {};
  check('media job: animation done with a project and a playable film', done?.status === 'done' && /^\/api\/media\/videos\//.test(film.videoUrl || '') &&
    film.duration > 1.5 && film.duration < 3, JSON.stringify(done).slice(0, 240));
  // 2.23.55: the joins are real transitions, not a plain concat
  check('film: joined with transitions (scene 2 dissolves in, scene 3 continues the shot)', film.joinVersion === 2
    && film.transitions?.map(t => t.transition).join() === 'dissolve,continue' && film.transitions.every(t => t.seconds > 0), JSON.stringify(film.transitions));
  check('media job: the server did not write the book (no 409 for the user)', (await db.query('SELECT version FROM books WHERE id = $1', [book.id])).rows[0].version === versionBefore);
  const filmCalls = gateway.requests.slice(filmStart);
  const keyframes = filmCalls.filter(q => q.path.endsWith('/images/generations') && q.body?.model === 'qwen-image-2.1');
  const starts = filmCalls.filter(q => q.path.endsWith('/video/generations'));
  check('film: a 16:9 keyframe per drawn scene (qwen-image-2.1, 1280x720, canvas:size); none for a continued shot',
    keyframes.length === 2 && keyframes.every(k => k.body.size === '1280x720' && k.body.canvas === 'size'), `${keyframes.length} keyframes`);
  check('film: scene 1 keyframe references the character\'s portrait', /^data:image\//.test(keyframes[0]?.body?.image || '') && /image 1 is Mira Vale/.test(keyframes[0]?.body?.prompt || ''),
    (keyframes[0]?.body?.prompt || '').slice(0, 200));
  check('film: scene 2 keyframe references the portrait, the PLACE\'s picture and the previous clip\'s last frame', keyframes[1]?.body?.images?.length === 3
    && /Image 2 shows Gull Lighthouse/.test(keyframes[1]?.body?.prompt || '') && /Setting \(the wider place\): Gull Lighthouse: A white tower/.test(keyframes[1]?.body?.prompt || '')
    && /Image 3 is the previous shot/.test(keyframes[1]?.body?.prompt || ''), (keyframes[1]?.body?.prompt || '').slice(0, 300));
  check('film: every clip starts from its keyframe, in the locked style, never "realistic"',
    starts.length === 4 && starts.every(v => /^data:image\//.test(v.body?.image || '') && /stylised 3D animated/.test(v.body?.prompt || '') && !/realistic/i.test(v.body?.prompt || '')),
    (starts[0]?.body?.prompt || '').slice(0, 160));
  check('film: a clip that fails once is retried and the scene still renders',
    done?.result?.project?.scenes?.[1]?.status === 'completed' && starts.length === 4,
    `scene2 ${done?.result?.project?.scenes?.[1]?.status}`);
  check('film: the project records the style, keyframes and cast',
    done?.result?.project?.style === 'animated' && done.result.project.scenes.every(sc => /^\/api\/media\/images\/keyframe-/.test(sc.keyframeUrl || '') && sc.cast?.[0] === 'Mira Vale'));
  check('film: a continued shot starts from the previous clip\'s last frame (not a new keyframe)',
    done?.result?.project?.scenes?.[2]?.transition === 'continue' && /^data:image\/png/.test(starts[3]?.body?.image || '')
    && !keyframes.some(k => /keeps watching/.test(k.body?.prompt || '')));
  await call('POST', `${jobsUrl}/${animId}/ack`, owner.token);

  // rejoin a saved film: free, a new project, the asked-for transitions.
  // As the editor: the owner is near the 50-per-15-min AI limit by now.
  if (done?.result?.project) {
    await db.query('UPDATE books SET animation_projects = $2 WHERE id = $1', [book.id, JSON.stringify([done.result.project])]);
    const editorQuota = async () => (await db.query('SELECT ai_requests_today FROM quotas WHERE user_id = $1', [editor.id])).rows[0]?.ai_requests_today;
    const e0 = await editorQuota();
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't1' }, params: { projectId: 'anim-nope' } });
    check('film rejoin: an unknown film = 404', r.status === 404, `status ${r.status}`);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't1' }, params: { projectId: done.result.project.id, transitions: { 2: 'wipe' } } });
    check('film rejoin: an unknown transition = 400', r.status === 400, `status ${r.status}`);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't1' }, params: { projectId: done.result.project.id, transitions: { 2: 'fade', 3: 'cut' } } });
    const joined = await waitJob(editor.token, r.json?.job?.jobId);
    const p2 = joined?.result?.project;
    check('film rejoin: a new project with the new transitions, the old film kept',
      joined?.status === 'done' && p2?.rejoinedFrom === done.result.project.id && p2.id !== done.result.project.id
      && p2.finalVideo?.filename !== film.filename && p2.finalVideo?.transitions?.map(t => t.transition).join() === 'fade,cut',
      `${joined?.status} ${joined?.error || ''} ${JSON.stringify(p2?.finalVideo?.transitions)}`);
    check('film rejoin: costs no AI quota', (await editorQuota()) === e0, `${e0} -> ${await editorQuota()}`);

    // one person drawn twice: two entries for one person (one portrait), a
    // sheet as the main picture (the portrait is used), clothes from the
    // scene, and a keyframe that shows her twice is checked and redrawn once
    const sheetUrl = done.result.project.scenes[0].keyframeUrl;
    await db.query('UPDATE books SET characters = $2 WHERE id = $1', [book.id, JSON.stringify([
      { id: 'o1', name: 'Olive' },
      { id: 'o2', name: 'Olive Smith', imageUrl: sheetUrl, referenceImages: [{ kind: 'turnaround', imageUrl: sheetUrl }, { kind: 'portrait', imageUrl: portraitForFilm }] },
      { id: 'o3', name: 'Anh Pham', aliases: ['Anh'] }])]);
    const twinStart = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'animation', target: { type: 'animation', id: 't2' }, params: {
      options: { style: 'animated' },
      scenes: [{ sceneNumber: 1, title: 'Bathroom', visualPrompt: 'The door bursts open and Olive stumbles in wearing a wrap dress TWIN_ONCE', characters: ['Olive Smith', 'Olive', 'Anh'], duration: 1 }] } });
    const twin = await waitJob(editor.token, r.json?.job?.jobId);
    const twinCalls = gateway.requests.slice(twinStart);
    const twinKeys = twinCalls.filter(q => q.path.endsWith('/images/generations') && q.body?.model === 'qwen-image-2.1');
    const frameChecks = twinCalls.filter(q => /check the opening frame of a film scene/.test(q.body?.messages?.[0]?.content || ''));
    const k0 = twinKeys[0]?.body || {};
    check('film: one person in two book entries is ONE portrait, and the portrait (not the sheet that is her main picture)',
      twin?.result?.project?.scenes?.[0]?.cast?.join() === 'Olive Smith,Anh Pham' && /^data:image\//.test(k0.image || '') && !k0.images &&
      /The person in image 1 is Olive Smith/.test(k0.prompt || '') && !/character sheet/.test(k0.prompt || ''),
      `${twin?.status} ${twin?.error || ''} cast ${twin?.result?.project?.scenes?.[0]?.cast} images ${k0.images?.length} ${(k0.prompt || '').slice(0, 300)}`);
    check('film: clothes from the scene, each named character once (prompt and negative)',
      /Dress them as this scene describes/.test(k0.prompt || '') && !/same face, hair, body, clothes/.test(k0.prompt || '') &&
      /\(Olive Smith, Anh Pham\) appears in the frame exactly once/.test(k0.prompt || '') && /the same person twice/.test(k0.negative || ''), (k0.prompt || '').slice(0, 600));
    check('film: a keyframe showing someone twice is checked (small JPEG), redrawn once saying so, and the redraw checked',
      twinKeys.length === 2 && frameChecks.length === 2 && /^IMPORTANT: draw each person ONCE\. A first attempt showed the same person twice \(Olive appears twice\.\)/.test(twinKeys[1]?.body?.prompt || '') &&
      JSON.stringify(twin?.result?.project?.scenes?.[0]?.keyframeCheck) === JSON.stringify({ figures: 1, duplicated: false, note: 'fine', redrawn: true }),
      `${twinKeys.length} keyframes, ${frameChecks.length} checks, ${JSON.stringify(twin?.result?.project?.scenes?.[0]?.keyframeCheck)}`);
    const twinVideo = twinCalls.find(q => q.path.endsWith('/video/generations'));
    check('film: the clip is told the characters are already in its first frame (no second Olive coming in)',
      /already in the opening frame: animate them; never add a second copy of anyone/.test(twinVideo?.body?.prompt || ''), (twinVideo?.body?.prompt || '').slice(-200));
    await call('POST', `${jobsUrl}/${twin?.jobId}/ack`, editor.token);

    // ── storyboard, takes and the cut (2.23.61) ──
    await db.query('UPDATE books SET characters = $2 WHERE id = $1', [book.id, JSON.stringify([{ id: 'c1', name: 'Mira Vale', imageUrl: portraitForFilm }])]);
    const sbScenes = [{ sceneNumber: 1, title: 'Stairs', visualPrompt: 'Mira climbs the lighthouse stairs', characters: ['Mira'], duration: 1, location: 'Gull Lighthouse' },
      { sceneNumber: 2, title: 'Top', visualPrompt: 'Mira reaches the lamp room', characters: ['Mira'], duration: 1, location: 'Gull Lighthouse', transition: 'continue' }];
    const eq0 = await editorQuota();
    let mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'storyboard', target: { type: 'animation', id: 't3' }, params: { scenes: sbScenes, style: 'animated' }, label: 'Storyboard: scenes 1–2' });
    const sb = await waitJob(editor.token, r.json?.job?.jobId);
    const sbCalls = gateway.requests.slice(mark);
    const sbKeys = sbCalls.filter(q => q.path.endsWith('/images/generations') && q.body?.model === 'qwen-image-2.1');
    check('storyboard: a still per scene in order, no video, one quota slot, the label kept',
      sb?.status === 'done' && sb.label === 'Storyboard: scenes 1–2' && sb.result?.stills?.length === 2 && sb.result.stills.every(x => x.status === 'completed' && /^\/api\/media\/images\/keyframe-/.test(x.url)) &&
      sbKeys.length === 2 && !sbCalls.some(q => q.path.endsWith('/video/generations')) && (await editorQuota()) === eq0 + 1,
      `${sb?.status} ${sb?.error || ''} ${JSON.stringify(sb?.result?.stills)} keys ${sbKeys.length} quota ${eq0}->${await editorQuota()}`);
    check('storyboard: scene 2 is drawn from scene 1\'s still, as the same shot a moment later (it continues)',
      sbKeys[1]?.body?.images?.length >= 2 && /SAME shot a moment later/.test(sbKeys[1]?.body?.prompt || ''), (sbKeys[1]?.body?.prompt || '').slice(-400));
    await call('POST', `${jobsUrl}/${sb?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'storyboard', target: { type: 'animation', id: 't3' }, params: { scenes: [{ ...sbScenes[1], previousStill: 'https://evil.example/x.png' }] } });
    check('storyboard: a previous still from outside the app = 400', r.status === 400, `status ${r.status}`);

    // a take from the chosen still: no keyframe drawn, the clip starts from that still, no film
    const still1 = sb?.result?.stills?.[0]?.url;
    mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'animation', target: { type: 'animation', id: 't3' }, params: { scenes: [{ ...sbScenes[0], still: still1 }], options: { style: 'animated', takesOnly: true } } });
    const tk = await waitJob(editor.token, r.json?.job?.jobId);
    const tkCalls = gateway.requests.slice(mark);
    const tkVideo = tkCalls.filter(q => q.path.endsWith('/video/generations'));
    check('takes: a scene rendered from its chosen still (no keyframe drawn), a take back and no film',
      tk?.status === 'done' && !tk.result?.project && tk.result?.takes?.length === 1 && /^scene-1-.*\.mp4$/.test(tk.result.takes[0].filename || '') &&
      tk.result.takes[0].keyframeUrl === still1 && !tkCalls.some(q => q.path.endsWith('/images/generations')) && tkVideo.length === 1 && /^data:image\//.test(tkVideo[0].body?.image || ''),
      `${tk?.status} ${tk?.error || ''} ${JSON.stringify(tk?.result).slice(0, 300)} images ${tkCalls.filter(q => q.path.endsWith('/images/generations')).length}`);
    await call('POST', `${jobsUrl}/${tk?.jobId}/ack`, editor.token);

    // scene 2 continues scene 1's KEPT take: scene 1 is not rendered again, scene 2 starts from its last frame
    const take1 = tk?.result?.takes?.[0] || {};
    mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'animation', target: { type: 'animation', id: 't3' }, params: { scenes: [
      { ...sbScenes[0], reuseTake: { filename: take1.filename, videoUrl: take1.videoUrl, keyframeUrl: take1.keyframeUrl } },
      { ...sbScenes[1], still: sb?.result?.stills?.[1]?.url }], options: { style: 'animated', takesOnly: true } } });
    const tk2 = await waitJob(editor.token, r.json?.job?.jobId);
    const tk2Calls = gateway.requests.slice(mark);
    check('takes: a kept take is not rendered again and the next scene continues from its last frame',
      tk2?.status === 'done' && tk2.result?.takes?.length === 1 && tk2.result.takes[0].sceneNumber === 2 &&
      tk2Calls.filter(q => q.path.endsWith('/video/generations')).length === 1 && !tk2Calls.some(q => q.path.endsWith('/images/generations')) &&
      /^\/api\/media\/images\/keyframe-/.test(tk2.result.takes[0].keyframeUrl || '') && tk2.result.takes[0].keyframeUrl !== sb?.result?.stills?.[1]?.url,
      `${tk2?.status} ${tk2?.error || ''} ${JSON.stringify(tk2?.result).slice(0, 300)}`);
    await call('POST', `${jobsUrl}/${tk2?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'animation', target: { type: 'animation', id: 't3' }, params: { scenes: [
      { ...sbScenes[0], reuseTake: { filename: 'scene-1-not-yours.mp4' } }, sbScenes[1]], options: { takesOnly: true } } });
    check('takes: a kept clip that is not the book\'s = 404', r.status === 404, `status ${r.status}`);
    r = await call('POST', jobsUrl, editor.token, { type: 'animation', target: { type: 'animation', id: 't3' }, params: { scenes: [{ ...sbScenes[0], still: '../../etc/passwd' }], options: { takesOnly: true } } });
    check('takes: a still that is not one of the app\'s images = 400', r.status === 400, `status ${r.status}`);

    // the cut: free, from the chosen takes, a new project
    const take2 = tk2?.result?.takes?.[0] || {};
    const eq1 = await editorQuota();
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't3' }, params: { cut: { title: 'Lighthouse', style: 'animated', scenes: [
      { sceneNumber: 1, title: 'Stairs', filename: take1.filename, keyframeUrl: take1.keyframeUrl },
      { sceneNumber: 2, title: 'Top', filename: take2.filename, transition: 'continue' }] } }, label: 'Cutting the film' });
    const cutJob = await waitJob(editor.token, r.json?.job?.jobId);
    const cp = cutJob?.result?.project;
    check('cut: the chosen takes joined into a new film, free, with the scene list\'s transitions',
      cutJob?.status === 'done' && cp?.cutFromTakes === true && cp.transcriptId === 't3' && cp.title === 'Lighthouse' && cp.style === 'animated' &&
      cp.scenes.map(x => x.filename).join() === [take1.filename, take2.filename].join() && /^\/api\/media\/videos\/film-/.test(cp.finalVideo?.videoUrl || '') &&
      cp.finalVideo.transitions?.[0]?.transition === 'continue' && (await editorQuota()) === eq1,
      `${cutJob?.status} ${cutJob?.error || ''} ${JSON.stringify(cp?.finalVideo?.transitions)} quota ${eq1}->${await editorQuota()}`);
    await call('POST', `${jobsUrl}/${cutJob?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't3' }, params: { cut: { scenes: [{ filename: take1.filename }, { filename: 'film-123.mp4' }] } } });
    check('cut: a clip that is not the book\'s = 404 (nothing joined)', r.status === 404, `status ${r.status}`);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't3' }, params: { cut: { scenes: [{ filename: take1.filename, transition: 'spin' }] } } });
    check('cut: an unknown transition = 400', r.status === 400, `status ${r.status}`);

    // the scene list (client): stills and takes applied once, the chosen ones used for renders and the cut
    const ft = await import('../../src/utils/filmTakes.js');
    let fb = { metadata: { animationDrafts: { t3: { scenes: sbScenes.map(x => ({ ...x })) } } } };
    fb = ft.applyStoryboard(fb, { ...sb, target: { type: 'animation', id: 't3' } });
    const again = ft.applyStoryboard(fb, { ...sb, target: { type: 'animation', id: 't3' } });
    fb = ft.applyTakes(fb, { ...tk, target: { type: 'animation', id: 't3' } });
    const d3 = fb.metadata.animationDrafts.t3;
    check('scene list: a storyboard\'s stills and a render\'s takes land on their scenes once, each the chosen one',
      again === fb || ft.applyStoryboard(fb, { ...sb, target: { type: 'animation', id: 't3' } }) === fb) ;
    check('scene list: chosen still/take, the render list (still for the rendered scene, the take before it kept) and the cut',
      ft.chosenStill(d3.scenes[0]) === still1 && ft.chosenTake(d3.scenes[0])?.filename === take1.filename && !ft.chosenTake(d3.scenes[1]) &&
      JSON.stringify(ft.renderScenes(d3.scenes, [2]).map(x => [x.sceneNumber, x.still ? 'still' : '', x.reuseTake?.filename || ''])) === JSON.stringify([[1, '', take1.filename], [2, 'still', '']]) &&
      ft.renderScenes(d3.scenes, [2]).every(x => !x.stills && !x.takes) &&
      JSON.stringify(ft.cutScenes(d3.scenes).map(x => x.filename)) === JSON.stringify([take1.filename]),
      JSON.stringify(d3.scenes.map(x => ({ still: x.still, take: x.take }))));
    const d4 = ft.removeTake(fb, 't3', 1, d3.scenes[0].take).metadata.animationDrafts.t3;
    const withGap = [{ ...d3.scenes[0], takes: [], take: null }, { ...d3.scenes[1], takes: [{ id: 'x', filename: 'b.mp4' }], take: 'x' }];
    check('scene list: deleting the only take empties the scene; a "continue" after a scene with no take dissolves in the cut',
      !ft.chosenTake(d4.scenes[0]) && ft.cutScenes(withGap)[0]?.transition === 'dissolve', JSON.stringify(ft.cutScenes(withGap)));

    // ── the film's sound: voice-over (written, spoken), music, clip levels (2.23.62) ──
    const eq2 = await editorQuota();
    mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'film-narration', target: { type: 'animation', id: 't3' }, params: { scenes: sbScenes, seconds: 10 } });
    const nar = await waitJob(editor.token, r.json?.job?.jobId);
    const narCall = gateway.requests.slice(mark).find(q => /You write the voice-over for a short film/.test(q.body?.messages?.[0]?.content || ''));
    check('voice-over: written to the running time (about 20 words for 10 s), trimmed at a sentence, one quota slot',
      nar?.status === 'done' && nar.label === 'Writing the voice-over' && /about 20 words/.test(narCall?.body?.messages?.[0]?.content || '') &&
      nar.result.words <= 25 && /alone\.$/.test(nar.result.narration) && nar.result.targetWords === 20 && (await editorQuota()) === eq2 + 1,
      `${nar?.status} ${nar?.error || ''} ${JSON.stringify(nar?.result)}`);
    await call('POST', `${jobsUrl}/${nar?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-voice', target: { type: 'animation', id: 't3' }, params: { text: 'TONE The keeper climbed alone.', voice: { engine: 'vibevoice', voice: 'en-emma_woman' } } });
    const vo = await waitJob(editor.token, r.json?.job?.jobId);
    const voFile = vo?.result?.voiceover;
    check('voice-over: spoken in the chosen audiobook voice, stored as the user\'s MP3',
      vo?.status === 'done' && /^film-voiceover-.*\.mp3$/.test(voFile?.filename || '') && voFile.voice?.voice === 'en-emma_woman' && voFile.duration > 1 &&
      (await fetch(`${call.base}${voFile.url}`, { headers: { Authorization: `Bearer ${editor.token}` } })).status === 200,
      `${vo?.status} ${vo?.error || ''} ${JSON.stringify(vo?.result)}`);
    await call('POST', `${jobsUrl}/${vo?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-music', target: { type: 'animation', id: 't3' }, params: { prompt: 'x'.repeat(301), seconds: 30 } });
    const r2 = await call('POST', jobsUrl, editor.token, { type: 'film-music', target: { type: 'animation', id: 't3' }, params: { prompt: 'piano', seconds: 500 } });
    check('music: a prompt over 300 characters or a length over 180 s = 400', r.status === 400 && r2.status === 400, `${r.status} ${r2.status}`);
    mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'film-music', target: { type: 'animation', id: 't3' }, params: { prompt: 'slow piano, melancholic, instrumental', seconds: 12 } });
    const mu = await waitJob(editor.token, r.json?.job?.jobId);
    const muCall = gateway.requests.slice(mark).find(q => q.path.endsWith('/audio/music'));
    check('music: composed by the bridge from the prompt at the film\'s length, stored as the user\'s MP3',
      mu?.status === 'done' && /^film-music-.*\.mp3$/.test(mu.result?.music?.filename || '') && muCall?.body?.prompt === 'slow piano, melancholic, instrumental' && muCall.body.seconds === 12,
      `${mu?.status} ${mu?.error || ''} ${JSON.stringify(mu?.result)}`);
    await call('POST', `${jobsUrl}/${mu?.jobId}/ack`, editor.token);

    const sound = { voiceover: { filename: voFile?.filename, volume: 1, offset: 0.3 }, music: { filename: mu?.result?.music?.filename, volume: 0.8 } };
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't3' }, params: { cut: { title: 'With sound', scenes: [
      { sceneNumber: 1, filename: take1.filename, clipVolume: 0 }, { sceneNumber: 2, filename: take2.filename, transition: 'dissolve', clipVolume: 1.2 }], sound } } });
    const sc = await waitJob(editor.token, r.json?.job?.jobId);
    const scp = sc?.result?.project;
    let scLevel = null;
    if (scp?.finalVideo?.filename) {
      const { default: ffmpegPath } = await import('ffmpeg-static');
      const film = await fetch(`${call.base}${scp.finalVideo.videoUrl}`, { headers: { Authorization: `Bearer ${editor.token}` } });
      const f = path.join(os.tmpdir(), `regress-sound-${process.pid}.mp4`);
      fs.writeFileSync(f, Buffer.from(await film.arrayBuffer()));
      const err = await new Promise((resolve) => { let e = ''; const p = spawn(ffmpegPath, ['-i', f, '-vn', '-af', 'volumedetect', '-f', 'null', '-']); p.stderr.on('data', d => { e += d; }); p.on('exit', () => resolve(e)); });
      scLevel = Number((err.match(/mean_volume: (-?[\d.]+) dB/) || [])[1]);
    }
    check('cut with sound: the voice-over and the music are mixed in (an audible track), the levels kept on the film',
      sc?.status === 'done' && scp?.finalVideo?.sound?.voiceover === true && scp.finalVideo.sound.music === true && scp.sound?.music?.volume === 0.8 &&
      scp.scenes[0].clipVolume === 0 && scp.scenes[1].clipVolume === 1.2 && scLevel > -40,
      `${sc?.status} ${sc?.error || ''} sound ${JSON.stringify(scp?.finalVideo?.sound)} level ${scLevel}`);
    await call('POST', `${jobsUrl}/${sc?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't3' }, params: { cut: { scenes: [{ filename: take1.filename }], sound: { music: { filename: 'upload-not-yours.mp3' } } } } });
    check('cut with sound: music that is not the user\'s = 404', r.status === 404, `status ${r.status}`);

    const { audioGraph } = await import('../services/filmMix.js');
    const g = audioGraph([{ frames: 48, audioInput: 0 }, { frames: 48, audioInput: null }], [{ seconds: 0.5 }], { blend: [12], total: 84 },
      { voice: { input: 1, gainDb: 3, offset: 0.5 }, music: { input: 2, gainDb: -6 } });
    check('sound graph: narration ducks the clips and the music; every bus padded to the film\'s length before the sidechain',
      (g.match(/sidechaincompress/g) || []).length === 2 && /\[vo\]asplit=3/.test(g) && /adelay=500\|500/.test(g) && /amix=inputs=3/.test(g) &&
      ['[clips]', '[vo]', '[mu]'].every(l => new RegExp(`apad,atrim=0:3\\.5[^;]*${l.replace(/[[\]]/g, '\\$&')}`).test(g)), g);

    // ── editing: trims, still edits, the shot doctor, the director, exports (2.23.63) ──
    r = await call('POST', jobsUrl, editor.token, { type: 'film-join', target: { type: 'animation', id: 't3' }, params: { cut: { scenes: [
      { sceneNumber: 1, filename: take1.filename, trimIn: 0.2, trimOut: 0.9 }, { sceneNumber: 2, filename: take2.filename, transition: 'dissolve', trimIn: 0.2, trimOut: 0.9 }] } } });
    const trimmed = await waitJob(editor.token, r.json?.job?.jobId);
    check('trim: each take cut to the part the author chose (a shorter film), the trims kept on its scenes',
      trimmed?.status === 'done' && trimmed.result.project.finalVideo.duration < 1.3 && cp?.finalVideo?.duration > trimmed.result.project.finalVideo.duration &&
      trimmed.result.project.scenes.every(x => x.trimIn === 0.2 && x.trimOut === 0.9),
      `${trimmed?.status} ${trimmed?.error || ''} trimmed ${trimmed?.result?.project?.finalVideo?.duration} vs ${cp?.finalVideo?.duration}`);
    await call('POST', `${jobsUrl}/${trimmed?.jobId}/ack`, editor.token);

    mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'storyboard', target: { type: 'animation', id: 't3' }, params: { scenes: [{ ...sbScenes[0], edit: { from: still1, instruction: 'make it night with rain' } }] } });
    const ed = await waitJob(editor.token, r.json?.job?.jobId);
    const edCall = gateway.requests.slice(mark).find(q => q.path.endsWith('/images/generations'));
    check('edit a still: the chosen still edited from an instruction (its picture as the input), everything else kept',
      ed?.status === 'done' && ed.result.stills[0]?.source === 'edited' && ed.result.stills[0].edit === 'make it night with rain' &&
      /^make it night with rain\. Keep everything else exactly the same/.test(edCall?.body?.prompt || '') && /^data:image\//.test(edCall?.body?.image || '') &&
      gateway.requests.slice(mark).filter(q => q.path.endsWith('/images/generations')).length === 1,
      `${ed?.status} ${ed?.error || ''} ${JSON.stringify(ed?.result)} ${(edCall?.body?.prompt || '').slice(0, 120)}`);
    await call('POST', `${jobsUrl}/${ed?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'storyboard', target: { type: 'animation', id: 't3' }, params: { scenes: [{ ...sbScenes[0], edit: { from: 'https://x.example/a.png', instruction: 'x' } }] } });
    check('edit a still: a still from outside the app = 400', r.status === 400, `status ${r.status}`);

    const eq3 = await editorQuota();
    mark = gateway.requests.length;
    r = await call('POST', jobsUrl, editor.token, { type: 'film-advice', target: { type: 'animation', id: 't3' }, params: { scene: sbScenes[1], still: sb?.result?.stills?.[1]?.url, previousStill: still1 } });
    const adv = await waitJob(editor.token, r.json?.job?.jobId);
    check('shot doctor: the still and the one before it looked at (small JPEGs); notes and a better description; one quota slot',
      adv?.status === 'done' && adv.result.sceneNumber === 2 && adv.result.verdict === 'fix' && adv.result.notes[0] === 'saw 2 pictures' &&
      /^Medium shot at dusk/.test(adv.result.prompt) && adv.result.still === sb?.result?.stills?.[1]?.url && (await editorQuota()) === eq3 + 1,
      `${adv?.status} ${adv?.error || ''} ${JSON.stringify(adv?.result)}`);
    await call('POST', `${jobsUrl}/${adv?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-review', target: { type: 'animation', id: 't3' }, params: { scenes: sbScenes.map(x => ({ ...x, clipSeconds: 5 })) } });
    const rev = await waitJob(editor.token, r.json?.job?.jobId);
    check('director\'s review: one row per real scene; lengths outside 2-10 s and a transition for the first scene dropped',
      rev?.status === 'done' && rev.label === "Director's review" && rev.result.overall === 'Slow the ending down.' &&
      JSON.stringify(rev.result.scenes) === JSON.stringify([{ sceneNumber: 2, note: 'Hold the lamp moment longer.', duration: 8, transition: 'fade' }, { sceneNumber: 1, note: 'Fine opening.' }]),
      `${rev?.status} ${rev?.error || ''} ${JSON.stringify(rev?.result)}`);
    await call('POST', `${jobsUrl}/${rev?.jobId}/ack`, editor.token);

    await db.query('UPDATE books SET animation_projects = $2 WHERE id = $1', [book.id, JSON.stringify([cp])]);
    const eq4 = await editorQuota();
    const exports = {};
    for (const format of ['whatsapp', 'gif']) {
      r = await call('POST', jobsUrl, editor.token, { type: 'film-export', target: { type: 'animation', id: 't3' }, params: { projectId: cp?.id, format } });
      exports[format] = await waitJob(editor.token, r.json?.job?.jobId);
      await call('POST', `${jobsUrl}/${exports[format]?.jobId}/ack`, editor.token);
    }
    const wa = exports.whatsapp?.result;
    const gif = exports.gif?.result;
    const gifRes = gif?.url ? await fetch(`${call.base}${gif.url}`, { headers: { Authorization: `Bearer ${editor.token}` } }) : null;
    check('export: WhatsApp MP4 and GIF versions of a saved film, free, stored as the user\'s',
      exports.whatsapp?.status === 'done' && /^\/api\/media\/videos\/film-whatsapp-.*\.mp4$/.test(wa?.url || '') && wa.projectId === cp?.id &&
      exports.gif?.status === 'done' && /^\/api\/media\/images\/film-gif-.*\.gif$/.test(gif?.url || '') && gifRes?.status === 200 &&
      /image\/gif/.test(gifRes.headers.get('content-type') || '') && (await editorQuota()) === eq4,
      `${exports.whatsapp?.status} ${exports.whatsapp?.error || ''} ${JSON.stringify(wa)} | ${exports.gif?.status} ${exports.gif?.error || ''} ${gifRes?.status} ${gifRes?.headers.get('content-type')}`);
    // a film cut a moment ago (not saved in the book yet) exports by its file
    r = await call('POST', jobsUrl, editor.token, { type: 'film-export', target: { type: 'animation', id: 't3' }, params: { projectId: 'anim-unsaved', filename: trimmed?.result?.project?.finalVideo?.filename, format: 'gif' } });
    const unsaved = await waitJob(editor.token, r.json?.job?.jobId);
    check('export: a film not yet saved in the book exports by its file; the result names its project',
      unsaved?.status === 'done' && unsaved.result.projectId === 'anim-unsaved' && /film-gif-/.test(unsaved.result.filename || ''), `${r.status} ${unsaved?.status} ${unsaved?.error || ''}`);
    await call('POST', `${jobsUrl}/${unsaved?.jobId}/ack`, editor.token);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-export', target: { type: 'animation', id: 't3' }, params: { projectId: 'x', filename: 'film-999.mp4', format: 'gif' } });
    check('export: a film file that is not the book\'s = 404', r.status === 404, `status ${r.status}`);
    r = await call('POST', jobsUrl, editor.token, { type: 'film-export', target: { type: 'animation', id: 't3' }, params: { projectId: 'anim-nope', format: 'gif' } });
    const r3x = await call('POST', jobsUrl, editor.token, { type: 'film-export', target: { type: 'animation', id: 't3' }, params: { projectId: cp?.id, format: 'avi' } });
    check('export: an unknown film = 404, an unknown format = 400', r.status === 404 && r3x.status === 400, `${r.status} ${r3x.status}`);

    // the scene list (client): trims into the cut, order, advice, review, exports
    let eb = { animationProjects: [cp], metadata: { animationDrafts: { t3: { scenes: [
      { ...sbScenes[0], takes: [{ id: 'a', filename: take1.filename }], take: 'a' }, { ...sbScenes[1], takes: [{ id: 'b', filename: take2.filename }], take: 'b' }] } } } };
    eb = ft.setTrim(eb, 't3', 1, 'a', { trimIn: 0.5, trimOut: 0.7 }); // too close: the end is dropped
    eb = ft.setTrim(eb, 't3', 2, 'b', { trimOut: 3.25 });
    eb = ft.moveScene(eb, 't3', 2, -1);
    eb = ft.applyAdvice(eb, { ...adv, target: { type: 'animation', id: 't3' } });
    eb = ft.applyReview(eb, { ...rev, target: { type: 'animation', id: 't3' } });
    eb = ft.takeReviewSuggestion(eb, 't3', 2);
    eb = ft.applyExport(eb, exports.gif);
    const ed3 = eb.metadata.animationDrafts.t3;
    check('scene list: trims go into the cut, scenes reorder, advice and review land, a used suggestion is applied and leaves the list, exports land on the film',
      JSON.stringify(ft.cutScenes(ed3.scenes).map(x => [x.sceneNumber, x.trimIn ?? null, x.trimOut ?? null])) === JSON.stringify([[2, null, 3.25], [1, 0.5, null]]) &&
      ed3.scenes[0].sceneNumber === 2 && ed3.scenes[0].advice?.prompt?.startsWith('Medium shot') && ed3.scenes[0].duration === 8 && ed3.scenes[0].transition === 'fade' &&
      ed3.review.scenes.length === 1 && ed3.review.scenes[0].sceneNumber === 1 && eb.animationProjects[0].finalVideo.files.gif.filename === gif?.filename &&
      ft.applyExport(eb, exports.gif) === eb && ft.renderScenes(ed3.scenes, [1]).every(x => !x.advice),
      JSON.stringify({ cut: ft.cutScenes(ed3.scenes), review: ed3.review, advice: ed3.scenes[0].advice }));

    const fs2 = ft.applyMusic(ft.applyVoiceover(ft.applyNarration(fb, { ...nar, target: { type: 'animation', id: 't3' } }), { ...vo, target: { type: 'animation', id: 't3' } }), { ...mu, target: { type: 'animation', id: 't3' } });
    const snd = fs2.metadata.animationDrafts.t3.sound;
    check('scene list: the written text, the spoken file and the music land once; what the cut sends',
      snd.voiceover.text === nar.result.narration && snd.voiceover.filename === voFile.filename && snd.music.filename === mu.result.music.filename &&
      ft.applyNarration(fs2, { ...nar, target: { type: 'animation', id: 't3' } }) === fs2 &&
      JSON.stringify(ft.soundForServer(snd)) === JSON.stringify({ voiceover: { filename: voFile.filename, volume: 1, offset: 0.5 }, music: { filename: mu.result.music.filename, volume: 1 } }),
      JSON.stringify(snd));
  }

  // ── import (rebuilt): ePub structure, formats, review ops, create once, analysis ──
  await importChecks({ call, db, gateway, owner, stranger, jobsUrl, waitJob });
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

// ─── enhance a character from the book ────────────────────────────────────
async function enhanceChecks({ call, db, gateway, owner, stranger, bookId }) {
  console.log('\n== enhance a character from the book');
  const usedQuota = async () => (await db.query('SELECT ai_requests_today FROM quotas WHERE user_id = $1', [owner.id])).rows[0].ai_requests_today;
  const jobs = `/api/books/${bookId}/media-jobs`;
  const wait = async (jobId) => {
    for (let i = 0; i < 300; i++) {
      const j = ((await call('GET', jobs, owner.token)).json?.jobs || []).find(x => x.jobId === jobId);
      if (j && j.status !== 'running') return j;
      await new Promise(res => setTimeout(res, 200));
    }
    return null;
  };
  const filler = 'The tide turned slowly over the black sand and the gulls cried. '.repeat(60);
  const ids = (await db.query('SELECT id FROM chapters WHERE book_id = $1 AND deleted_at IS NULL ORDER BY chapter_number', [bookId])).rows.map(x => x.id);
  await db.query('UPDATE chapters SET content = $2 WHERE id = $1', [ids[0], `<p>${filler}</p><p>Mira Vale pushed the copper hair out of her eyes and climbed the Gull Lighthouse.</p><p>${filler}</p>`]);
  await db.query('UPDATE chapters SET content = $2 WHERE id = $1', [ids[1], `${filler}\n\nMira argued with her brother Tomas until dawn.\n\nThey rowed past Harrow Bay with Aslan, then Aslan waved from Harrow Bay, and old Aslan swore Harrow Bay was cursed. The Admiralty never knew, said the Admiralty clerk to the Admiralty.\n\n${filler}`]);
  const cast = [{ id: 'char-mira', name: 'Mira Vale', background: 'A cartographer', relationships: [] }, { id: 7, name: 'Tomas Reed', relationships: [] }];
  const places = [{ id: 'loc-gull', name: 'The Gull Lighthouse', description: 'A lighthouse.' }];
  await db.query('UPDATE books SET characters = $2, locations = $3 WHERE id = $1', [bookId, JSON.stringify(cast), JSON.stringify(places)]);

  const q0 = await usedQuota();
  let r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'character', id: 'char-mira' }, params: { character: { background: 'x' } } });
  check('enhance: a character without a name = 400, no quota', r.status === 400 && (await usedQuota()) === q0, `status ${r.status}`);
  r = await call('POST', jobs, stranger.token, { type: 'enhance', target: { type: 'character', id: 'char-mira' }, params: { character: cast[0] } });
  check('enhance: someone without edit rights is refused', r.status === 403, `status ${r.status}`);

  const before = gateway.requests.length;
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'character', id: 'char-mira' }, params: { character: cast[0] } });
  const job = await wait(r.json?.job?.jobId);
  const res = job?.result || {};
  const sugg = (res.suggestions || []).map(x => `${x.field}=${x.value}@${x.chapters.join(',')}`).join('|');
  check('enhance: suggestions only where the book adds something (no "unknown", no unchanged field)',
    r.status === 202 && job?.status === 'done' && sugg === 'hairColor=Copper@1|personality=Stubborn and curious.@2', `${job?.status} ${sugg} ${job?.error || ''}`);
  check('enhance: a relationship to someone in the cast, by their id, type normalised; unknown names dropped',
    JSON.stringify(res.relationships) === JSON.stringify([{ characterId: 7, name: 'Tomas Reed', type: 'Sibling', description: 'Her older brother' }]), JSON.stringify(res.relationships));
  check('enhance: new names only (the full name is not an alias)', JSON.stringify(res.aliases) === '["Mi"]' && res.read?.mentions === 2 && res.read?.chapters === 2,
    `${JSON.stringify(res.aliases)} ${JSON.stringify(res.read)}`);
  const calls = gateway.requests.slice(before).filter(q => q.path.endsWith('/chat/completions'));
  check('enhance: sai-chat-fast in JSON mode, notes from the passages (HTML read as text), then the profile',
    calls.length === 2 && calls.every(c => c.body?.model === 'sai-chat-fast' && c.body?.response_format?.type === 'json_object') &&
    /Mira Vale pushed the copper hair/.test(calls[0].body.messages[1].content) && !/<p>/.test(calls[0].body.messages[1].content) &&
    /CURRENT profile: \{"background":"A cartographer"\}/.test(calls[1].body.messages[1].content),
    calls.map(c => c.body?.model).join(','));
  await call('POST', `${jobs}/${job?.jobId}/ack`, owner.token);

  const q1 = await usedQuota();
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'character', id: 7 }, params: { character: { name: 'Ezra Nobody' } } });
  const missing = await wait(r.json?.job?.jobId);
  check('enhance: someone the chapters never mention fails with why, and the slot is refunded',
    missing?.status === 'failed' && /not mentioned/.test(missing?.error || '') && (await usedQuota()) === q1, `${missing?.status} ${missing?.error} quota ${q1}->${await usedQuota()}`);
  await call('POST', `${jobs}/${missing?.jobId}/ack`, owner.token);

  // a location: its full name (with or without "The"), same steps, no relationships
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'location', id: 'loc-gull' }, params: { item: places[0] } });
  const place = await wait(r.json?.job?.jobId);
  const ps = (place?.result?.suggestions || []).map(x => `${x.field}=${x.value}@${x.chapters.join(',')}`).join('|');
  check('enhance a location: found by name without "The", suggestions for what changes, other names (not its own)',
    place?.status === 'done' && ps === 'type=lighthouse@|history=Her father kept the light until he vanished.@1' &&
    JSON.stringify(place.result.aliases) === '["the Gull"]' && place.result.relationships.length === 0 && place.result.read?.mentions === 1 && place.label === 'Enhancing The Gull Lighthouse from the book',
    `${place?.status} ${ps} ${JSON.stringify(place?.result?.aliases)} ${place?.error || ''}`);
  const locCalls = gateway.requests.filter(q => /ONE place|location profile/.test(q.body?.messages?.[0]?.content || ''));
  check('enhance a location: the place prompts, not the character ones', locCalls.length === 2, `${locCalls.length} calls`);
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'chapter', id: 'c1' }, params: { item: { name: 'x' } } });
  check('enhance: only the kinds it knows (not chapters)', r.status === 400, `status ${r.status}`);

  // "Enhance all": one job, one quota slot, one item after another; one the
  // book never mentions is noted and the rest go on
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'characters', id: null }, params: { items: [] } });
  check('enhance all: an empty list = 400', r.status === 400, `status ${r.status}`);
  const q2 = await usedQuota();
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'characters', id: null },
    params: { items: [{ id: 'char-mira', ...cast[0] }, { id: 7, name: 'Tomas Reed' }, { id: 'ghost', name: 'Ezra Nobody' }] } });
  const all = await wait(r.json?.job?.jobId);
  const items = all?.result?.items || {};
  check('enhance all: suggestions per character, a missing one noted, one quota slot',
    all?.status === 'done' && all.label === 'Enhancing 3 characters from the book' && items['char-mira']?.suggestions?.length === 2 && Array.isArray(items[7]?.suggestions) &&
    /not mentioned/.test(items.ghost?.error || '') && (await usedQuota()) === q2 + 1,
    `${all?.status} ${all?.label} ${JSON.stringify(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.error || (v.suggestions || []).length])))} quota ${q2}->${await usedQuota()}`);
  await call('POST', `${jobs}/${all?.jobId}/ack`, owner.token);

  // a plotline: read by its chapters; links to people, places, plotlines in the book only
  const plots = [{ id: 'plot-map', title: 'The map', description: 'It leads somewhere.', chapters: [1, 2], conflicts: 'Tomas against Mira.' }];
  const events = [{ id: 'evt-1', event: 'Map found', description: 'She finds it.', chapter: 1, sceneType: 'action' }, { id: 'evt-2', event: 'The argument', chapter: 2 }, { id: 'evt-3', event: 'Somewhere in the book', chapterHint: '' }, { id: 'evt-4', event: 'NOT HERE: placed in the wrong chapter', chapter: 1, description: 'Keep me.' }];
  await db.query('UPDATE books SET plotlines = $2, timelines = $3 WHERE id = $1', [bookId, JSON.stringify(plots), JSON.stringify(events)]);
  let b0 = gateway.requests.length;
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'plotline', id: 'plot-map' }, params: { item: { ...plots[0], name: plots[0].title } } });
  const plot = await wait(r.json?.job?.jobId);
  const pls = (plot?.result?.suggestions || []).map(x => `${x.field}=${x.value}@${x.chapters.join(',')}`).join('|');
  check('plotline: type normalised, the unchanged conflict not suggested, chapters cited',
    plot?.status === 'done' && pls === "type=main@|description=Mira follows her father's chart to the sea cave.@1,2|themes=Grief and trust.@2" && plot.result.read?.chapters === 2,
    `${plot?.status} ${pls} ${plot?.error || ''}`);
  check('plotline: links only to people, places and plotlines that are in the book',
    JSON.stringify(plot?.result?.links) === JSON.stringify([{ list: 'linkedCharacters', id: 'char-mira', name: 'Mira Vale' }, { list: 'linkedLocations', id: 'loc-gull', name: 'The Gull Lighthouse' }]),
    JSON.stringify(plot?.result?.links));
  const plotNotes = gateway.requests.slice(b0).find(q => /how ONE storyline develops/.test(q.body?.messages?.[0]?.content || ''));
  check('plotline: its chapters are read (both, as plain text)', /copper hair/.test(plotNotes?.body?.messages?.[1]?.content || '') && /her brother Tomas/.test(plotNotes?.body?.messages?.[1]?.content || '') && !/<p>/.test(plotNotes?.body?.messages?.[1]?.content || ''));
  await call('POST', `${jobs}/${plot?.jobId}/ack`, owner.token);

  // the timeline: one call per chapter, in order, each told the last known time
  b0 = gateway.requests.length;
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'timelines', id: null }, params: { items: events.map(e => ({ ...e, name: e.event })) } });
  const tl = await wait(r.json?.job?.jobId);
  const ev1 = (tl?.result?.items?.['evt-1']?.suggestions || []).map(x => `${x.field}=${x.value}@${x.chapters.join(',')}`).join('|');
  const tlCalls = gateway.requests.slice(b0).filter(q => /fill in the timeline events of one chapter/.test(q.body?.messages?.[0]?.content || ''));
  check('timeline: date, place from the Locations list, scene type normalised, description; per event, its chapter cited',
    tl?.status === 'done' && tl.label === 'Enhancing 4 timeline events from the book' &&
    ev1 === 'date=Day one@1|location=The Gull Lighthouse@1|sceneType=dialogue@1|description=About Map found@1' &&
    tl.result.items['evt-2']?.suggestions?.some(x => x.field === 'date' && x.value === 'That night') && Array.isArray(tl.result.items['evt-3']?.suggestions),
    `${tl?.status} ${tl?.label} ${ev1} ${tl?.error || ''}`);
  check('timeline: an event that is not in its chapter is flagged, with nothing suggested (never a different scene)',
    tl?.result?.items?.['evt-4']?.missing === true && tl.result.items['evt-4'].suggestions.length === 0, JSON.stringify(tl?.result?.items?.['evt-4']));
  check('timeline: one call per chapter (+1 for events with no chapter), in order, with the last known time',
    tlCalls.length === 3 && /Last known time: none yet/.test(tlCalls[0].body.messages[1].content) && /Last known time: Day one/.test(tlCalls[1].body.messages[1].content),
    `${tlCalls.length} calls`);
  await call('POST', `${jobs}/${tl?.jobId}/ack`, owner.token);

  // people and places the book names that are in neither list
  b0 = gateway.requests.length;
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'missing', id: null }, params: {} });
  const miss = await wait(r.json?.job?.jobId);
  const sortCall = gateway.requests.slice(b0).find(q => /sort the capitalised names/.test(q.body?.messages?.[0]?.content || ''));
  const asked = sortCall?.body?.messages?.[1]?.content || '';
  check('find missing: the names the book repeats mid-sentence, none already in the lists',
    /\] Aslan \| 3 \|/.test(asked) && /\] Harrow Bay \|/.test(asked) && !/\] (Mira|Tomas|Gull Lighthouse|The Gull Lighthouse|Mira Vale)\b/.test(asked) && !/\] The tide/.test(asked),
    asked.split('\n').filter(l => /^\[/.test(l)).map(l => l.split(' | ')[0]).join(', '));
  check('find missing: people and places sorted, merged under the fuller name, invented names dropped',
    miss?.status === 'done' && miss.label === 'Finding people and places missing from your lists' &&
    JSON.stringify(miss.result.people.map(p => [p.name, p.role, p.mentions, p.chapters])) === '[["Captain Aslan","minor",3,[2]]]' &&
    JSON.stringify(miss.result.places.map(p => [p.name, p.type])) === '[["Harrow Bay","bay"]]',
    `${miss?.status} ${JSON.stringify(miss?.result).slice(0, 300)}`);
  await call('POST', `${jobs}/${miss?.jobId}/ack`, owner.token);

  // one place listed twice: the rules (client) and SAI's check (a job)
  {
  console.log('\n== duplicate locations');
  // as an editor of the book (the owner is near the AI rate limit's 50 per 15 minutes)
  const checker = await makeUser(db, 'dup-editor');
  await addCollaborator(db, bookId, checker, 'editor');
  const usedQuota = async () => (await db.query('SELECT ai_requests_today FROM quotas WHERE user_id = $1', [checker.id])).rows[0].ai_requests_today;
  const wait = async (jobId) => {
    for (let i = 0; i < 300; i++) {
      const j = ((await call('GET', jobs, checker.token)).json?.jobs || []).find(x => x.jobId === jobId);
      if (j && j.status !== 'running') return j;
      await new Promise(res => setTimeout(res, 200));
    }
    return null;
  };
  r = await call('POST', jobs, checker.token, { type: 'enhance', target: { type: 'duplicates', id: 'character' }, params: {} });
  check('duplicate check: only for locations (400)', r.status === 400 && /location/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
  const qd0 = await usedQuota();
  r = await call('POST', jobs, checker.token, { type: 'enhance', target: { type: 'duplicates', id: 'location' }, params: {} });
  check('duplicate check: needs two saved locations (400, no quota)', r.status === 400 && /two locations/.test(r.json?.error || '') && (await usedQuota()) === qd0, `${r.status} ${r.json?.error}`);
  const homes = [...places, { id: 'loc-flat', name: "Mira's flat", type: 'flat', description: 'Two rooms above the chandlery.' },
    { id: 'loc-home', name: 'The cottage on Harrow Lane', type: 'cottage', description: 'Where Mira lives, above the chandlery.' }, { id: 'loc-cafe', name: 'Harbour Cafe', type: 'cafe' }];
  await db.query('UPDATE books SET locations = $2 WHERE id = $1', [bookId, JSON.stringify(homes)]);
  b0 = gateway.requests.length;
  r = await call('POST', jobs, checker.token, { type: 'enhance', target: { type: 'duplicates', id: 'location' }, params: {} });
  const dup = await wait(r.json?.job?.jobId);
  const dupCall = gateway.requests.slice(b0).find(q => /list of locations for duplicates/.test(q.body?.messages?.[0]?.content || ''));
  const dupAsked = dupCall?.body?.messages?.[1]?.content || '';
  check('duplicate check: every location with its type and description, alphabetical; a part of a place is not the place (prompt)',
    /\[0\] Harbour Cafe \| cafe/.test(dupAsked) && /\] Mira's flat \| flat \|\s+\| Two rooms above the chandlery\./.test(dupAsked) && /A part of a place is NOT the place/.test(dupCall?.body?.messages?.[0]?.content || ''),
    dupAsked.slice(0, 300));
  check('duplicate check: the pairs by id with the reason, a bad index dropped, one quota slot',
    dup?.status === 'done' && dup.label === 'Checking your locations for duplicates' && (await usedQuota()) === qd0 + 1 &&
    JSON.stringify(dup.result.pairs) === JSON.stringify([{ keepId: 'loc-home', dropId: 'loc-flat', reason: 'Both are where Mira lives.' }]) && dup.result.read?.locations === 4,
    `${dup?.status} ${JSON.stringify(dup?.result)} ${dup?.error || ''}`);
  await call('POST', `${jobs}/${dup?.jobId}/ack`, checker.token);
  await db.query('UPDATE books SET locations = $2 WHERE id = $1', [bookId, JSON.stringify(places)]);

  }
  const dupUi = await import('../../src/utils/duplicates.js');
  const { applyEnhanceJob } = await import('../../src/utils/enhanceFromBook.js');
  const crew = [{ id: 2, name: 'Adam Carlsen' }, { id: 1, name: 'Olive Smith' }, { id: 4, name: 'Anh Pham' }];
  const sample = ['The Lab (night)', 'Aslan Lab', "Adam's office", "Dr. Carlsen's office", "Adam Carlsen's Office", 'Stanford', 'Stanford University', 'Stanford Biology Department',
    'The Gull Lighthouse', 'Gull Lighthouse - interior', 'Lighthouse cottage', "Olive's apartment", "Olive and Malcolm's apartment", 'Kitchen', "Anh's kitchen", "Olive's kitchen",
    'Garden', 'Gardens', 'Castle gate', 'Main St.', 'Main Street'];
  const found = dupUi.findDuplicates({ characters: crew, locations: sample.map((n, i) => ({ id: `s${i}`, name: n })) }, 'location').map(p => `${p.drop.name}>${p.keep.name}`).sort();
  check('location rules: forms of one place paired (owner by character, "(night)", "- interior", St.), parts and two people\'s rooms left apart',
    found.join('|') === ["Adam's office>Adam Carlsen's Office", "Dr. Carlsen's office>Adam Carlsen's Office", 'Garden>Gardens', 'Gull Lighthouse - interior>The Gull Lighthouse',
      'Main St.>Main Street', 'Stanford>Stanford University', 'The Lab (night)>Aslan Lab'].join('|'), found.join(' | '));
  let ub = { characters: crew, locations: [{ id: 'a', name: 'The cottage' }, { id: 'b', name: "Mira's flat", imageUrl: '/flat.png' }, { id: 'c', name: 'Pier' }],
    plotlines: [{ id: 'p', linkedLocations: ['b'] }], visuals: [{ id: 'v', url: '/old.png', locationId: 'b' }] };
  ub = applyEnhanceJob(ub, { jobId: 'j1', target: { type: 'duplicates', id: 'location' }, finishedAt: '2026-10-07T00:00:00Z',
    result: { pairs: [{ keepId: 'a', dropId: 'b', reason: 'One home.' }, { keepId: 'b', dropId: 'c', reason: 'x' }] } });
  const aiPairs = dupUi.findDuplicates(ub, 'location').map(p => `${p.drop.id}>${p.keep.id}:${p.reason || ''}`);
  const merged = dupUi.mergeDuplicate(ub, 'location', 'a', 'b');
  check('SAI pairs show with their reason; a merge moves pictures and links and repoints the other pairs',
    aiPairs.join() === 'b>a:One home.,c>b:x' && merged.locations.length === 2 && merged.locations[0].imageUrl === '/flat.png' &&
    merged.visuals.every(v => v.locationId === 'a') && merged.plotlines[0].linkedLocations.join() === 'a' &&
    JSON.stringify(merged.metadata.duplicateCheck.location.pairs.map(p => [p.keepId, p.dropId])) === '[["a","c"]]' &&
    dupUi.findDuplicates(dupUi.markNotDuplicates(merged, 'location', 'a', 'c'), 'location').length === 0,
    `${aiPairs.join()} ${JSON.stringify(merged.locations)} ${JSON.stringify(merged.metadata)}`);

  // Book Info from the chapters: the author's genre kept, the audience normalised
  await db.query(`UPDATE books SET metadata = metadata || '{"genre": "Gothic mystery"}'::jsonb WHERE id = $1`, [bookId]);
  r = await call('POST', jobs, owner.token, { type: 'enhance', target: { type: 'book', id: bookId }, params: { item: { genre: 'Gothic mystery' } } });
  const info = await wait(r.json?.job?.jobId);
  const is = (info?.result?.suggestions || []).map(x => `${x.field}=${x.value}`).join('|');
  const infoCall = gateway.requests.filter(q => /catalogue details/.test(q.body?.messages?.[0]?.content || '')).at(-1);
  check('Book Info from the book: audience normalised, the unchanged genre not suggested, blurb from the chapters',
    info?.status === 'done' && info.label === 'Filling Book Info from the book' &&
    is === "targetAudience=young-adult|tagline=Some maps should stay lost.|blurb=Mira Vale comes home to finish her father's map." && info.result.read?.chapters === 2,
    `${info?.status} ${is} ${JSON.stringify(info?.result?.read)} ${info?.error || ''}`);
  check('Book Info: never reveal the ending (in the prompt), the chapter text read as plain text',
    /NEVER reveal the ending/.test(infoCall?.body?.messages?.[0]?.content || '') && !/<p>/.test(infoCall?.body?.messages?.[1]?.content || ''));
  await call('POST', `${jobs}/${info?.jobId}/ack`, owner.token);
  await call('POST', `${jobs}/${place?.jobId}/ack`, owner.token);

  // ── transcripts: a background job that knows how the cast looks and what the places are like ──
  console.log('\n== transcript from a chapter');
  await db.query('UPDATE books SET characters = $2, locations = $3 WHERE id = $1', [bookId,
    JSON.stringify([{ id: 'char-mira', name: 'Mira Vale', age: '31', hairColor: 'copper', appearance: 'Freckled, wears an oilskin coat.' }, { id: 7, name: 'Tomas Reed' }]),
    JSON.stringify([{ id: 'loc-gull', name: 'The Gull Lighthouse', type: 'building', description: 'A white tower on black cliffs.', atmosphere: 'Lonely and wind-battered.' }, { id: 'loc-x', name: 'Far Market' }])]);
  r = await call('POST', jobs, owner.token, { type: 'transcript', target: { type: 'chapter', id: 'no-such-chapter' }, params: {} });
  check('transcript: a chapter not in the saved book = 404', r.status === 404, `status ${r.status}`);
  const qt = await usedQuota();
  const beforeTx = gateway.requests.length;
  r = await call('POST', jobs, owner.token, { type: 'transcript', target: { type: 'chapter', id: ids[0] }, params: {} });
  const txJob = await wait(r.json?.job?.jobId);
  const tx = txJob?.result?.transcript || {};
  check('transcript: written as a job, plain text, scenes counted, the film it makes estimated',
    txJob?.status === 'done' && tx.title === 'The Keeper' && !/TITLE:/.test(tx.transcript) && /^EXT\. THE GULL LIGHTHOUSE/.test(tx.transcript)
    && tx.sceneCount === 2 && /of film \(\d+ shots\)/.test(tx.estimatedDuration) && String(tx.chapterId) === String(ids[0]) && (await usedQuota()) === qt + 1,
    `${txJob?.status} ${txJob?.error || ''} ${JSON.stringify(tx).slice(0, 200)}`);
  const txCall = gateway.requests.slice(beforeTx).find(q => q.path.endsWith('/chat/completions'));
  const txUser = String(txCall?.body?.messages?.[1]?.content || '');
  // (the Writer role: whichever chat model the admin has given it)
  check('transcript: the writer gets how the cast looks and what the places are like, the chapter as plain text',
    ['sai-chat', 'sai-chat-fast'].includes(txCall?.body?.model) && /SETTING paragraph/.test(txCall.body.messages[0].content)
    && /Mira Vale: age 31, hair: copper\. Freckled, wears an oilskin coat\./.test(txUser) && /The Gull Lighthouse \(building\): A white tower on black cliffs\. Lonely and wind-battered\./.test(txUser)
    && /Other places in the book: Far Market/.test(txUser) && !/<p>|undefined/.test(txUser) && !/Tomas Reed/.test(txUser), `model=${txCall?.body?.model} setting=${/SETTING paragraph/.test(txCall?.body?.messages?.[0]?.content)} p=${/<p>/.test(txUser)} undef=${/undefined/.test(txUser)} tomas=${/Tomas Reed/.test(txUser)}`);
  await call('POST', `${jobs}/${txJob?.jobId}/ack`, owner.token);

  // the author's optional direction: validated, in the writer's prompt, kept on the transcript
  r = await call('POST', jobs, owner.token, { type: 'transcript', target: { type: 'chapter', id: ids[0] }, params: { guidance: { pace: 'glacial' } } });
  check('transcript direction: an unknown choice = 400', r.status === 400 && /pace is one of slow, brisk/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
  const beforeDir = gateway.requests.length;
  r = await call('POST', jobs, owner.token, { type: 'transcript', target: { type: 'chapter', id: ids[0] },
    params: { guidance: { pace: 'slow', dialogue: 'little', shots: '', notes: '  End on the light   out at sea. ' } } });
  const dirJob = await wait(r.json?.job?.jobId);
  const dirUser = String(gateway.requests.slice(beforeDir).find(q => q.path.endsWith('/chat/completions'))?.body?.messages?.[1]?.content || '');
  check('transcript direction: the choices and notes reach the writer, and are kept on the transcript',
    dirJob?.status === 'done' && /DIRECTION FROM THE AUTHOR/.test(dirUser) && /Slow and lingering/.test(dirUser) && /Little dialogue/.test(dirUser)
    && /The author's notes: End on the light out at sea\./.test(dirUser) && !/Cinematic|narrator/i.test(dirUser.split('DIRECTION FROM THE AUTHOR')[1]?.split('Characters in this passage')[0] || '')
    && JSON.stringify(dirJob.result?.transcript?.guidance) === JSON.stringify({ pace: 'slow', dialogue: 'little', notes: 'End on the light out at sea.' }),
    `${dirJob?.status} ${JSON.stringify(dirJob?.result?.transcript?.guidance)}`);
  await call('POST', `${jobs}/${dirJob?.jobId}/ack`, owner.token);
  // the Studio's shot breakdown of a saved transcript that has a direction
  await db.query('UPDATE books SET transcripts = $2 WHERE id = $1', [bookId, JSON.stringify([{ id: 'tx-dir', title: 'The Keeper', transcript: 'EXT. GULL LIGHTHOUSE - NIGHT\n\nSETTING: Storm.', guidance: { pace: 'slow', shots: 'intimate' } }])]);
  const beforeParse = gateway.requests.length;
  r = await call('POST', '/api/video/parse-transcript', owner.token, { transcriptId: 'tx-dir', bookId });
  const parseCall = gateway.requests.slice(beforeParse).find(q => q.path.endsWith('/chat/completions'));
  const shots = r.json?.scenes || [];
  check('shot breakdown: JSON mode, the transcript\'s direction applied, places snapped to the book, shots renumbered, an impossible "continue" made a cut',
    r.status === 200 && parseCall?.body?.response_format?.type === 'json_object' && /Slow pace: longer takes/.test(parseCall.body.messages[1].content)
    && /Intimate: mostly close-ups/.test(parseCall.body.messages[1].content)
    && shots.map(x => `${x.sceneNumber}:${x.location}:${x.transition}`).join('|') === '1:The Gull Lighthouse:fade|2:The Gull Lighthouse:cut',
    `${r.status} ${JSON.stringify(shots.map(x => [x.sceneNumber, x.location, x.transition]))} ${r.json?.error || ''}`);
  const { shotDirection } = await import('../services/filmShots.js');
  check('transcript direction: the shot breakdown follows it (slow pace = longer takes)',
    /longer takes \(7 to 8 seconds\)/.test(shotDirection({ pace: 'slow', notes: 'x' })) && /author's notes on this screenplay: x/.test(shotDirection({ pace: 'slow', notes: 'x' })) && shotDirection(null) === '');

  // the film helpers: book location names, and a "continue" that cannot keep the framing
  const { matchLocation } = await import('../services/filmLocations.js');
  const { normaliseTransitions } = await import('../services/filmShots.js');
  const L = [{ name: 'Shinjuku Undergrid' }, { name: 'The Gull Lighthouse' }];
  check('film: a scene\'s place snaps to the book\'s location name',
    matchLocation('Shinjuku Undergrid (Underground City)', L)?.name === 'Shinjuku Undergrid' && matchLocation('gull lighthouse', L)?.name === 'The Gull Lighthouse' && matchLocation('Noodle stall', L) === null);
  check('film: a wide shot cannot "continue" into a close-up (it becomes a cut); a camera move can',
    normaliseTransitions([{ cameraDirection: 'wide shot' }, { cameraDirection: 'extreme close-up', transition: 'continue' }, { cameraDirection: 'tracking shot', transition: 'continue' }])
      .map(x => x.transition).join() === 'fade,cut,continue');
}

// ─── book import ──────────────────────────────────────────────────────────
async function importChecks({ call, db, gateway, owner, stranger, jobsUrl, waitJob }) {
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

  // An ePub 2 whose package and TOC prefix every tag (<opf:item>, <opf:itemref>):
  // what Penguin's tools wrote for "The Love Hypothesis", which failed with
  // "No readable text" (2026-10-07). Its fonts are obfuscated (harmless), and
  // it ends with long back matter (an author's note, an excerpt of the next
  // book) that must not be read as story.
  const words = (n, w) => `<p>${Array.from({ length: n }, () => w).join(' ')}.</p>`;
  const buildPrefixed = async (encryption) => {
    const z = new JSZip();
    z.file('mimetype', 'application/epub+zip');
    z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    if (encryption) z.file('META-INF/encryption.xml', encryption);
    const pages = [['copyright', 'Copyright', words(40, 'rights')], ['ch1', 'Chapter One', words(900, 'storm')], ['ch2', 'Chapter Two', words(900, 'map')],
      ['epilogue', 'Epilogue', words(300, 'dawn')], ['note', 'Author\u2019s Note', words(450, 'thanks')], ['ack', 'Acknowledgments', words(120, 'grateful')],
      ['excerpt', 'Excerpt from THE NEXT ONE', words(2000, 'preview')], ['about', 'About the Author', words(60, 'lives')]];
    z.file('OEBPS/content.opf', `<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><opf:metadata><dc:title>Prefixed Tale</dc:title><dc:creator opf:role="aut">Pen Author</dc:creator></opf:metadata><opf:manifest>${
      pages.map(([id]) => `<opf:item id="${id}" href="xhtml/${id}.xhtml" media-type="application/xhtml+xml"/>`).join('')
    }<opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><opf:item id="font" href="fonts/a.otf" media-type="font/otf"/></opf:manifest><opf:spine toc="ncx">${
      pages.map(([id]) => `<opf:itemref idref="${id}"/>`).join('')}</opf:spine></opf:package>`);
    z.file('OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${
      pages.map(([id, title], i) => `<navPoint id="n${i}"><navLabel><text>${title}</text></navLabel><content src="xhtml/${id}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
    for (const [id, , body] of pages) z.file(`OEBPS/xhtml/${id}.xhtml`, xhtml(id, body));
    z.file('OEBPS/fonts/a.otf', 'font bytes');
    return z.generateAsync({ type: 'nodebuffer' });
  };
  const encryptionOf = (algorithm, uri) => `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
  r = await upload(owner.token, 'Prefixed Tale.epub', await buildPrefixed(encryptionOf('http://www.idpf.org/2008/embedding', 'OEBPS/fonts/a.otf')));
  const pre = await settle(owner.token, r.json?.import?.id);
  check('ePub with prefixed package tags (<opf:itemref>) and obfuscated fonts: read, title + author found',
    pre?.status === 'review' && pre.title === 'Prefixed Tale' && pre.author === 'Pen Author', JSON.stringify({ status: pre?.status, error: pre?.error, title: pre?.title }));
  check('...long back matter (author\'s note, excerpt of the next book) stays back matter',
    (pre?.chapters || []).map(c => `${c.kind[0]}:${c.title}`).join('|') === 'f:Copyright|c:Chapter One|c:Chapter Two|c:Epilogue|b:Author’s Note|b:Acknowledgments|b:Excerpt from THE NEXT ONE|b:About the Author',
    (pre?.chapters || []).map(c => `${c.kind[0]}:${c.title}`).join('|'));
  r = await upload(owner.token, 'Locked.epub', await buildPrefixed(encryptionOf('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'OEBPS/xhtml/ch1.xhtml')));
  const locked = await settle(owner.token, r.json?.import?.id);
  check('a DRM-encrypted ePub says it is DRM-protected (not "no readable text")', locked?.status === 'failed' && /DRM-protected/.test(locked.error || ''), locked?.error);
  if (pre?.id) await call('DELETE', `/api/imports/${pre.id}`, owner.token);
  if (locked?.id) await call('DELETE', `/api/imports/${locked.id}`, owner.token);

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
  check('analysis job: characters (one person named two ways is one), locations, plotlines, summaries per chapter, overview',
    analysed?.status === 'done' && analysed.result.characters[0]?.name === 'Mira Vale' && analysed.result.characters[0]?.mentions === 4 &&
    analysed.result.characters.length === 1 && analysed.result.characters[0].aliases?.join() === 'Mira' && analysed.result.characters[0].role === 'protagonist' &&
    analysed.result.locations.length === 1 && Object.keys(analysed.result.chapterSummaries).length === 2 && analysed.result.overview,
    JSON.stringify(analysed).slice(0, 220));

  check('analysis job: one place named two ways ("The Lighthouse", "Lighthouse - exterior") is one, the other name kept',
    analysed?.result?.locations?.length === 1 && analysed.result.locations[0].name === 'The Lighthouse' && analysed.result.locations[0].aliases?.join() === 'Lighthouse - exterior',
    JSON.stringify(analysed?.result?.locations));

  await enhanceChecks({ call, db, gateway, owner, stranger, bookId });

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

  // ── outline review: sai-chat-fast suggests, the user decides ──
  const sentence = (w, n) => Array.from({ length: n }, () => w).join(' ');
  const outlineMd = [
    `# The Arrival\n\n${sentence('rain', 500)}. She opened the door and`,
    `# The Arrival, continued\n\nstepped into the dark hall. ${sentence('hall', 500)}.`,
    `# The Departure\n\n${sentence('road', 500)}.`,
    `# Bonus: A Deleted Scene\n\n${sentence('cut', 500)}.`,
  ].join('\n\n');
  r = await upload(owner.token, 'outline.md', Buffer.from(outlineMd));
  let ol = await settle(owner.token, r.json?.import?.id);
  for (let i = 0; i < 100 && ol?.suggestionsStatus === 'checking'; i++) {
    await new Promise(res => setTimeout(res, 100));
    ol = (await call('GET', `/api/imports/${ol.id}`, owner.token)).json?.import;
  }
  const sugg = (x) => (x?.suggestions || []).map(s => `${s.type}@${s.index}${s.value ? `:${s.value}` : ''}`).join('|');
  check('outline review: the rules made 4 story sections, the review runs after the review opens', ol?.status === 'review' && ol.chapters.length === 4 && ol.suggestionsStatus === 'done',
    JSON.stringify({ status: ol?.status, n: ol?.chapters?.length, s: ol?.suggestionsStatus }));
  check('outline review: merge the cut chapter, move the bonus scene to back matter; junk filtered', sugg(ol) === 'kind@3:back|merge@0', sugg(ol));
  const olCall = gateway.requests.filter(q => q.path.endsWith('/chat/completions') && /check how an imported book was split/.test(q.body?.messages?.[0]?.content || '')).pop();
  check('outline review: one sai-chat-fast call in JSON mode, with how each section starts and ends',
    olCall?.body?.model === 'sai-chat-fast' && olCall?.body?.response_format?.type === 'json_object' && /starts: "stepped into the dark hall/.test(olCall?.body?.messages?.[1]?.content || ''));
  // the user's edits move sections; suggestions follow them by key
  r = await call('PATCH', `/api/imports/${ol?.id}/chapters`, owner.token, { ops: [{ op: 'move', from: 2, to: 3 }] });
  check('outline review: after a move, the suggestions point at the moved sections', sugg(r.json?.import) === 'kind@2:back|merge@0', sugg(r.json?.import));
  r = await call('PATCH', `/api/imports/${ol?.id}`, owner.token, { dismissSuggestions: [r.json?.import?.suggestions?.find(s => s.type === 'kind')?.id] });
  check('outline review: a dismissed suggestion is gone (and stays gone)', sugg(r.json?.import) === 'merge@0'
    && sugg((await call('GET', `/api/imports/${ol?.id}`, owner.token)).json?.import) === 'merge@0', sugg(r.json?.import));
  r = await call('PATCH', `/api/imports/${ol?.id}/chapters`, owner.token, { ops: [{ op: 'merge', index: 0 }] });
  check('outline review: applying it (the same merge op) clears it', r.status === 200 && sugg(r.json?.import) === '' && r.json.import.chapters.length === 3, sugg(r.json?.import));
  r = await upload(owner.token, 'broken.md', Buffer.from(`# One\n\n${sentence('a', 50)} GATEWAY_FAIL.\n\n# Two\n\n${sentence('b', 50)}.`));
  let olFail = await settle(owner.token, r.json?.import?.id);
  for (let i = 0; i < 100 && olFail?.suggestionsStatus === 'checking'; i++) {
    await new Promise(res => setTimeout(res, 100));
    olFail = (await call('GET', `/api/imports/${olFail.id}`, owner.token)).json?.import;
  }
  check('outline review: a model failure leaves the review usable (status failed, no suggestions)', olFail?.status === 'review' && olFail.suggestionsStatus === 'failed' && olFail.suggestions.length === 0,
    JSON.stringify({ status: olFail?.status, s: olFail?.suggestionsStatus }));
  for (const x of [ol, olFail]) if (x?.id) await call('DELETE', `/api/imports/${x.id}`, owner.token);

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
