'use strict';
/* _drive-client: write a person's generated files into their SAI Drive (the app API, manifests/sai-drive/APP-API.md).
 *
 * Zero dependencies, Node 18+ (global fetch). Copy this file into the app at deploy time the way _auth-client is copied (or pass your own `fetch`).
 *
 *   const { createDriveClient, DriveError } = require('./drive-client');
 *   const drive = createDriveClient({ base: 'http://sai-drive-api.sai-drive.svc', appId: 'portal', appSecret: process.env.DRIVE_APP_API_SECRET });
 *   const u = drive.forUser(sub);                                       // sub = the portal user id, u_ + 16 hex
 *   const f = await u.put(buffer, { project: 'media', path: 'Films/f1/clip-3.mp4', ref: 'film:f1:clip:3', tag: 'intermediate', sha256: true });
 *   const g = await u.getByRef('media', 'film:f1:clip:3');             // g.stream is a Node Readable
 *
 * RULES THE LIBRARY ENFORCES FOR YOU
 *  - Nothing is retried that could do harm twice. Retried (jittered exponential backoff, bounded by `retries` and `budgetMs`): GET / HEAD / list / usage / quota / stat,
 *    PUT by ref (it is idempotent: same ref + same bytes is a no-op) when the body can be re-sent (a Buffer, or a function returning a fresh stream), DELETE (a second 404 after a
 *    retry counts as done), and a dry-run prune. NEVER retried: PATCH, a real prune, a PUT whose body is a one-shot stream, and any 4xx other than 429 busy and 409 in_progress.
 *  - A body is streamed, never buffered by the library: pass a Readable (with `size`), a Buffer, or a function () => Readable.
 *  - Drive being down is `DriveError.code === 'unavailable'` (connection failure, timeout, 5xx). Treat it as "try later" and KEEP what you generated until a put succeeds.
 *  - The secret is never logged, never put in an error, and hidden from console.log / util.inspect of the client.
 * Errors: DriveError { code, status, requestId, detail, retryAfterS }. codes: unavailable, busy, in_progress, quota, app_cap, file_too_large, not_found, forbidden, frozen, gone,
 * project_in_bin, conflict (detail: path_conflict | ref_exists | ref_conflict | tag_conflict | exists | not_empty | not_intermediate | tag_locked | cycle | project_nested ...),
 * infected, hash_mismatch, bad_range, bad_request (detail: bad_path | bad_ref | bad_tag | bad_hash | bad_sub | bad_size | no_criteria ...), length_required, internal. */
const crypto = require('crypto');
const { Readable } = require('stream');

