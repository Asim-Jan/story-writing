// A FAKE SAI Drive app API over HTTP (just enough /app/v1 for the vendored _drive-client): the
// server under test is a separate process, so it is pointed here with DRIVE_APP_API_URL.
// Shared by drive.test.js and regress.test.js (Drive is the only media store since 2.23.79).
import http from 'http';
import crypto from 'crypto';

export const FAKE_DRIVE_SECRET = 'drive-test-secret-0123456789abcdef0123456789abcdef';

/* ── the fake Drive app API: just enough /app/v1 for the client ───────────────────────────── */

export function fakeDrive({ failUploads = false, failGets = false, failDeletes = false, host = '127.0.0.1', port = 0, log = false } = {}) {
  // mutable: a test can take Drive down (and bring it back) while the server keeps running
  // closedSubs: accounts Drive has closed (pending_erase / erased): every call naming them is 403 gone
  const mode = { failUploads, failGets, failDeletes, closedSubs: new Set() };
  const objects = new Map();   // ref -> { bytes, contentType, path, node }
  const detached = new Map();  // node -> rec: a file whose ref was let go (the person moved it) but is still in the project
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader('connection', 'close');   // never reuse a socket: a half-consumed stream must not leak its bytes into the next response
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (log) console.log(`[fake-drive] ${req.method} ${decodeURIComponent(p)} sub=${req.headers['x-sub'] || '-'}`);
      requests.push({ method: req.method, path: p, sub: req.headers['x-sub'], app: req.headers['x-app-id'], stat: url.searchParams.has('stat'), range: req.headers.range || null });
      if (req.headers['x-app-id'] !== 'stories' || req.headers['x-app-secret'] !== FAKE_DRIVE_SECRET) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'forbidden', code: 'forbidden' }));
      }
      if (mode.closedSubs.has(req.headers['x-sub'])) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'gone', code: 'gone' }));   // the real API's error shape: { error, code, requestId }
      }
      if (p === '/app/v1/quota' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ used: 0, quota: 1000, cap: 900 }));
      }
      let m = /^\/app\/v1\/projects\/([^/]+)\/by-ref\/(.+)$/.exec(p);
      if (m && (req.method === 'GET' || req.method === 'HEAD')) {
        const ref = decodeURIComponent(m[2]);
        const o = objects.get(ref);
        if (url.searchParams.get('stat')) {
          // a stat is a JSON DTO, never the bytes (the real Drive answers the DTO; the client re-stats after a put)
          if (!o) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not_found', code: 'not_found' })); }
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ id: o.node, version: 1, size: o.bytes.length, ref, tag: 'source', path: o.path }));
        }
        if (mode.failGets) { res.writeHead(503); return res.end(); }
        if (!o) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not_found', code: 'not_found' })); }
        const range = req.headers.range;
        let start = 0, end = o.bytes.length - 1, status = 200;
        if (range) {
          const mm = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (mm) {
            status = 206;
            if (mm[1] !== '') start = Number(mm[1]);
            if (mm[2] !== '') end = Math.min(Number(mm[2]), o.bytes.length - 1);
            if (start >= o.bytes.length || start > end) {   // the real Drive's 416
              res.writeHead(416, { 'content-type': 'application/json', 'content-range': `bytes */${o.bytes.length}` });
              return res.end(JSON.stringify({ error: 'bad_range', code: 'bad_range' }));
            }
            res.setHeader('Content-Range', `bytes ${start}-${end}/${o.bytes.length}`);
          }
        }
        res.writeHead(status, { 'content-type': o.contentType, 'accept-ranges': 'bytes' });
        return res.end(o.bytes.subarray(start, end + 1));
      }
      m = /^\/app\/v1\/projects\/([^/]+)\/files$/.exec(p);
      if (m && req.method === 'PUT') {
        if (mode.failUploads) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'unavailable', code: 'unavailable' })); }
        const ref = url.searchParams.get('ref');
        const prior = objects.get(ref);
        if (prior && prior.bytes.equals(body)) {
          // the REAL Drive's idempotency: the same ref + the same bytes is a no-op (the same node)
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ id: prior.node, version: 1, size: prior.bytes.length, ref, path: prior.path }));
        }
        const node = `n_${crypto.randomBytes(6).toString('hex')}`;
        const rec = { bytes: body, contentType: req.headers['content-type'] || 'application/octet-stream', path: url.searchParams.get('path'), node };
        objects.set(ref, rec);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: node, version: 1, size: body.length, ref, path: rec.path }));
      }
      m = /^\/app\/v1\/projects\/([^/]+)\/files\/([^/]+)$/.exec(p);
      if (m && req.method === 'GET' && url.searchParams.get('stat')) {
        const id = decodeURIComponent(m[2]);
        const o = [...objects.values()].find(x => x.node === id) || detached.get(id);
        if (!o) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not_found', code: 'not_found' })); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id, version: 1, size: o.bytes.length, ref: null, tag: 'source', path: o.path }));
      }
      if (m && req.method === 'DELETE') {
        if (mode.failDeletes) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'unavailable', code: 'unavailable' })); }
        const id = decodeURIComponent(m[2]);
        // Stories writes `source` files: the app API sends those to the Bin, never deletes them for good
        if (detached.delete(id)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, mode: 'bin' })); }
        for (const [ref, o] of objects) if (o.node === id) { objects.delete(ref); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, mode: 'bin' })); }
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'not_found', code: 'not_found' }));
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', code: 'not_found' }));
      } catch (e) { console.log(`    [fake-drive] HANDLER ERROR: ${e.stack || e.message}`); try { res.destroy(); } catch {} }
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.address().port}`,
    objects,
    detached,
    requests,
    mode,
    close: () => new Promise((r) => server.close(r)),
  })));
}

