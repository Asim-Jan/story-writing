'use strict';
/* fake.js: an IN-MEMORY SAI Drive for the tests of apps that use _drive-client. It implements the same API as the real app API (manifests/sai-drive/APP-API.md)
 * and answers with the same DriveError codes; tests/conformance.js runs one scenario suite against this fake AND against the real Drive code, so the two cannot drift.
 *
 *   const { createFakeDrive } = require('./fake');
 *   const fake = createFakeDrive();                         // default registry: app "portal" owns media + assistant; app "stories" owns story-writing (small cap)
 *   const drive = fake.client({ appId: 'portal' });         // same shape as createDriveClient(...): drive.forUser(sub).put / get / ...
 *   fake.admin.setState(sub, 'frozen'); fake.admin.failNext(2);   // make Drive misbehave
 *
 * What it models: apps and their secrets, project ownership, tags, refs and idempotency, versions, paths and names, the app cap, the person's quota, plan file
 * limits, frozen / closed accounts, infected files, the Bin, listing (folders first, keyset pages, recursive), patch, delete rules, usage, prune, Range.
 * What it does not: timing, scanning (set it yourself), object storage, the network (no retries happen here: failNext throws DriveError('unavailable') once per call). */
const crypto = require('crypto');
const { Readable } = require('stream');
const { DriveError, classify } = require('./index.cjs');

const TAGS = ['final', 'intermediate', 'source'];
const REF_RE = /^[A-Za-z0-9._:~@+=-]{1,200}$/, SUB_RE = /^u_[a-f0-9]{16}$/, SHA_RE = /^[a-f0-9]{64}$/, PROJECT_IDS = ['studio', 'story-writing', 'assistant', 'docs', 'media', 'workspaces'];
const GiB = 1024 ** 3, KiB = 1024;
const DEFAULT_APPS = { version: 1, apps: [
  { id: 'portal', name: 'SAI Cloud portal', projects: ['media', 'assistant'], secretEnv: 'APPS_SECRET_PORTAL', trusted: true, capFraction: 0.9, maxFileBytes: 5 * 1024 * KiB, allowTags: TAGS, namespace: 'sai-portal', pod: 'sai-portal' },
  { id: 'stories', name: 'Stories', projects: ['story-writing'], secretEnv: 'APPS_SECRET_STORIES', trusted: true, capBytes: 600 * KiB, maxFileBytes: 300 * KiB, allowTags: TAGS, namespace: 'story-writing', pod: 'story-writing-backend' },
] };
const E = (status, serverCode, message, extra) => { const k = classify(status, serverCode); return new DriveError(k.code, message, { status, detail: k.detail, ...(extra || {}) }); };
const bad = (code, m) => E(400, code, m);