class DriveError extends Error {
  constructor(code, message, o = {}) {
    super(message);
    this.name = 'DriveError'; this.code = code; this.status = o.status || 0; this.requestId = o.requestId || null; this.detail = o.detail || null; this.retryAfterS = o.retryAfterS || null; this.extra = o.extra || null;
  }
  get retryable() { return this.code === 'unavailable' || this.code === 'busy' || this.code === 'in_progress'; }
}
/* the server's stable error codes -> the client's */
function classify(status, serverCode) {
  if (status >= 500) return { code: 'unavailable', detail: serverCode };
  const c = serverCode || '';
  if (status === 416) return { code: 'bad_range', detail: c };
  if (status === 429) return { code: 'busy', detail: c };
  if (status === 413) return { code: c === 'app_cap' ? 'app_cap' : c === 'file_too_large' ? 'file_too_large' : 'quota', detail: c };
  if (status === 404) return { code: 'not_found', detail: c };
  if (status === 451) return { code: 'infected', detail: c };
  if (status === 422) return { code: 'hash_mismatch', detail: c };
  if (status === 411) return { code: 'length_required', detail: c };
  if (status === 403) return { code: c === 'frozen' ? 'frozen' : c === 'gone' ? 'gone' : 'forbidden', detail: c };
  if (status === 409) return { code: c === 'in_progress' ? 'in_progress' : c === 'project_in_bin' ? 'project_in_bin' : 'conflict', detail: c };
  if (status === 400 || status === 415) return { code: 'bad_request', detail: c };
  return { code: 'internal', detail: c };
}
const SUB_RE = /^u_[a-f0-9]{16}$/;
const enc = encodeURIComponent;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function createDriveClient({ base, appId, appSecret, fetch: fetchImpl, timeoutMs = 30000, transferTimeoutMs = 10 * 60000, retries = 3, budgetMs = 30000, baseDelayMs = 200, sleep: sleepImpl, random = Math.random } = {}) {
  if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw new Error('drive-client: base must be the Drive API URL, e.g. http://sai-drive-api.sai-drive.svc');
  if (typeof appId !== 'string' || !appId) throw new Error('drive-client: appId is required');
  if (typeof appSecret !== 'string' || appSecret.length < 32) throw new Error('drive-client: appSecret is required (32+ characters, from a Secret)');
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('drive-client: needs Node 18+ (global fetch) or a fetch option');
  const root = base.replace(/\/+$/, '');
  const nap = sleepImpl || sleep;

  async function attempt(sub, method, path, { body, headers, timeout, json, stream, rid } = {}) {
    const h = { 'x-app-id': appId, 'x-app-secret': appSecret, 'x-sub': sub, 'x-request-id': rid, ...(headers || {}) };
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const init = { method, headers: h, redirect: 'error', signal: AbortSignal.timeout(timeout) };
    if (payload !== undefined) {
      if (payload instanceof Readable) { init.body = Readable.toWeb(payload); init.duplex = 'half'; } else init.body = payload;
    }
    let res;
    try { res = await f(root + path, init); }
    catch (e) { throw new DriveError('unavailable', 'could not reach Drive: ' + (e && (e.cause && e.cause.code || e.name || e.message) || 'error'), { detail: 'network', requestId: rid }); }
    if (res.status >= 200 && res.status < 300 || res.status === 206) return res;
    let j = null; try { j = await res.json(); } catch {}
    const k = classify(res.status, j && j.code);
    const ra = Number(res.headers.get('retry-after'));
    throw new DriveError(k.code, (j && j.error) || `Drive answered ${res.status}`, { status: res.status, requestId: (j && j.requestId) || res.headers.get('x-request-id') || rid, detail: k.detail, retryAfterS: Number.isFinite(ra) && ra > 0 ? ra : null, extra: j ? Object.fromEntries(Object.entries(j).filter(([k]) => !['error', 'code', 'requestId'].includes(k))) : null });
  }
  /* run with retries when `safe`; mk() builds the attempt each time (so a body can be re-created) */
  async function call(sub, method, path, o = {}) {
    if (!SUB_RE.test(String(sub))) throw new DriveError('bad_request', 'sub must be u_ and 16 hex characters', { detail: 'bad_sub' });
    const rid = o.rid || crypto.randomUUID();
    const t0 = Date.now();
    const max = o.safe ? retries : 0;
    for (let n = 0; ; n++) {
      try {
        const body = typeof o.body === 'function' ? o.body() : o.body;
        return await attempt(sub, method, path, { ...o, body, rid, timeout: o.timeout || timeoutMs });
      } catch (e) {
        const again = e instanceof DriveError && n < max && Date.now() - t0 < budgetMs && (e.code === 'unavailable' || e.code === 'busy' || e.code === 'in_progress');
        if (!again) throw e;
        if (o.state) o.state.retried = true;
        const wait = e.retryAfterS ? e.retryAfterS * 1000 : Math.min(5000, baseDelayMs * 2 ** n) * (0.5 + random() / 2);
        await nap(Math.min(wait, Math.max(0, budgetMs - (Date.now() - t0))));
      }
    }
  }
  const jsonOf = async res => res.json();
  const qs = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== false) p.set(k, v === true ? '1' : String(v)); const s = p.toString(); return s ? '?' + s : ''; };
  const proj = p => { if (typeof p !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p)) throw new DriveError('bad_request', 'project must be a project id', { detail: 'bad_project' }); return p; };

  function meta(res) {
    const h = n => res.headers.get(n);
    const len = Number(h('content-length'));
    return { path: h('x-sai-path') ? decodeURIComponent(h('x-sai-path')) : null, id: h('x-sai-id'), version: h('x-sai-version'), sha256: h('x-sai-sha256') || null, ref: h('x-sai-ref') || null, tag: h('x-sai-tag') || null, scan: h('x-sai-scan'), contentType: h('content-type'), size: Number.isFinite(len) ? len : null, contentRange: h('content-range') || null, status: res.status };
  }
  /* the body is read ONE way: `stream` (a Node Readable, never buffered) or `buffer()` (the whole thing in memory); whichever is used first wins */
  const fileOut = res => {
    const o = { ...meta(res), async buffer() { return Buffer.from(await res.arrayBuffer()); } };
    Object.defineProperty(o, 'stream', { enumerable: true, get() { return res.body ? Readable.fromWeb(res.body) : Readable.from([]); } });
    return o;
  };

  function forUser(sub) {
    if (!SUB_RE.test(String(sub))) throw new DriveError('bad_request', 'sub must be u_ and 16 hex characters', { detail: 'bad_sub' });
    const U = {
      sub,
      /* put(body, { project, path, ref, tag, sha256, size, contentType }): body = Buffer | Readable (needs size) | () => Readable (needs size; retried). sha256: a hex string, or true to compute it from a Buffer. */
      async put(body, o = {}) {
        const isBuf = Buffer.isBuffer(body) || body instanceof Uint8Array;
        const isFn = typeof body === 'function';
        if (!isBuf && !isFn && !(body instanceof Readable)) throw new DriveError('bad_request', 'body must be a Buffer, a Readable or a function returning one', { detail: 'bad_body' });
        const size = isBuf ? body.length : o.size;
        if (!Number.isInteger(size) || size < 0) throw new DriveError('bad_request', 'size is required for a stream', { detail: 'bad_size' });
        let sha = o.sha256;
        if (sha === true) { if (!isBuf) throw new DriveError('bad_request', 'sha256: true needs a Buffer; pass the hex digest for a stream', { detail: 'bad_hash' }); sha = crypto.createHash('sha256').update(body).digest('hex'); }
        const path = `/app/v1/projects/${proj(o.project)}/files` + qs({ path: o.path, ref: o.ref, tag: o.tag, sha256: sha });
        const headers = { 'content-length': String(size), 'content-type': o.contentType || 'application/octet-stream' };
        const canResend = isBuf || isFn;
        // a replay with a known digest costs nothing to ask first: no bytes are sent when Drive already holds exactly this
        if (sha && o.ref) {
          try { const st = await U.stat(o.project, { ref: o.ref }); if (st && st.sha256 === sha && st.path === o.path && st.tag === o.tag) return { ...pick(st), replayed: true }; }
          catch (e) { if (!(e instanceof DriveError)) throw e; }                 // not found, unavailable, anything: the PUT itself will say
        }
        const res = await call(sub, 'PUT', path, { body: isFn ? body : (isBuf ? Buffer.from(body.buffer, body.byteOffset, body.length) : body), headers, safe: canResend, timeout: transferTimeoutMs });
        return jsonOf(res);
      },
      /* get(project, id, { range, version }) / getByRef(project, ref, { range }) -> { id, version, sha256, ref, tag, scan, contentType, size, contentRange, status, stream, buffer() } */
      async get(project, id, o = {}) { return fileOut(await call(sub, 'GET', `/app/v1/projects/${proj(project)}/files/${enc(id)}${qs({ version: o.version })}`, { headers: o.range ? { range: o.range } : {}, safe: true, timeout: transferTimeoutMs })); },
      async getByRef(project, ref, o = {}) { return fileOut(await call(sub, 'GET', `/app/v1/projects/${proj(project)}/by-ref/${enc(ref)}`, { headers: o.range ? { range: o.range } : {}, safe: true, timeout: transferTimeoutMs })); },
      /* stat(project, { id | ref | path }) -> the node's metadata (id, version, size, sha256, path, ref, tag, scan, ...). A 404 is a DriveError not_found; an infected file is `infected` (by id or ref). */
      async stat(project, by = {}) {
        if (by.path !== undefined) return jsonOf(await call(sub, 'GET', `/app/v1/projects/${proj(project)}/files${qs({ path: by.path })}`, { safe: true }));
        const base_ = by.ref !== undefined ? `/app/v1/projects/${proj(project)}/by-ref/${enc(by.ref)}` : `/app/v1/projects/${proj(project)}/files/${enc(by.id)}`;
        return jsonOf(await call(sub, 'GET', base_ + qs({ stat: true }), { safe: true }));
      },
      /* list(project, { path, tag, recursive, pageSize }) -> async iterator of nodes (follows the cursor) */
      list(project, o = {}) {
        const self = this;
        return { async *[Symbol.asyncIterator]() {
          let after;
          do {
            const page = await jsonOf(await call(sub, 'GET', `/app/v1/projects/${proj(project)}/list` + qs({ path: o.path, tag: o.tag, recursive: o.recursive, limit: o.pageSize, after }), { safe: true }));
            for (const it of page.items) yield it;
            after = page.next;
          } while (after);
        } };
      },
      async patch(project, id, changes) { return jsonOf(await call(sub, 'PATCH', `/app/v1/projects/${proj(project)}/files/${enc(id)}`, { json: changes })); },
      /* remove(project, id, { permanent, recursive, bin }): an UNTOUCHED intermediate file (written by this app, not edited, renamed, moved or starred by the person) is deleted for good
         by default ({ bin: true } sends it to the Bin instead); every other file goes to the Bin and { permanent: true } on it is `conflict/not_intermediate`. A file this app put in the Bin and nobody
         touched can still be removed for good by id. Result: { ok, mode: 'permanent' | 'bin', freedBytes?, ... } */
      async remove(project, id, o = {}) {
        const path = `/app/v1/projects/${proj(project)}/files/${enc(id)}` + qs({ permanent: o.permanent, recursive: o.recursive, bin: o.bin });
        const state = { retried: false };
        try { return await jsonOf(await call(sub, 'DELETE', path, { safe: true, state })); }
        catch (e) { if (e instanceof DriveError && e.code === 'not_found' && state.retried) return { ok: true, alreadyGone: true }; throw e; }        // the first try did land, its answer was lost
      },
      async usage(project) { return jsonOf(await call(sub, 'GET', `/app/v1/projects/${proj(project)}/usage`, { safe: true })); },
      /* prune(project, { olderThanSeconds (<= 3e9), refPrefix, keepNewestBytes, targetFreeBytes, dryRun = true }) -> { deleted, freedBytes, remaining, remainingBytes, skippedUserWork, dryRun, more }; touched files are skipped, never deleted */
      async prune(project, o = {}) {
        const dryRun = o.dryRun === undefined ? true : o.dryRun;
        return jsonOf(await call(sub, 'POST', `/app/v1/projects/${proj(project)}/prune`, { json: { tag: 'intermediate', ...o, dryRun }, safe: dryRun === true }));
      },
      async quota() { return jsonOf(await call(sub, 'GET', '/app/v1/quota', { safe: true })); },
    };
    return U;
  }
  const pick = n => ({ id: n.id, version: n.version, size: n.size, sha256: n.sha256, path: n.path, ref: n.ref, tag: n.tag, scan: n.scan });
  const client = { forUser, appId };
  Object.defineProperty(client, Symbol.for('nodejs.util.inspect.custom'), { value: () => `DriveClient { base: '${root}', appId: '${appId}' }` });
  Object.defineProperty(client, 'toJSON', { value: () => ({ base: root, appId }) });
  return client;
}
module.exports = { createDriveClient, DriveError, classify };
