/* The client library against a STUB HTTP server (no Docker, no Drive): exactly what it sends, what it retries and what it never retries. Run: node lib.test.js */
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createDriveClient, DriveError } = require('../index.cjs');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log(`FAIL ${n}${d ? '\n  ' + String(d).slice(0, 400) : ''}`); } };
const SECRET = 'lib-test-secret-' + crypto.randomBytes(16).toString('hex'), SUB = 'u_0123456789abcdef';

(async () => {
  const seen = []; let script = [];
  const srv = http.createServer((req, res) => {
    const ch = []; req.on('data', c => ch.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(ch) });
      const step = script.length ? script.shift() : { status: 200, json: {} };
      if (step.hang) return;                                            // never answers
      const body = step.json !== undefined ? Buffer.from(JSON.stringify(step.json)) : (step.body || Buffer.alloc(0));
      res.writeHead(step.status, { 'content-type': 'application/json', 'content-length': body.length, ...(step.headers || {}) });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const mk = o => createDriveClient({ base, appId: 'portal', appSecret: SECRET, baseDelayMs: 1, ...(o || {}) }).forUser(SUB);
  const reset = s => { seen.length = 0; script = s || []; };
  try {
    // what is sent
    reset([{ status: 201, json: { id: 'i' } }]);
    const data = Buffer.from('hello world');
    await mk().put(data, { project: 'media', path: 'Films/f 1/clip é.mp4', ref: 'film:1', tag: 'final', contentType: 'video/mp4', sha256: true });
    const q = seen[seen.length - 1];
    ok('put: method, URL-encoded path and ref, tag and the computed sha256', q.method === 'PUT' && q.url.startsWith('/app/v1/projects/media/files?') && new URL(q.url, 'http://x').searchParams.get('path') === 'Films/f 1/clip é.mp4' && new URL(q.url, 'http://x').searchParams.get('ref') === 'film:1' && new URL(q.url, 'http://x').searchParams.get('tag') === 'final' && new URL(q.url, 'http://x').searchParams.get('sha256') === crypto.createHash('sha256').update(data).digest('hex'));
    ok('put: x-app-id, x-app-secret, x-sub, a request id, content-length and the content type; the body arrives whole', q.headers['x-app-id'] === 'portal' && q.headers['x-app-secret'] === SECRET && q.headers['x-sub'] === SUB && /^[0-9a-f-]{36}$/.test(q.headers['x-request-id']) && q.headers['content-length'] === '11' && q.headers['content-type'] === 'video/mp4' && q.body.equals(data));
    ok('the secret is only ever in the x-app-secret header (not in the URL, not in any other header)', !q.url.includes(SECRET) && Object.entries(q.headers).every(([k, v]) => k === 'x-app-secret' || !String(v).includes(SECRET)));
    reset([{ status: 200, json: {} }]); await mk().patch('media', 'id1', { name: 'x' });
    ok('patch sends JSON', seen[0].method === 'PATCH' && seen[0].headers['content-type'] === 'application/json' && JSON.parse(seen[0].body).name === 'x');
    reset([{ status: 200, json: { dryRun: true } }]); await mk().prune('media', { olderThanSeconds: 10 });
    ok('prune defaults to dryRun:true and only intermediate', JSON.parse(seen[0].body).dryRun === true && JSON.parse(seen[0].body).tag === 'intermediate');
    reset([{ status: 200, json: {} }]); await mk().remove('media', 'i', { bin: true });
    ok('remove: bin flag', new URL(seen[0].url, 'http://x').searchParams.get('bin') === '1' && !new URL(seen[0].url, 'http://x').searchParams.has('permanent'));
    reset([{ status: 200, json: {} }, { status: 200, json: {} }]); await mk().remove('media', 'i', { permanent: true, recursive: true });
    ok('remove: permanent and recursive flags', new URL(seen[0].url, 'http://x').searchParams.get('permanent') === '1' && new URL(seen[0].url, 'http://x').searchParams.get('recursive') === '1');
    // list iterator follows the cursor
    reset([{ status: 200, json: { items: [{ id: 1 }, { id: 2 }], next: 'c1' } }, { status: 200, json: { items: [{ id: 3 }], next: null } }]);
    const got = []; for await (const it of mk().list('media', { path: 'A', pageSize: 2 })) got.push(it.id);
    ok('list follows `next` until it is null and sends after=', got.join() === '1,2,3' && seen.length === 2 && new URL(seen[1].url, 'http://x').searchParams.get('after') === 'c1');
    // retries
    reset([{ status: 503, json: { code: 'internal' } }, { status: 503, json: { code: 'internal' } }, { status: 200, json: { used: 1 } }]);
    ok('a safe call (quota) is retried on 5xx and then succeeds', (await mk().quota()).used === 1 && seen.length === 3);
    reset([{ status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} }, { status: 200, json: {} }]);
    const e1 = await mk({ retries: 3 }).quota().catch(e => e);
    ok('...at most `retries` times, then unavailable (4 attempts)', e1 instanceof DriveError && e1.code === 'unavailable' && e1.status === 503 && seen.length === 4);
    for (const [st, code] of [[400, 'bad_request'], [401, 'internal'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [413, 'quota'], [422, 'hash_mismatch'], [451, 'infected']]) {
      reset([{ status: st, json: { error: 'x', code: 'whatever' } }, { status: 200, json: {} }]);
      const e = await mk().quota().catch(x => x);
      ok(`${st} is ${code} and is NEVER retried`, e instanceof DriveError && e.code === code && seen.length === 1, `${e.code} ${seen.length}`);
    }
    reset([{ status: 413, json: { error: 'x', code: 'app_cap' } }]); ok('413 app_cap is app_cap', (await mk().quota().catch(x => x)).code === 'app_cap');
    reset([{ status: 413, json: { error: 'x', code: 'file_too_large' } }]); ok('413 file_too_large is file_too_large', (await mk().quota().catch(x => x)).code === 'file_too_large');
    reset([{ status: 413, json: { error: 'x', code: 'over_quota' } }]); const oq = await mk().quota().catch(x => x); ok('413 over_quota is quota with detail over_quota', oq.code === 'quota' && oq.detail === 'over_quota');
    reset([{ status: 403, json: { error: 'x', code: 'frozen' } }]); ok('403 frozen / gone are their own codes', (await mk().quota().catch(x => x)).code === 'frozen');
    reset([{ status: 403, json: { error: 'x', code: 'gone' } }]); ok('...gone', (await mk().quota().catch(x => x)).code === 'gone');
    reset([{ status: 409, json: { error: 'x', code: 'project_in_bin' } }]); ok('409 project_in_bin', (await mk().quota().catch(x => x)).code === 'project_in_bin');
    reset([{ status: 409, json: { error: 'x', code: 'in_progress' } }, { status: 200, json: { ok: 1 } }]); ok('409 in_progress IS retried (another upload of the same ref is still arriving)', (await mk().quota()).ok === 1 && seen.length === 2);
    reset([{ status: 429, json: { code: 'busy' }, headers: { 'retry-after': '0' } }, { status: 200, json: { ok: 1 } }]); ok('429 busy is retried', (await mk().quota()).ok === 1 && seen.length === 2);
    reset([{ status: 409, json: { error: 'x', code: 'not_empty', items: 3 } }]); const ne = await mk().quota().catch(x => x); ok('extra server fields (items, blocking) are kept on the error', ne.extra && ne.extra.items === 3);
    reset([{ status: 416, body: Buffer.alloc(0) }]); ok('416 is bad_range', (await mk().get('media', 'i').catch(x => x)).code === 'bad_range');
    // put retry rules
    reset([{ status: 502, json: { code: 'store' } }, { status: 201, json: { id: 'ok' } }]);
    ok('put with a Buffer is retried (idempotent by ref)', (await mk().put(Buffer.from('abc'), { project: 'media', path: 'a.bin', ref: 'r', tag: 'final' })).id === 'ok' && seen.length === 2 && seen[0].body.equals(seen[1].body));
    reset([{ status: 502, json: { code: 'store' } }, { status: 201, json: { id: 'ok' } }]);
    let made = 0;
    ok('put with a function body is retried with a FRESH stream each time', (await mk().put(() => { made++; return Readable.from([Buffer.from('abc')]); }, { project: 'media', path: 'a.bin', ref: 'r', tag: 'final', size: 3 })).id === 'ok' && made === 2 && seen[1].body.toString() === 'abc');
    reset([{ status: 502, json: { code: 'store' } }, { status: 201, json: { id: 'ok' } }]);
    ok('put with a one-shot stream is NOT retried', (await mk().put(Readable.from([Buffer.from('abc')]), { project: 'media', path: 'a.bin', ref: 'r', tag: 'final', size: 3 }).catch(x => x)).code === 'unavailable' && seen.length === 1);
    reset([{ status: 200, json: { id: 'i', sha256: crypto.createHash('sha256').update('abc').digest('hex'), path: 'a.bin', tag: 'final', version: 'v' } }]);
    const pre = await mk().put(Buffer.from('abc'), { project: 'media', path: 'a.bin', ref: 'r', tag: 'final', sha256: true });
    ok('put with a known sha256 first asks Drive (a stat) and, on a match, sends no body at all', pre.replayed === true && seen.length === 1 && seen[0].method === 'GET' && seen[0].url.includes('stat=1'));
    reset([{ status: 500, json: {} }, { status: 200, json: {} }]);
    ok('patch is never retried; a real prune is never retried', (await mk().patch('media', 'i', { name: 'x' }).catch(x => x)).code === 'unavailable' && seen.length === 1);
    reset([{ status: 503, json: {} }, { status: 200, json: {} }]);
    ok('...a real prune', (await mk().prune('media', { olderThanSeconds: 1, dryRun: false }).catch(x => x)).code === 'unavailable' && seen.length === 1);
    reset([{ status: 503, json: {} }, { status: 200, json: { dryRun: true } }]);
    ok('...but a dry-run prune is', (await mk().prune('media', { olderThanSeconds: 1 })).dryRun === true && seen.length === 2);
    // timeouts and budget
    reset([{ hang: true }]);
    const t0 = Date.now(); const to = await mk({ timeoutMs: 150, retries: 0 }).quota().catch(x => x);
    ok('a server that never answers: unavailable after the timeout', to instanceof DriveError && to.code === 'unavailable' && Date.now() - t0 < 2000);
    reset([{ status: 503, json: {} }, { status: 503, json: {} }, { status: 503, json: {} }, { status: 200, json: {} }]);
    const t1 = Date.now(); const bud = await mk({ retries: 10, budgetMs: 100, baseDelayMs: 80 }).quota().catch(x => x);
    ok('the retry budget bounds the total time', bud.code === 'unavailable' && Date.now() - t1 < 1500 && seen.length < 4);
    // validation before the network
    reset([]);
    ok('a bad sub, a bad project and a bad body fail before any request', (() => { try { mk().constructor; createDriveClient({ base, appId: 'portal', appSecret: SECRET }).forUser('x'); return false; } catch (e) { return e.code === 'bad_request'; } })() && (await mk().usage('Bad Project').catch(x => x)).code === 'bad_request' && (await mk().put('a string', { project: 'media', path: 'a', ref: 'r', tag: 'final' }).catch(x => x)).code === 'bad_request' && seen.length === 0);
    // the error text never carries the secret
    reset([{ status: 403, json: { error: 'not allowed', code: 'forbidden' } }]);
    const fe = await mk().quota().catch(x => x);
    ok('an error carries code, status and request id but never the secret', fe.status === 403 && !!fe.requestId && !(fe.message + fe.stack + JSON.stringify(fe)).includes(SECRET));
    const util = require('util');
    ok('inspecting the client shows no secret', !util.inspect(createDriveClient({ base, appId: 'portal', appSecret: SECRET })).includes(SECRET));
    // get streams the body and exposes the headers
    reset([{ status: 200, body: Buffer.from('payload'), headers: { 'x-sai-id': 'i1', 'x-sai-version': 'v1', 'x-sai-sha256': 'ab', 'x-sai-ref': 'r1', 'x-sai-tag': 'final', 'x-sai-scan': 'clean', 'content-type': 'audio/wav', 'x-sai-path': encodeURIComponent('A/é.wav') } }]);
    const gf = await mk().get('media', 'i1'); const ch = []; for await (const c of gf.stream) ch.push(c);
    ok('get: the body as a stream and the metadata from the headers', Buffer.concat(ch).toString() === 'payload' && gf.id === 'i1' && gf.version === 'v1' && gf.ref === 'r1' && gf.tag === 'final' && gf.scan === 'clean' && gf.contentType === 'audio/wav' && gf.path === 'A/é.wav');
    reset([{ status: 206, body: Buffer.from('pay'), headers: { 'content-range': 'bytes 0-2/7' } }]);
    const gr = await mk().getByRef('media', 'r/1', { range: 'bytes=0-2' });
    ok('getByRef sends the Range header and the encoded ref, and reports 206 + contentRange', seen[0].headers.range === 'bytes=0-2' && seen[0].url.endsWith('/by-ref/r%2F1') && gr.status === 206 && gr.contentRange === 'bytes 0-2/7' && (await gr.buffer()).toString() === 'pay');
  } catch (e) { fail++; console.log('CRASH', e && e.stack || e); }
  srv.close();
  console.log(`drive-client library: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
