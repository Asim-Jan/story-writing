'use strict';
/* The CONFORMANCE suite: one set of scenarios that is run twice, against fake.js (tests/fake.test.js) and against the REAL Drive app code with the REAL client over HTTP
 * (manifests/sai-drive/app/tests/appclient.test.js). If the two ever answer differently, one of those suites fails, so a consumer's tests against the fake mean something.
 *
 * adapter = {
 *   client(appId, appSecret?)   -> a createDriveClient-shaped object ({ forUser(sub) })
 *   admin: { setState(sub, state), setQuota(sub, bytes), setMaxFile(sub, bytes|null), markInfected(sub, id), userTrash(sub, id), userMoveOut(sub, id),
 *            userAddFile(sub, project, relPath, buffer) -> id, userTrashProject(sub, project), age(sub, seconds), restore(sub, id) }
 * } */
const crypto = require('crypto');
const { DriveError } = require('../index.cjs');

const KiB = 1024;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const rnd = n => crypto.randomBytes(n);

async function run(adapter, ok) {
  let n = 0;
  const newSub = () => 'u_' + (0xc0de00000000 + (++n) * 7919 + Math.floor(Math.random() * 1e6)).toString(16).padStart(16, '0').slice(-16);
  const portal = adapter.client('portal'), stories = adapter.client('stories');
  const A = adapter.admin;
  const fails = async (p, code, detail) => { try { await p; return false; } catch (e) { return e instanceof DriveError && e.code === code && (detail === undefined || e.detail === detail); } };
  const err = async p => { try { await p; return null; } catch (e) { return e; } };
  const put = (u, project, path, ref, tag, data, o) => u.put(data, { project, path, ref, tag, ...(o || {}) });

  // ═══ put, get, idempotency, versions ═══
  {
    const u = portal.forUser(newSub()), d1 = rnd(100 * KiB);
    const r = await put(u, 'media', 'Films/f1/clip-1.mp4', 'film:f1:clip1', 'intermediate', d1, { sha256: true, contentType: 'video/mp4' });
    ok('put returns id, version, size, whole-file sha256, path, ref, tag and replayed:false', !!r.id && !!r.version && r.size === d1.length && r.sha256 === sha(d1) && r.path === 'Films/f1/clip-1.mp4' && r.ref === 'film:f1:clip1' && r.tag === 'intermediate' && r.replayed === false, JSON.stringify(r));
    const g = await u.get('media', r.id);
    ok('get by id streams the exact bytes with the metadata', (await g.buffer()).equals(d1) && g.sha256 === sha(d1) && g.ref === 'film:f1:clip1' && g.tag === 'intermediate' && g.contentType === 'video/mp4' && g.id === r.id && g.version === r.version && g.status === 200);
    const gr = await u.getByRef('media', 'film:f1:clip1');
    ok('getByRef is the same file', (await gr.buffer()).equals(d1) && gr.id === r.id);
    const chunks = []; for await (const c of (await u.get('media', r.id)).stream) chunks.push(c);
    ok('the body is also available as a stream', Buffer.concat(chunks).equals(d1));
    const r2 = await put(u, 'media', 'Films/f1/clip-1.mp4', 'film:f1:clip1', 'intermediate', d1, { sha256: true });
    ok('the same ref + same sha256 is a no-op: replayed, same id and version', r2.replayed === true && r2.id === r.id && r2.version === r.version);
    const r3 = await put(u, 'media', 'Films/f1/clip-1.mp4', 'film:f1:clip1', 'intermediate', d1);
    ok('the same ref + same bytes without a sha256 is a no-op too', r3.replayed === true && r3.version === r.version);
    const d2 = rnd(50 * KiB);
    const r4 = await put(u, 'media', 'Films/f1/clip-1.mp4', 'film:f1:clip1', 'intermediate', d2, { sha256: true });
    ok('the same ref + other content is a NEW VERSION of the same file', r4.id === r.id && r4.version !== r.version && r4.sha256 === sha(d2) && r4.replayed === false);
    ok('...get returns the new one, and ?version= the old one', (await (await u.getByRef('media', 'film:f1:clip1')).buffer()).equals(d2) && (await (await u.get('media', r.id, { version: r.version })).buffer()).equals(d1));
    ok('...a version id of another file is not_found', await fails(u.get('media', r.id, { version: crypto.randomUUID() }), 'not_found'));
    const st = await u.stat('media', { ref: 'film:f1:clip1' });
    ok('stat by ref: id, version, sha256, size, tag, ref, path', st.id === r.id && st.sha256 === sha(d2) && st.size === d2.length && st.tag === 'intermediate' && st.ref === 'film:f1:clip1' && st.path === 'Films/f1/clip-1.mp4');
    ok('stat by id and by path agree', (await u.stat('media', { id: r.id })).version === r4.version && (await u.stat('media', { path: 'Films/f1/clip-1.mp4' })).id === r.id && (await u.stat('media', { path: 'films/F1/CLIP-1.MP4' })).id === r.id);
    ok('a stream body works (size required) and a function body works', (await put(u, 'media', 'S/stream.bin', 's:1', 'final', require('stream').Readable.from([Buffer.from('ab'), Buffer.from('cd')]), { size: 4 })).size === 4 && (await put(u, 'media', 'S/fn.bin', 's:2', 'final', () => require('stream').Readable.from([Buffer.from('xyz')]), { size: 3 })).size === 3);
    ok('...a stream without a size is refused up front', await fails(put(u, 'media', 'S/nosize.bin', 's:3', 'final', require('stream').Readable.from([Buffer.from('ab')])), 'bad_request'));
    const e0 = await put(u, 'media', 'S/empty.bin', 's:empty', 'final', Buffer.alloc(0));
    ok('an empty file can be written and read', e0.size === 0 && (await (await u.get('media', e0.id)).buffer()).length === 0);
    ok('a conflicting path under another ref is a conflict (path_conflict)', await fails(put(u, 'media', 'Films/f1/clip-1.mp4', 'film:other', 'intermediate', d1), 'conflict', 'path_conflict'));
    ok('the same ref at another path is a conflict (ref_exists)', await fails(put(u, 'media', 'Films/f1/other.mp4', 'film:f1:clip1', 'intermediate', d1), 'conflict', 'ref_exists'));
    ok('the same ref with another tag is a conflict (tag_conflict)', await fails(put(u, 'media', 'Films/f1/clip-1.mp4', 'film:f1:clip1', 'final', d2), 'conflict', 'tag_conflict'));
    ok('a file in the way of a folder is a conflict', await fails(put(u, 'media', 'Films/f1/clip-1.mp4/x.bin', 'x', 'final', d1), 'conflict', 'path_conflict'));
    const ra = await put(u, 'assistant', 'Files/a.bin', 'film:f1:clip1', 'final', d1);
    ok('refs are per project', ra.id !== r.id);
    ok('a wrong sha256 is hash_mismatch and nothing is kept', await fails(put(u, 'media', 'Bad/sha.bin', 'bad:sha', 'final', d1, { sha256: sha(Buffer.from('other')) }), 'hash_mismatch') && await fails(u.stat('media', { ref: 'bad:sha' }), 'not_found'));
    ok('NFD input is stored as NFC and found by either spelling', (await put(u, 'media', 'Images/Café.png', 'nfc:1', 'final', d1)).path === 'Images/Café.png' && (await u.stat('media', { path: 'Images/Café.png' })).ref === 'nfc:1');
    for (const p of ['', '/a', 'a/', 'a//b', 'a/../b', '../a', '.', 'a\\b', 'a/\u0000b', ' a', 'a ', 'x'.repeat(256), Array.from({ length: 25 }, () => 'd').join('/')]) ok(`a bad path is bad_request/bad_path: ${JSON.stringify(p).slice(0, 24)}`, await fails(put(u, 'media', p, 'badpath', 'final', d1), 'bad_request', 'bad_path'));
    ok('a bad ref, a bad tag and a bad sha256 are bad_request', await fails(put(u, 'media', 'a.bin', 'a b', 'final', d1), 'bad_request', 'bad_ref') && await fails(put(u, 'media', 'a.bin', 'ok', 'temp', d1), 'bad_request', 'bad_tag') && await fails(put(u, 'media', 'a.bin', 'ok', 'final', d1, { sha256: 'xyz' }), 'bad_request', 'bad_hash'));
    ok('a bad sub never reaches Drive (bad_request)', (() => { try { portal.forUser('alice'); return false; } catch (e) { return e instanceof DriveError && e.code === 'bad_request'; } })());
  }

  // ═══ list and stat ═══
  {
    const u = portal.forUser(newSub());
    for (const [p, ref, tag] of [['Films/a/1.bin', 'l1', 'final'], ['Films/a/2.bin', 'l2', 'intermediate'], ['Films/a/3.bin', 'l3', 'intermediate'], ['Films/b/4.bin', 'l4', 'source'], ['Films/5.bin', 'l5', 'final'], ['Images/6.bin', 'l6', 'intermediate']]) await put(u, 'media', p, ref, tag, rnd(20 + p.length));
    const all = async (project, o) => { const out = []; for await (const it of u.list(project, o)) out.push(it); return out; };
    ok('list a folder: sub-folders first, then files, with ref, tag and path', (await all('media', { path: 'Films' })).map(i => i.name).join() === 'a,b,5.bin' && (await all('media', { path: 'Films' }))[2].ref === 'l5' && (await all('media', { path: 'Films' }))[2].path === 'Films/5.bin');
    ok('list by tag', (await all('media', { path: 'Films/a', tag: 'intermediate' })).map(i => i.name).join() === '2.bin,3.bin');
    ok('list pages through everything once, in order (pageSize 1)', (await all('media', { path: 'Films/a', pageSize: 1 })).map(i => i.name).join() === '1.bin,2.bin,3.bin');
    ok('recursive + tag: every intermediate file of the project with its path', (await all('media', { recursive: true, tag: 'intermediate' })).map(i => i.path).sort().join() === 'Films/a/2.bin,Films/a/3.bin,Images/6.bin');
    ok('recursive listing pages through all 6 files once', (await all('media', { recursive: true, pageSize: 2 })).length === 6);
    ok('list of a missing folder is not_found; of a project with nothing yet is empty', await fails(all('media', { path: 'Nope' }), 'not_found') && (await portal.forUser(newSub()).list('media')[Symbol.asyncIterator]().next()).done === true);
    ok('a bad tag filter or path is bad_request', await fails(all('media', { tag: 'zzz' }), 'bad_request') && await fails(all('media', { path: 'a//b' }), 'bad_request'));
  }

  // ═══ Range ═══
  {
    const u = portal.forUser(newSub()), d = rnd(64 * KiB * 2 + 777), f = await put(u, 'media', 'R/r.bin', 'r:1', 'final', d);
    const g = await u.get('media', f.id, { range: 'bytes=100-199' });
    ok('Range: 206, exactly those bytes, with contentRange', g.status === 206 && (await g.buffer()).equals(d.subarray(100, 200)) && g.contentRange === `bytes 100-199/${d.length}`);
    ok('a suffix range and a range across 64 KiB', (await (await u.getByRef('media', 'r:1', { range: 'bytes=-50' })).buffer()).equals(d.subarray(d.length - 50)) && (await (await u.get('media', f.id, { range: 'bytes=64000-65600' })).buffer()).equals(d.subarray(64000, 65601)));
    ok('an unsatisfiable or malformed range is bad_range', await fails(u.get('media', f.id, { range: `bytes=${d.length + 1}-` }), 'bad_range') && await fails(u.get('media', f.id, { range: 'bytes=abc' }), 'bad_range'));
  }

  // ═══ patch ═══
  {
    const u = portal.forUser(newSub());
    const p1 = await put(u, 'media', 'Films/p/one.bin', 'p1', 'final', rnd(30)), p2 = await put(u, 'media', 'Films/p/two.bin', 'p2', 'intermediate', rnd(30));
    let r = await u.patch('media', p1.id, { name: 'renamed.bin' });
    ok('rename', r.name === 'renamed.bin' && r.path === 'Films/p/renamed.bin' && r.ref === 'p1');
    r = await u.patch('media', p1.id, { parentPath: 'Films/q/deeper' });
    ok('move (folders made on demand)', r.path === 'Films/q/deeper/renamed.bin');
    ok('...to the project root', (await u.patch('media', p1.id, { parentPath: '' })).path === 'renamed.bin');
    ok('a parentPath cannot climb out, and unknown fields and an empty patch are refused', await fails(u.patch('media', p1.id, { parentPath: '../x' }), 'bad_request') && await fails(u.patch('media', p1.id, { parent: 'root' }), 'bad_request') && await fails(u.patch('media', p1.id, {}), 'bad_request'));
    ok('a name taken (case-insensitively) is a conflict', await fails(u.patch('media', p2.id, { name: 'RENAMED.bin', parentPath: '' }), 'conflict', 'exists'));
    ok('promote intermediate -> final', (await u.patch('media', p2.id, { tag: 'final' })).tag === 'final');
    ok('a final can NOT be demoted to intermediate (tag_locked)', await fails(u.patch('media', p2.id, { tag: 'intermediate' }), 'conflict', 'tag_locked'));
    ok('a ref used by another live file is a conflict; change and clear work', await fails(u.patch('media', p1.id, { ref: 'p2' }), 'conflict', 'ref_conflict') && (await u.patch('media', p1.id, { ref: 'p1b' })).ref === 'p1b' && (await u.patch('media', p1.id, { ref: null })).ref === null);
    ok('a bad ref or tag is bad_request', await fails(u.patch('media', p1.id, { ref: 'a b' }), 'bad_request') && await fails(u.patch('media', p1.id, { tag: 'bogus' }), 'bad_request'));
    const folder = await u.stat('media', { path: 'Films/q' });
    ok('rename a folder; a folder cannot move into itself; a folder takes no tag', (await u.patch('media', folder.id, { name: 'q2' })).name === 'q2' && await fails(u.patch('media', folder.id, { parentPath: 'Films/q2/deeper' }), 'bad_request') && await fails(u.patch('media', folder.id, { tag: 'final' }), 'bad_request'));
    ok('patch of a missing id is not_found', await fails(u.patch('media', crypto.randomUUID(), { name: 'x' }), 'not_found'));
  }

  // ═══ delete ═══
  {
    const u = portal.forUser(newSub()), sub = u.sub;
    const fin = await put(u, 'media', 'D/final.mp4', 'd:final', 'final', rnd(3000)), inter = await put(u, 'media', 'D/inter.mp4', 'd:inter', 'intermediate', rnd(2000)), src = await put(u, 'media', 'D/src.mp4', 'd:src', 'source', rnd(1000));
    ok('quota() counts all three', (await u.quota()).used === 6000);
    const del = await u.remove('media', fin.id);
    ok('remove (default) moves a final to the Bin: it is gone for the app and still counts toward the quota', del.mode === 'bin' && await fails(u.get('media', fin.id), 'not_found') && await fails(u.stat('media', { ref: 'd:final' }), 'not_found') && (await u.quota()).used === 6000);
    ok('removing it again is not_found', await fails(u.remove('media', fin.id), 'not_found'));
    ok('permanent on a final or a source is refused (conflict/not_intermediate) and nothing changes', await fails(u.remove('media', src.id, { permanent: true }), 'conflict', 'not_intermediate') && (await u.stat('media', { id: src.id })).id === src.id);
    const pr = await u.remove('media', inter.id, { permanent: true });
    ok('permanent on an intermediate frees the bytes at once', pr.mode === 'permanent' && pr.freedBytes === 2000 && (await u.quota()).used === 4000);
    ok('...and its ref can be used again', (await put(u, 'media', 'D/inter.mp4', 'd:inter', 'intermediate', rnd(10))).replayed === false);
    await put(u, 'media', 'Folder/one.bin', 'f:1', 'intermediate', rnd(100)); await put(u, 'media', 'Folder/deep/two.bin', 'f:2', 'intermediate', rnd(200)); await put(u, 'media', 'Folder/deep/keep.bin', 'f:keep', 'final', rnd(300));
    const folder = await u.stat('media', { path: 'Folder' });
    const ne = await err(u.remove('media', folder.id));
    ok('a non-empty folder needs recursive (conflict/not_empty, with the count)', ne && ne.code === 'conflict' && ne.detail === 'not_empty' && ne.extra && ne.extra.items === 2, ne && JSON.stringify([ne.code, ne.detail, ne.extra]));
    const nb = await err(u.remove('media', folder.id, { permanent: true, recursive: true }));
    ok('a recursive PERMANENT delete is refused if any file is not intermediate (with the count) and deletes nothing', nb && nb.code === 'conflict' && nb.detail === 'not_intermediate' && nb.extra && nb.extra.blocking === 1 && (await u.stat('media', { ref: 'f:1' })).id && (await u.stat('media', { ref: 'f:keep' })).id);
    ok('a recursive Bin delete is fine', (await u.remove('media', folder.id, { recursive: true })).mode === 'bin' && await fails(u.stat('media', { ref: 'f:2' }), 'not_found'));
    const e = portal.forUser(newSub());
    await put(e, 'media', 'E/a.bin', 'e:a', 'intermediate', rnd(10)); await put(e, 'media', 'E/b/c.bin', 'e:c', 'intermediate', rnd(20));
    const ef = await e.stat('media', { path: 'E' });
    const ep = await e.remove('media', ef.id, { permanent: true, recursive: true });
    ok('a recursive permanent delete works when every file is intermediate (folders and files go)', ep.mode === 'permanent' && ep.files === 2 && ep.freedBytes === 30 && ep.deleted === 4 && (await e.quota()).used === 0);
    void sub;
  }

  // ═══ usage and prune ═══
  {
    const u = portal.forUser(newSub());
    await put(u, 'media', 'u/f1.bin', 'u:f1', 'final', rnd(1000)); await put(u, 'media', 'u/f2.bin', 'u:f2', 'final', rnd(500));
    await put(u, 'media', 'u/i1.bin', 'u:i1', 'intermediate', rnd(2000)); await put(u, 'media', 'u/i1.bin', 'u:i1', 'intermediate', rnd(2500)); await put(u, 'media', 'u/s1.bin', 'u:s1', 'source', rnd(300));
    A.userAddFile && await A.userAddFile(u.sub, 'media', 'plain.bin', rnd(100));
    const us = await u.usage('media');
    ok('usage by tag: files, versions, bytes (every stored version counts)', us.byTag.final.files === 2 && us.byTag.final.bytes === 1500 && us.byTag.intermediate.files === 1 && us.byTag.intermediate.versions === 2 && us.byTag.intermediate.bytes === 4500 && us.byTag.source.bytes === 300 && us.byTag.untagged.files === 1 && us.byTag.untagged.bytes === 100, JSON.stringify(us.byTag));
    ok('...total, the cap (90% of the quota) and the quota', us.total.bytes === 6400 && us.cap.bytes === Math.floor(0.9 * 25 * 1024 ** 3) && us.cap.free === us.cap.bytes - 6400 && us.quota.total === 25 * 1024 ** 3 && us.quota.used === 6400 && us.overQuota === false);
    ok('usage of another project of the app is separate; of a project the app does not own is forbidden', (await u.usage('assistant')).total.bytes === 0 && await fails(u.usage('story-writing'), 'forbidden'));
    const P = portal.forUser(newSub());
    const ids = {};
    for (const i of [1, 2, 3, 4, 5]) { ids[i] = (await put(P, 'media', `P/i${i}.bin`, `cache:${i}`, 'intermediate', rnd(1000))).id; await A.age(P.sub, 1000 * (6 - i), ids[i]); }
    const fin = await put(P, 'media', 'P/final.bin', 'cache:final', 'final', rnd(1000)); const src = await put(P, 'media', 'P/source.bin', 'cache:source', 'source', rnd(1000));
    await A.age(P.sub, 9000, [fin.id, src.id]);
    let r = await P.prune('media', { olderThanSeconds: 0 });
    ok('prune defaults to a DRY RUN and deletes nothing', r.dryRun === true && r.deleted === 5 && r.freedBytes === 5000 && r.more === false && (await P.stat('media', { id: ids[1] })).id === ids[1]);
    ok('prune with no criteria is bad_request/no_criteria; only intermediate may be named', await fails(P.prune('media', {}), 'bad_request', 'no_criteria') && await fails(P.prune('media', { olderThanSeconds: 0, tag: 'final' }), 'bad_request'));
    r = await P.prune('media', { olderThanSeconds: 3500, dryRun: false });
    ok('olderThanSeconds: only the older ones, and a real run deletes them (oldest first)', r.dryRun === false && r.deleted === 2 && r.freedBytes === 2000 && r.remaining === 3 && await fails(P.stat('media', { id: ids[1] }), 'not_found') && (await P.stat('media', { id: ids[3] })).id === ids[3]);
    r = await P.prune('media', { targetFreeBytes: 1500, dryRun: false });
    ok('targetFreeBytes: oldest first until at least that much is free', r.deleted === 2 && r.freedBytes === 2000);
    ok('keepNewestBytes larger than what is held deletes nothing', (await P.prune('media', { keepNewestBytes: 5000 })).deleted === 0);
    ok('final and source files are never touched, not even by a prefix that names them', (await P.stat('media', { id: fin.id })).id === fin.id && (await P.stat('media', { id: src.id })).id === src.id && (await P.prune('media', { refPrefix: 'cache:fin', olderThanSeconds: 0, dryRun: false })).deleted === 0 && (await P.stat('media', { id: fin.id })).id === fin.id);
    ok('refPrefix matches by ref prefix', (await P.prune('media', { refPrefix: 'cache:5', dryRun: false })).deleted === 1);
    ok('a bad number or ref in a prune is bad_request', await fails(P.prune('media', { olderThanSeconds: -1 }), 'bad_request') && await fails(P.prune('media', { refPrefix: 'a b' }), 'bad_request') && await fails(P.prune('media', { keepNewestBytes: 1, targetFreeBytes: 1 }), 'bad_request'));
  }

  // ═══ the person's work, default permanent delete, the Bin ═══
  {
    const u = portal.forUser(newSub());
    const inter = (name, ref, size = 1000) => put(u, 'media', 'W/' + name, ref, 'intermediate', rnd(size));
    const a = await inter('a.bin', 'uw:a', 2000), fin = await put(u, 'media', 'W/final.bin', 'uw:fin', 'final', rnd(3000));
    const r = await u.remove('media', a.id);
    ok('remove of an untouched intermediate is PERMANENT by default and frees the quota at once', r.mode === 'permanent' && r.freedBytes === 2000 && (await u.quota()).used === 3000);
    ok('...a final goes to the Bin', (await u.remove('media', fin.id)).mode === 'bin');
    const b = await inter('b.bin', 'uw:b', 1500);
    ok('{ bin: true } sends an intermediate to the Bin; permanent + bin is bad_request', (await u.remove('media', b.id, { bin: true })).mode === 'bin' && await fails(u.remove('media', b.id, { permanent: true, bin: true }), 'bad_request'));
    let us = await u.usage('media');
    ok('usage shows the Bin by tag, and the cap counts it', us.bin.byTag.intermediate.bytes === 1500 && us.bin.byTag.final.bytes === 3000 && us.bin.total.bytes === 4500 && us.total.bytes === 0 && us.cap.used === 4500, JSON.stringify([us.bin.total, us.cap]));
    ok('a Bin\'d final is out of reach (not_found) but the app\'s own Bin\'d intermediate can be removed for good by id', await fails(u.remove('media', fin.id, { permanent: true }), 'not_found') && (await u.remove('media', b.id, { permanent: true })).freedBytes === 1500);
    const c = await inter('c.bin', 'uw:c', 900); await u.remove('media', c.id, { bin: true });
    const pr = await u.prune('media', { olderThanSeconds: 0, dryRun: false });
    ok('prune reaches an app-Binned intermediate', pr.deleted === 1 && pr.freedBytes === 900 && pr.skippedUserWork === 0);
    const v = await inter('v.bin', 'uw:v'), st = await inter('s.bin', 'uw:s'), rn = await inter('r.bin', 'uw:r'), ok1 = await inter('ok.bin', 'uw:ok');
    await A.userNewVersion(u.sub, v.id, Buffer.from('my edit')); await A.userStar(u.sub, st.id); await A.userRename(u.sub, rn.id, 'MY FAVOURITE CLIP.bin');
    const dry = await u.prune('media', { olderThanSeconds: 0 });
    ok('a file the person added a version to, starred or renamed is SKIPPED by prune (counted in skippedUserWork), the untouched one would go', dry.deleted === 1 && dry.skippedUserWork === 3 && dry.dryRun === true, JSON.stringify(dry));
    for (const x of [v, st, rn]) ok('...and refused for a permanent delete (conflict/not_intermediate); a plain remove only goes to the Bin', await fails(u.remove('media', x.id, { permanent: true }), 'conflict', 'not_intermediate'));
    ok('(the Bin round trip) a plain remove of the touched file is the Bin', (await u.remove('media', v.id)).mode === 'bin');
    await A.userRestore(u.sub, v.id);
    const real = await u.prune('media', { olderThanSeconds: 0, dryRun: false });
    ok('a real prune deletes only the untouched file', real.deleted === 1 && real.skippedUserWork === 3 && await fails(u.stat('media', { id: ok1.id }), 'not_found') && (await u.stat('media', { id: v.id })).id === v.id);
    const t = await inter('t.bin', 'uw:t'); await A.userTrash(u.sub, t.id);
    ok('a file the PERSON put in the Bin is not reachable by the app (not_found; prune skips it)', await fails(u.remove('media', t.id, { permanent: true }), 'not_found') && (await u.prune('media', { refPrefix: 'uw:t', dryRun: false })).deleted === 0);
    ok('olderThanSeconds is bounded (bad_request above 3e9)', await fails(u.prune('media', { olderThanSeconds: 1e15 }), 'bad_request') && (await u.prune('media', { olderThanSeconds: 3e9 })).dryRun === true);
  }
  {
    const s = stories.forUser(newSub());
    const sp = (p, ref, d) => put(s, 'story-writing', p, ref, 'intermediate', d);
    const a = await sp('B/a.bin', 'bc:a', rnd(250 * KiB)); await sp('B/b.bin', 'bc:b', rnd(250 * KiB));
    await s.remove('story-writing', a.id, { bin: true });
    ok('bytes the app put in the Bin STILL count against its cap (app_cap), and prune gives the room back', await fails(sp('B/c.bin', 'bc:c', rnd(250 * KiB)), 'app_cap') && (await s.prune('story-writing', { refPrefix: 'bc:a', dryRun: false })).deleted === 1 && (await sp('B/c.bin', 'bc:c', rnd(250 * KiB))).replayed === false);
  }

  // ═══ scoping ═══
  {
    const u = portal.forUser(newSub()), v = portal.forUser(newSub());
    const f = await put(u, 'media', 'S/mine.bin', 's:mine', 'final', rnd(50));
    ok('another person cannot reach the file (id, ref, patch, remove): not_found', await fails(v.get('media', f.id), 'not_found') && await fails(v.getByRef('media', 's:mine'), 'not_found') && await fails(v.patch('media', f.id, { name: 'x' }), 'not_found') && await fails(v.remove('media', f.id, { permanent: true }), 'not_found'));
    ok('the other project of the same app does not see it either', await fails(u.get('assistant', f.id), 'not_found'));
    ok('a project the app does not own is forbidden, whoever asks; another app cannot use the portal\'s project', await fails(u.get('story-writing', f.id), 'forbidden') && await fails(stories.forUser(u.sub).get('media', f.id), 'forbidden'));
    ok('a random id and a malformed id are not_found', await fails(u.get('media', crypto.randomUUID()), 'not_found') && await fails(u.get('media', 'not-a-uuid'), 'not_found'));
    const wrong = adapter.client('portal', 'x'.repeat(40)).forUser(u.sub);
    ok('a wrong secret is forbidden', await fails(wrong.quota(), 'forbidden') && await fails(wrong.get('media', f.id), 'forbidden'));
    ok('an unknown app is forbidden', await fails(adapter.client('ghost', 'x'.repeat(40)).forUser(u.sub).quota(), 'forbidden'));
    // what the person does in the Drive web app
    const g1 = await put(u, 'media', 'S/moved.bin', 's:moved', 'intermediate', rnd(50));
    await A.userMoveOut(u.sub, g1.id);
    ok('a file the person moved out of the project is out of reach, and its ref is free again', await fails(u.get('media', g1.id), 'not_found') && await fails(u.stat('media', { ref: 's:moved' }), 'not_found') && (await put(u, 'media', 'S/moved.bin', 's:moved', 'intermediate', rnd(51))).id !== g1.id);
    const g2 = await put(u, 'media', 'S/binned.bin', 's:binned', 'final', rnd(50));
    await A.userTrash(u.sub, g2.id);
    ok('a file the person put in the Bin is not_found, and its ref can be written again as a new file', await fails(u.get('media', g2.id), 'not_found') && (await put(u, 'media', 'S/binned.bin', 's:binned', 'final', rnd(52))).id !== g2.id);
    const own = await A.userAddFile(u.sub, 'media', 'S/person-added.txt', Buffer.from('mine'));
    const li = []; for await (const it of u.list('media', { path: 'S' })) li.push(it);
    const added = li.find(i => i.id === own);
    ok('a file the person adds inside the project is visible, readable, with no ref and no tag, and can only go to the Bin', !!added && added.ref === null && added.tag === null && (await (await u.get('media', own)).buffer()).toString() === 'mine' && await fails(u.remove('media', own, { permanent: true }), 'conflict', 'not_intermediate'));
    const w = portal.forUser(newSub());
    await put(w, 'media', 'x.bin', 'x:1', 'final', rnd(5));
    await A.userTrashProject(w.sub, 'media');
    ok('with the project folder in the Bin, writes and reads say project_in_bin', await fails(put(w, 'media', 'y.bin', 'y:1', 'final', rnd(5)), 'project_in_bin') && await fails(w.stat('media', { ref: 'x:1' }), 'project_in_bin'));
  }

  // ═══ caps, quota, plan limits ═══
  {
    const s = stories.forUser(newSub());
    const sp = (p, ref, d) => put(s, 'story-writing', p, ref, 'intermediate', d);
    ok('a file over the app\'s limit is file_too_large', await fails(sp('B/big.bin', 'big', rnd(301 * KiB)), 'file_too_large'));
    await sp('B/a.bin', 'a', rnd(250 * KiB)); await sp('B/b.bin', 'b', rnd(250 * KiB));
    ok('past the app\'s cap is app_cap, and nothing is left behind', await fails(sp('B/c.bin', 'c', rnd(250 * KiB)), 'app_cap') && await fails(s.stat('story-writing', { ref: 'c' }), 'not_found'));
    ok('a new version counts: 500 + 120 > 600 is app_cap, 500 + 80 fits', await fails(sp('B/a.bin', 'a', rnd(120 * KiB)), 'app_cap') && (await sp('B/a.bin', 'a', rnd(80 * KiB))).replayed === false);
    const us = await s.usage('story-writing');
    ok('usage shows the cap and what is free', us.cap.bytes === 600 * KiB && us.total.bytes === 580 * KiB && us.cap.free === 20 * KiB);
    await s.remove('story-writing', (await s.stat('story-writing', { ref: 'b' })).id, { permanent: true });
    ok('freeing space makes room at once', (await sp('B/e.bin', 'e', rnd(250 * KiB))).replayed === false);
    const q = portal.forUser(newSub());
    await put(q, 'media', 'seed.bin', 'seed', 'final', rnd(1));
    await A.userAddFile(q.sub, 'assistant', 'big-own-file.bin', rnd(300 * KiB));
    await A.setQuota(q.sub, 700 * KiB);
    ok('the person\'s quota: the first 250 KiB fits (of 700, 300 already theirs)... and the second does not (quota)', (await put(q, 'media', 'a.bin', 'qa', 'final', rnd(250 * KiB))).replayed === false && await fails(put(q, 'media', 'b.bin', 'qb', 'final', rnd(250 * KiB)), 'quota'));
    await A.setQuota(q.sub, 300 * KiB);
    const oq = await err(put(q, 'media', 'c.bin', 'qc', 'final', rnd(10)));
    ok('past the limit already (a downgrade) is quota with detail over_quota', !!oq && oq.code === 'quota' && oq.detail === 'over_quota', oq && JSON.stringify([oq.code, oq.detail]));
    ok('...usage reports overQuota', (await q.usage('media')).overQuota === true && (await q.quota()).over === true);
    ok('...remove works when over quota', (await q.remove('media', (await q.stat('media', { ref: 'qa' })).id)).mode === 'bin');
    const m = portal.forUser(newSub());
    await put(m, 'media', 'seed.bin', 'seed', 'final', rnd(1));
    await A.setMaxFile(m.sub, 100 * KiB);
    ok('the plan\'s per-file limit applies to apps: file_too_large', await fails(put(m, 'media', 'big.bin', 'big', 'final', rnd(101 * KiB)), 'file_too_large') && (await put(m, 'media', 'ok.bin', 'ok', 'final', rnd(100 * KiB))).replayed === false);
    const qq = await portal.forUser(newSub()).quota();
    ok('quota(): used, reserved, quota, plan, state, over, free', qq.used === 0 && qq.reserved === 0 && qq.quota === 25 * 1024 ** 3 && qq.plan === 'free' && qq.state === 'active' && qq.over === false && qq.free === qq.quota);
  }

  // ═══ account states and infected files ═══
  {
    const u = portal.forUser(newSub());
    const f = await put(u, 'media', 'F/x.bin', 'fz:1', 'intermediate', rnd(500));
    await A.setState(u.sub, 'frozen');
    ok('a FROZEN account can be read (get, stat, list, usage, quota, dry-run prune)', (await (await u.get('media', f.id)).buffer()).length === 500 && (await u.stat('media', { ref: 'fz:1' })).id === f.id && (await u.usage('media')).total.bytes === 500 && (await u.quota()).state === 'frozen' && (await u.prune('media', { olderThanSeconds: 0 })).dryRun === true);
    ok('...and every write is frozen: put, new version, patch, remove, permanent remove, a real prune', await fails(put(u, 'media', 'F/n.bin', 'fz:n', 'final', rnd(5)), 'frozen') && await fails(put(u, 'media', 'F/x.bin', 'fz:1', 'intermediate', rnd(6)), 'frozen') && await fails(u.patch('media', f.id, { name: 'q.bin' }), 'frozen') && await fails(u.remove('media', f.id), 'frozen') && await fails(u.remove('media', f.id, { permanent: true }), 'frozen') && await fails(u.prune('media', { olderThanSeconds: 0, dryRun: false }), 'frozen'));
    await A.setState(u.sub, 'active');
    ok('unfrozen, writes work', (await put(u, 'media', 'F/n.bin', 'fz:n', 'final', rnd(5))).replayed === false);
    for (const st of ['pending_erase', 'erased']) {
      const c = portal.forUser(newSub()); await put(c, 'media', 'a.bin', 'c:1', 'final', rnd(5)); await A.setState(c.sub, st);
      ok(`a ${st} account answers everything with gone`, await fails(c.quota(), 'gone') && await fails(put(c, 'media', 'b.bin', 'c:2', 'final', rnd(5)), 'gone') && await fails(c.stat('media', { ref: 'c:1' }), 'gone') && await fails(c.usage('media'), 'gone') && await fails(c.prune('media', { olderThanSeconds: 0 }), 'gone'));
    }
    const i = portal.forUser(newSub()); const x = await put(i, 'media', 'I/x.bin', 'inf:1', 'final', rnd(100));
    await A.markInfected(i.sub, x.id);
    ok('an infected file is infected on get and stat by id / ref, never served', await fails(i.get('media', x.id), 'infected') && await fails(i.getByRef('media', 'inf:1'), 'infected') && await fails(i.stat('media', { id: x.id }), 'infected'));
    ok('...but listing and stat by path still show it, with scan: infected', (await i.stat('media', { path: 'I/x.bin' })).scan === 'infected');
  }
}
module.exports = { run };