/* path rules, the same as the server's (apppath.js) */
function segment(input) {
  if (typeof input !== 'string') throw bad('bad_path', 'a name must be a string');
  const nfc = input.normalize('NFC'), name = nfc.trim();
  if (!name) throw bad('bad_path', 'a name cannot be empty');
  if (Buffer.byteLength(name, 'utf8') > 255) throw bad('bad_path', 'a name is at most 255 bytes');
  if (name === '.' || name === '..') throw bad('bad_path', 'that name is reserved');
  if (/[\/\\]/.test(name)) throw bad('bad_path', 'a name cannot contain / or \\');
  if (/[\u0000-\u001F\u007F-\u009F]/.test(name)) throw bad('bad_path', 'a name cannot contain control characters');
  if (/[‪-‮⁦-⁩‎‏]/.test(name)) throw bad('bad_path', 'a name cannot contain direction-override characters');
  if (/[. ]$/.test(name)) throw bad('bad_path', 'a name cannot end with a dot or a space');
  if (/�/.test(name)) throw bad('bad_path', 'a name must be valid text');
  if (name !== nfc) throw bad('bad_path', 'a name cannot start or end with a space');
  return name;
}
function parsePath(input, allowEmpty) {
  if (input === undefined || input === null || input === '') { if (allowEmpty) return []; throw bad('bad_path', 'a path is required'); }
  if (typeof input !== 'string') throw bad('bad_path', 'a path must be a string');
  const nfc = input.normalize('NFC');
  if (Buffer.byteLength(nfc, 'utf8') > 1024) throw bad('bad_path', 'a path is at most 1024 bytes');
  if (/\\/.test(nfc)) throw bad('bad_path', 'a path cannot contain a backslash');
  const segs = nfc.split('/');
  if (segs.length > 24) throw bad('bad_path', 'a path has at most 24 levels');
  return segs.map(s => { if (s === '') throw bad('bad_path', 'a path cannot have an empty part'); return segment(s); });
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const iso = n => new Date(n).toISOString();

function createFakeDrive({ apps = DEFAULT_APPS, secrets, defaultQuota = 25 * GiB, maxOpenUploads = 20 } = {}) {
  const registry = new Map(apps.apps.map(a => [a.id, a]));
  const secretOf = Object.assign({}, ...apps.apps.map(a => ({ [a.id]: 'fake-secret-for-' + a.id + '-' + 'x'.repeat(24) })), secrets || {});
  const accounts = new Map();
  const calls = [];
  let clock = Date.now(), seq = 0, failures = [];
  const now = () => (clock += 1);
  const A = sub => {
    let a = accounts.get(sub);
    if (!a) { a = { sub, state: 'active', quota: defaultQuota, plan: 'free', maxFile: null, nodes: new Map(), root: null }; a.root = mk(a, null, '', 'root'); accounts.set(sub, a); }
    return a;
  };
  function mk(a, parent, name, kind, extra) { const n = { id: crypto.randomUUID(), parent, name, kind, project: null, appProject: null, ref: null, tag: null, versions: [], trashed: false, created: now(), modified: now(), seq: ++seq, ...(extra || {}) }; a.nodes.set(n.id, n); return n; }
  const kids = (a, id) => [...a.nodes.values()].filter(n => n.parent === id);
  const bytesOfNode = n => n.versions.reduce((s, v) => s + v.size, 0);
  const used = a => [...a.nodes.values()].reduce((s, n) => s + bytesOfNode(n), 0);
  function projectNode(a, pid, create) {
    let p = [...a.nodes.values()].find(n => n.project === pid);
    if (!p && create) p = mk(a, a.root.id, 'SAI Apps/' + pid, 'folder', { project: pid });
    return p || null;
  }
  const ancestry = (a, n) => { const out = []; for (let c = n; c; c = c.parent ? a.nodes.get(c.parent) : null) out.push(c); return out; };
  /* in scope: a live file/folder strictly under the live project folder, every link live */
  function scoped(a, p, id, kinds = ['file', 'folder'], bin = false) {
    const n = a.nodes.get(id);
    if (!n || !kinds.includes(n.kind) || (bin ? !n.trashed : n.trashed)) return null;
    const ch = ancestry(a, n); const at = ch.findIndex(c => c.id === p.id);
    if (at < 1 || (!bin && ch.slice(0, at).some(c => c.trashed))) return null;
    return n;
  }
  /* purely the app's output: intermediate under THIS project, every version written by this app, not starred, still under the name and folder the app gave it; in the Bin only if the APP put it there */
  const pristine = (a, n, pid, appId) => n.kind === 'file' && n.tag === 'intermediate' && n.appProject === pid && n.appName !== null && n.appName !== undefined && n.name === n.appName && n.parent === n.appParent && !n.starred
    && n.versions.every(v => v.by === appId) && (!n.trashed || (a.nodes.get(n.trashedVia || n.id) || {}).binnedBy === appId);
  const pathOf = (a, p, n) => ancestry(a, n).slice(0, ancestry(a, n).findIndex(c => c.id === p.id)).map(c => c.name).reverse().join('/');
  const cur = n => n.versions[n.versions.length - 1];
  const mine = (n, pid) => n.appProject === pid;
  const dto = (a, p, n, pid) => ({ id: n.id, kind: n.kind, name: n.name, path: pathOf(a, p, n), size: n.kind === 'file' ? cur(n).size : null, sha256: n.kind === 'file' ? cur(n).content : null, version: n.kind === 'file' ? cur(n).id : null,
    mime: n.kind === 'file' ? cur(n).mime : null, ref: mine(n, pid) ? n.ref : null, tag: mine(n, pid) ? n.tag : null, scan: n.kind === 'file' ? cur(n).scan : null, created: iso(n.created), modified: iso(n.modified) });
  function subtree(a, id, live) { const out = []; const walk = pid => { for (const c of kids(a, pid)) { if (live && c.trashed) continue; out.push(c); walk(c.id); } }; walk(id); return out; }
  function walkDown(a, p, segs, create) {
    let c = p;
    for (const s of segs) {
      if (c.kind !== 'folder') { if (create) throw E(409, 'path_conflict', 'a file is in the way of that path'); return null; }
      let n = kids(a, c.id).find(k => !k.trashed && k.name.toLowerCase() === s.toLowerCase());
      if (!n) { if (!create) return null; n = mk(a, c.id, s, 'folder'); }
      c = n;
    }
    return c;
  }
  const capOf = (app, a) => (app.capBytes != null ? app.capBytes : Math.floor(app.capFraction * a.quota));
  const heldBy = (a, p) => subtree(a, p.id, false).reduce((s, n) => s + bytesOfNode(n), 0);          // the Bin included: it is still the person's quota

  function enter(appId, appSecret, sub, project, { write = false, needProject = true } = {}) {
    calls.push({ appId, sub, op: 'enter' });
    const app = registry.get(appId);
    if (!app || appSecret !== secretOf[appId]) throw E(403, 'forbidden', 'not allowed');
    if (failures.length) { const f = failures[0]; if (!f.afterWrite) { f.n--; if (f.n <= 0) failures.shift(); throw f.err(); } }
    if (!SUB_RE.test(String(sub))) throw E(400, 'bad_sub', 'name the person with a valid X-Sub');
    if (needProject && !app.projects.includes(project)) throw E(403, 'forbidden_project', 'this app does not own that project');
    const a = A(sub);
    if (a.state === 'pending_erase' || a.state === 'erased') throw E(403, 'gone', 'this account is closed');
    if (write && a.state !== 'active') throw E(403, 'frozen', 'this account is read-only');
    return { app, a };
  }
  const afterWrite = () => { if (failures.length && failures[0].afterWrite) { const f = failures[0]; f.n--; if (f.n <= 0) failures.shift(); throw f.err(); } };
  const projOf = (a, pid, create) => { const p = projectNode(a, pid, create); if (p && p.trashed) throw E(409, 'project_in_bin', 'this project folder is in the Bin'); return p; };

  async function readAll(body) {
    if (typeof body === 'function') body = body();
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
    const ch = []; for await (const c of body) ch.push(Buffer.from(c)); return Buffer.concat(ch);
  }
  const claim = (a, p, pid, ref, except) => {   // the ref's holder lets go if it is not live in this project; a live one is a conflict
    const h = [...a.nodes.values()].find(n => n.appProject === pid && n.ref === ref);
    if (!h || h.id === except) return;
    if (!h.trashed && scoped(a, p, h.id)) throw E(409, 'ref_conflict', 'that reference is already used by another file');
    h.ref = null;
  };

  function forUser(appId, appSecret, sub) {
    const U = {
      sub,
      async put(body, o = {}) {
        const { app, a } = enter(appId, appSecret, sub, o.project, { write: true });
        const isBuf = Buffer.isBuffer(body) || body instanceof Uint8Array;
        if (!isBuf && typeof body !== 'function' && !(body instanceof Readable)) throw bad('bad_body', 'body must be a Buffer, a Readable or a function returning one');
        const data = await readAll(body);
        const size = isBuf ? data.length : o.size;
        if (!Number.isInteger(size) || size < 0) throw bad('bad_size', 'size is required for a stream');
        if (size !== data.length) throw bad('short_body', 'the body does not match the size');
        const segs = parsePath(o.path), name = segs[segs.length - 1], dirs = segs.slice(0, -1);
        if (typeof o.ref !== 'string' || !REF_RE.test(o.ref)) throw bad('bad_ref', 'bad ref');
        if (!TAGS.includes(o.tag) || !app.allowTags.includes(o.tag)) throw bad('bad_tag', 'bad tag');
        if (size > app.maxFileBytes) throw E(413, 'file_too_large', 'this app may not write files that large');
        let want = o.sha256 === true ? sha(data) : o.sha256;
        if (want !== undefined && !SHA_RE.test(want = String(want).toLowerCase())) throw bad('bad_hash', 'bad sha256');
        if (a.maxFile != null && size > a.maxFile) throw E(413, 'file_too_large', 'your plan allows files up to ' + a.maxFile + ' bytes');
        projOf(a, o.project, true);
        const p = projOf(a, o.project, true);
        const dir = walkDown(a, p, dirs, true);
        if (dir.kind !== 'folder') throw E(409, 'path_conflict', 'a file is in the way of that path');
        const existing = kids(a, dir.id).find(k => !k.trashed && k.name.toLowerCase() === name.toLowerCase());
        const holder = [...a.nodes.values()].find(n => n.appProject === o.project && n.ref === o.ref);
        let node = null;
        if (holder) {
          const inScope = !holder.trashed && !!scoped(a, p, holder.id);
          if (!inScope) holder.ref = null;
          else {
            if (holder.kind !== 'file') throw E(409, 'ref_conflict', 'that reference belongs to a folder');
            if (!existing || existing.id !== holder.id) throw E(409, 'ref_exists', 'that reference is already used for a file at another path');
            if ((holder.tag || null) !== o.tag) throw E(409, 'tag_conflict', 'that file has a different tag: change it with PATCH, not PUT');
            if (want !== undefined && cur(holder).content === want) return { ...pick(dto(a, p, holder, o.project)), replayed: true };
            node = holder;
          }
        }
        if (!node && existing) throw E(409, 'path_conflict', 'something with that name is already here');
        const dataSha = sha(data);
        if (want !== undefined && want !== dataSha) throw E(422, 'hash_mismatch', 'the body does not match the sha256 you sent');
        if (node && cur(node).content === dataSha) return { ...pick(dto(a, p, node, o.project)), replayed: true };
        if (heldBy(a, p) + size > capOf(app, a)) throw E(413, 'app_cap', "this app's space in your Drive is full");
        if (used(a) + size > a.quota) throw E(413, used(a) > a.quota ? 'over_quota' : 'quota', 'this would go over the storage limit');
        if (!node) { node = mk(a, dir.id, name, 'file', { appProject: o.project, ref: o.ref, tag: o.tag, appName: name, appParent: dir.id, starred: false }); }
        node.versions.push({ by: app.id, id: crypto.randomUUID(), size, bytes: data, content: dataSha, mime: o.contentType || 'application/octet-stream', scan: 'pending', created: now() });
        node.modified = now();
        afterWrite();
        return { ...pick(dto(a, p, node, o.project)), replayed: false };
      },
      async get(project, id, o = {}) { return read(project, n => n, id, o, 'id'); },
      async getByRef(project, ref, o = {}) { return read(project, null, ref, o, 'ref'); },
      async stat(project, by = {}) {
        const { a } = enter(appId, appSecret, sub, project, { needProject: true });
        const p = projOf(a, project, false); if (!p) throw E(404, 'not_found', 'not found');
        let n;
        if (by.path !== undefined) { const at = walkDown(a, p, parsePath(by.path)); n = at && scoped(a, p, at.id); }
        else if (by.ref !== undefined) { const h = REF_RE.test(by.ref) && [...a.nodes.values()].find(x => x.appProject === project && x.ref === by.ref); n = h && scoped(a, p, h.id); }
        else n = scoped(a, p, by.id);
        if (!n) throw E(404, 'not_found', 'not found');
        const d = dto(a, p, n, project);
        if (by.path === undefined && n.kind === 'file' && cur(n).scan === 'infected') throw E(451, 'infected', 'this file is blocked');
        return d;
      },
      list(project, o = {}) {
        return { async *[Symbol.asyncIterator]() {
          let after;
          do { const page = listPage(project, { ...o, after }); for (const it of page.items) yield it; after = page.next; } while (after);
        } };
      },
      async patch(project, id, ch) {
        const { app, a } = enter(appId, appSecret, sub, project, { write: true });
        const known = ['name', 'parentPath', 'tag', 'ref']; for (const k of Object.keys(ch || {})) if (!known.includes(k)) throw bad('bad_request', 'unknown field ' + k);
        if (!Object.keys(ch || {}).length) throw bad('bad_request', 'nothing to change');
        const name = ch.name === undefined ? undefined : segment(ch.name), segs = ch.parentPath === undefined ? undefined : parsePath(ch.parentPath, true);
        if (ch.tag !== undefined && (!TAGS.includes(ch.tag) || !app.allowTags.includes(ch.tag))) throw bad('bad_tag', 'bad tag');
        if (ch.ref !== undefined && ch.ref !== null && !REF_RE.test(ch.ref)) throw bad('bad_ref', 'bad ref');
        const p = projOf(a, project, false); if (!p) throw E(404, 'not_found', 'not found');
        const n = scoped(a, p, id); if (!n) throw E(404, 'not_found', 'not found');
        if ((ch.tag !== undefined || ch.ref !== undefined) && n.kind !== 'file') throw bad('bad_request', 'tag and ref belong to files');
        const S = {};
        if (name !== undefined) { S.name = name; if (n.appName !== null && n.appName !== undefined && n.name === n.appName) S.appName = name; }
        if (segs !== undefined) {
          const dest = walkDown(a, p, segs, true);
          if (dest.kind !== 'folder') throw E(409, 'path_conflict', 'a file is in the way of that path');
          if (n.kind === 'folder' && ancestry(a, dest).some(c => c.id === n.id)) throw bad('cycle', 'a folder cannot be moved into itself');
          S.parent = dest.id; if (n.appParent !== null && n.appParent !== undefined && n.parent === n.appParent) S.appParent = dest.id;
        }
        if (n.kind === 'file' && (ch.tag !== undefined || ch.ref !== undefined) && !mine(n, project)) { S.appProject = project; S.ref = null; S.tag = null; S.appName = null; S.appParent = null; }
        if (ch.tag !== undefined) { const was = mine(n, project) ? n.tag : null; if (ch.tag === 'intermediate' && was !== 'intermediate') throw E(409, 'tag_locked', 'a file can only be intermediate if it was written as intermediate'); S.tag = ch.tag; }
        if (ch.ref !== undefined) { if (ch.ref === null) S.ref = null; else { claim(a, p, project, ch.ref, n.id); S.ref = ch.ref; } }
        const target = S.parent || n.parent, newName = S.name || n.name;
        if (kids(a, target).some(k => k.id !== n.id && !k.trashed && k.name.toLowerCase() === newName.toLowerCase())) throw E(409, 'exists', 'something with that name is already there');
        Object.assign(n, S); n.modified = now();
        return dto(a, p, n, project);
      },
      async remove(project, id, o = {}) {
        const { app, a } = enter(appId, appSecret, sub, project, { write: true });
        if (o.permanent && o.bin) throw bad('bad_request', 'permanent and bin contradict each other');
        const p = projOf(a, project, false); if (!p) throw E(404, 'not_found', 'not found');
        let n = scoped(a, p, id), binned = false;
        if (!n) { n = scoped(a, p, id, ['file'], true); if (!n || !pristine(a, n, project, app.id)) throw E(404, 'not_found', 'not found'); binned = true; }
        const forGood = (nodes, files) => { const freed = files.reduce((x, f) => x + bytesOfNode(f), 0); for (const g of nodes) a.nodes.delete(g.id); return { ok: true, mode: 'permanent', id: n.id, deleted: nodes.length, files: files.length, freedBytes: freed }; };
        if (binned) return o.bin ? { ok: true, mode: 'bin', id: n.id, alreadyInBin: true } : forGood([n], [n]);
        if (n.kind === 'file') {
          const ok = pristine(a, n, project, app.id);
          if (o.permanent && !ok) throw E(409, 'not_intermediate', 'only an intermediate file the app wrote and nobody has changed can be deleted for good', { extra: { blocking: 1 } });
          if (ok && !o.bin) return forGood([n], [n]);
        } else {
          const live = kids(a, n.id).filter(k => !k.trashed);
          if (live.length && !o.recursive) throw E(409, 'not_empty', 'that folder is not empty', { extra: { items: live.length } });
          if (o.permanent) {
            const sub_ = subtree(a, n.id, false), files = sub_.filter(c => c.kind === 'file');
            const blocking = files.filter(f => !pristine(a, f, project, app.id)).length;
            if (blocking) throw E(409, 'not_intermediate', 'some files under that folder are not intermediate files nobody has changed', { extra: { blocking } });
            return forGood([n, ...sub_], files);
          }
        }
        n.trashed = true; n.binnedBy = app.id; n.modified = now();
        for (const c of subtree(a, n.id, true)) { c.trashed = true; c.trashedVia = n.id; }
        return { ok: true, mode: 'bin', id: n.id };
      },
      async usage(project) {
        const { app, a } = enter(appId, appSecret, sub, project);
        const p = projOf(a, project, false);
        const z = () => ({ files: 0, versions: 0, bytes: 0 }); const mkT = () => ({ final: z(), intermediate: z(), source: z(), untagged: z() });
        const byTag = mkT(), binTag = mkT();
        if (p) for (const n of subtree(a, p.id, false)) if (n.kind === 'file') { const k = mine(n, project) && n.tag ? n.tag : 'untagged'; const T_ = n.trashed ? binTag : byTag; T_[k].files++; T_[k].versions += n.versions.length; T_[k].bytes += bytesOfNode(n); }
        const sum = t => Object.values(t).reduce((s, x) => ({ files: s.files + x.files, versions: s.versions + x.versions, bytes: s.bytes + x.bytes }), z());
        const total = sum(byTag), binTotal = sum(binTag);
        const cap = capOf(app, a), u = used(a), cu = total.bytes + binTotal.bytes;
        return { project, exists: !!p, byTag, total, bin: { byTag: binTag, total: binTotal }, inFlightBytes: 0, cap: { bytes: cap, used: cu, free: Math.max(0, cap - cu) }, quota: { used: u, reserved: 0, total: a.quota, plan: a.plan }, overQuota: u > a.quota };
      },
      async prune(project, o = {}) {
        const dryRun = o.dryRun === undefined ? true : o.dryRun;
        if (typeof dryRun !== 'boolean') throw bad('bad_request', 'dryRun must be true or false');
        const { app, a } = enter(appId, appSecret, sub, project, { write: !dryRun });
        const crit = ['olderThanSeconds', 'refPrefix', 'keepNewestBytes', 'targetFreeBytes'].filter(k => o[k] !== undefined);
        if (!crit.length) throw bad('no_criteria', 'say what to prune');
        if (o.keepNewestBytes !== undefined && o.targetFreeBytes !== undefined) throw bad('bad_request', 'not both');
        for (const k of ['olderThanSeconds', 'keepNewestBytes', 'targetFreeBytes']) if (o[k] !== undefined && (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > (k === 'olderThanSeconds' ? 3e9 : 1e15))) throw bad('bad_request', k + ' is out of range');
        if (o.refPrefix !== undefined && !REF_RE.test(o.refPrefix)) throw bad('bad_ref', 'bad refPrefix');
        if (o.tag !== undefined && o.tag !== 'intermediate') throw bad('bad_tag', 'only intermediate files can be pruned');
        const p = projOf(a, project, false);
        if (!p) return { deleted: 0, freedBytes: 0, remaining: 0, remainingBytes: 0, skippedUserWork: 0, dryRun, more: false };
        const all = subtree(a, p.id, false).filter(n => n.kind === 'file' && n.tag === 'intermediate' && n.appProject === project);
        const cutoff = o.olderThanSeconds !== undefined ? now() - o.olderThanSeconds * 1000 : null;
        const matched = all.filter(n => (cutoff === null || n.modified < cutoff) && (o.refPrefix === undefined || (n.ref || '').startsWith(o.refPrefix)));
        const skipped = matched.filter(n => !pristine(a, n, project, app.id)).length;
        const cands = matched.filter(n => pristine(a, n, project, app.id)).sort((x, y) => x.modified - y.modified || (x.id < y.id ? -1 : 1));
        const totalBytes = cands.reduce((s, n) => s + bytesOfNode(n), 0);
        let goal = Infinity; if (o.targetFreeBytes !== undefined) goal = o.targetFreeBytes; if (o.keepNewestBytes !== undefined) goal = Math.max(0, totalBytes - o.keepNewestBytes);
        const pick_ = []; let freed = 0;
        if (goal !== 0) for (const c of cands) { if (freed >= goal || pick_.length >= 500) break; pick_.push(c); freed += bytesOfNode(c); }
        const more = freed < goal && cands.length > pick_.length;
        if (!dryRun) for (const c of pick_) a.nodes.delete(c.id);
        const allBytes = all.reduce((s, n) => s + bytesOfNode(n), 0);
        return { deleted: pick_.length, freedBytes: freed, remaining: all.length - pick_.length, remainingBytes: Math.max(0, allBytes - freed), skippedUserWork: skipped, dryRun, more };
      },
      async quota() {
        const { a } = enter(appId, appSecret, sub, null, { needProject: false });
        const u = used(a);
        return { used: u, reserved: 0, quota: a.quota, plan: a.plan, state: a.state, maxFileBytes: a.maxFile, over: u > a.quota, free: Math.max(0, a.quota - u) };
      },
    };
    function pick(d) { return { id: d.id, version: d.version, size: d.size, sha256: d.sha256, path: d.path, ref: d.ref, tag: d.tag, scan: d.scan }; }
    function listPage(project, o) {
      const { a } = enter(appId, appSecret, sub, project);
      const segs = parsePath(o.path, true);
      if (o.tag !== undefined && !TAGS.includes(o.tag)) throw bad('bad_tag', 'bad tag');
      const lim = Math.min(500, Math.max(1, Number.isInteger(o.pageSize) ? o.pageSize : 200));
      const p = projOf(a, project, false);
      if (!p) return { items: [], next: null };
      const at = segs.length ? walkDown(a, p, segs) : p;
      if (!at || at.kind !== 'folder') throw E(404, 'not_found', 'not found');
      const base = segs.join('/');
      let cur_ = null; if (o.after) { try { cur_ = JSON.parse(Buffer.from(o.after, 'base64url').toString()); } catch { throw bad('bad_cursor', 'bad cursor'); } }
      let rows;
      if (o.recursive) {
        rows = subtree(a, at.id, true).filter(n => n.kind === 'file' && (o.tag === undefined || (n.tag === o.tag && n.appProject === project))).sort((x, y) => x.modified - y.modified || (x.id < y.id ? -1 : 1));
        if (cur_) rows = rows.filter(n => n.modified > cur_.m || (n.modified === cur_.m && n.id > cur_.i));
        const page = rows.slice(0, lim);
        return { items: page.map(n => dto(a, p, n, project)), next: rows.length > lim ? Buffer.from(JSON.stringify({ m: page[page.length - 1].modified, i: page[page.length - 1].id })).toString('base64url') : null };
      }
      const rank = n => (n.kind === 'folder' ? 0 : 1);
      rows = kids(a, at.id).filter(n => !n.trashed && (o.tag === undefined || (n.kind === 'file' && n.tag === o.tag && n.appProject === project)))
        .sort((x, y) => rank(x) - rank(y) || (x.name.toLowerCase() < y.name.toLowerCase() ? -1 : x.name.toLowerCase() > y.name.toLowerCase() ? 1 : x.id < y.id ? -1 : 1));
      if (cur_) rows = rows.filter(n => rank(n) > cur_.k || (rank(n) === cur_.k && (n.name.toLowerCase() > cur_.n || (n.name.toLowerCase() === cur_.n && n.id > cur_.i))));
      const page = rows.slice(0, lim);
      return { items: page.map(n => dto(a, p, n, project)), next: rows.length > lim ? Buffer.from(JSON.stringify({ k: rank(page[page.length - 1]), n: page[page.length - 1].name.toLowerCase(), i: page[page.length - 1].id })).toString('base64url') : null };
    }
    function read(project, _x, key, o, by) {
      const { a } = enter(appId, appSecret, sub, project);
      const p = projOf(a, project, false); if (!p) throw E(404, 'not_found', 'not found');
      let n;
      if (by === 'ref') { const h = REF_RE.test(key) && [...a.nodes.values()].find(x => x.appProject === project && x.ref === key); n = h && scoped(a, p, h.id, ['file']); }
      else n = scoped(a, p, key, ['file']);
      if (!n) throw E(404, 'not_found', 'not found');
      const v = o.version ? n.versions.find(x => x.id === o.version) : cur(n);
      if (!v) throw E(404, 'not_found', 'not found');
      if (v.scan === 'infected') throw E(451, 'infected', 'this file is blocked: a malware scan found a virus in it');
      let a0 = 0, b0 = v.size - 1, status = 200, contentRange = null;
      if (o.range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(o.range).trim());
        let ok = !!m && !(m[1] === '' && m[2] === '');
        if (ok) { if (m[1] === '') { const k = +m[2]; if (!k) ok = false; else { a0 = Math.max(0, v.size - k); b0 = v.size - 1; } } else { a0 = +m[1]; b0 = m[2] === '' ? v.size - 1 : Math.min(+m[2], v.size - 1); } if (a0 > b0 || a0 >= v.size) ok = false; }
        if (!ok) throw new DriveError('bad_range', 'range not satisfiable', { status: 416 });
        status = 206; contentRange = `bytes ${a0}-${b0}/${v.size}`;
      }
      const slice = v.size === 0 ? Buffer.alloc(0) : v.bytes.subarray(a0, b0 + 1);
      return Promise.resolve({ path: pathOf(a, p, n), id: n.id, version: v.id, sha256: v.content, ref: mine(n, project) ? n.ref : null, tag: mine(n, project) ? n.tag : null, scan: v.scan, contentType: v.mime, size: slice.length, contentRange, status,
        stream: Readable.from(slice.length ? [slice] : []), async buffer() { return Buffer.from(slice); } });
    }
    return U;
  }

  const fake = {
    secrets: secretOf,
    /* a client with the same shape as createDriveClient(): { forUser(sub) } */
    client({ appId = 'portal', appSecret } = {}) {
      const secret = appSecret === undefined ? secretOf[appId] : appSecret;
      return { appId, forUser(sub) { if (!SUB_RE.test(String(sub))) throw new DriveError('bad_request', 'sub must be u_ and 16 hex characters', { detail: 'bad_sub' }); return forUser(appId, secret, sub); } };
    },
    admin: {
      setState(sub, st) { A(sub).state = st; },
      setQuota(sub, bytes) { A(sub).quota = bytes; },
      setMaxFile(sub, bytes) { A(sub).maxFile = bytes; },
      setScan(sub, id, st) { const n = A(sub).nodes.get(id); for (const v of n.versions) v.scan = st; },
      markInfected(sub, id) { this.setScan(sub, id, 'infected'); },
      /* the person, in the Drive web app */
      userTrash(sub, id) { const a = A(sub), n = a.nodes.get(id); n.trashed = true; n.binnedBy = 'user'; for (const c of subtree(a, id, true)) { c.trashed = true; c.trashedVia = id; } },
      userNewVersion(sub, id, buf) { const n = A(sub).nodes.get(id); n.versions.push({ by: 'user', id: crypto.randomUUID(), size: buf.length, bytes: buf, content: sha(buf), mime: 'application/octet-stream', scan: 'clean', created: now() }); n.modified = now(); },
      userStar(sub, id, on = true) { A(sub).nodes.get(id).starred = on; },
      userRename(sub, id, name) { A(sub).nodes.get(id).name = name; },
      userRestore(sub, id) { const a = A(sub), n = a.nodes.get(id); n.trashed = false; delete n.trashedVia; delete n.binnedBy; for (const c of subtree(a, id, false)) if (c.trashedVia === id) { c.trashed = false; delete c.trashedVia; } },
      userMoveOut(sub, id) { const a = A(sub); a.nodes.get(id).parent = a.root.id; },
      userAddFile(sub, project, relPath, buf) { const a = A(sub), p = projectNode(a, project, true); const segs = relPath.split('/'); const dir = walkDown(a, p, segs.slice(0, -1), true); const n = mk(a, dir.id, segs[segs.length - 1], 'file'); n.versions.push({ by: 'user', id: crypto.randomUUID(), size: buf.length, bytes: buf, content: sha(buf), mime: 'application/octet-stream', scan: 'clean', created: now() }); return n.id; },
      userTrashProject(sub, project) { const a = A(sub); projectNode(a, project, true).trashed = true; },
      /* make everything in the project look `seconds` older (for olderThanSeconds) */
      age(sub, seconds, ids) { const set = ids === undefined ? null : new Set([].concat(ids)); for (const n of A(sub).nodes.values()) if (!set || set.has(n.id)) n.modified -= seconds * 1000; },
      binIds(sub) { return [...A(sub).nodes.values()].filter(n => n.trashed && !n.trashedVia).map(n => n.id); },
      has(sub, id) { return A(sub).nodes.has(id); },
      usedBytes(sub) { return used(A(sub)); },
      /* the next n calls fail with DriveError('unavailable') (afterWrite: a put lands, then the answer is lost) */
      failNext(n = 1, { afterWrite = false, status = 503 } = {}) { failures.push({ n, afterWrite, err: () => E(status, 'unavailable', 'fake outage') }); },
      clearFailures() { failures = []; },
    },
    calls,
  };
  return fake;
}
module.exports = { createFakeDrive, DEFAULT_APPS };
