# _drive-client: put an app's generated files into the person's SAI Drive

A zero-dependency Node library (`index.js`) for a **first-party SAI platform app** to write into, read from and manage its own project folder in a person's
SAI Drive, through the in-cluster app API (`manifests/sai-drive/APP-API.md`). Requires Node 18+ (global `fetch`). Copy `index.js` into the app at deploy time the
way `_auth-client` is copied (or pass your own `fetch`). `fake.js` is an in-memory Drive for the **tests** of the app that uses it.

Drive is the system of record for what an app generates (films: every image, audio, video clip, final and intermediate). The app keeps **references** (the `ref`
and the Drive `id`), not the bytes. Deleting in the app deletes in Drive.

```js
const { createDriveClient, DriveError } = require('./drive-client');
const drive = createDriveClient({
  base: 'http://sai-drive-api.sai-drive.svc',          // the Service (port 80); never the public host
  appId: 'portal',                                     // an id in manifests/sai-drive/apps.json
  appSecret: process.env.DRIVE_APP_API_SECRET,         // Secret sai-portal-apps key drive-app; never the repo, never a log
});
const u = drive.forUser(sub);                          // sub = the portal user id (u_ + 16 hex). The person is named per call; nothing else identifies them.

// write: idempotent by ref. Safe to retry; a replay with the same ref + sha256 sends no bytes.
const f = await u.put(buffer, { project: 'media', path: 'Films/f1/clip-3.mp4', ref: 'film:f1:clip:3', tag: 'intermediate', sha256: true, contentType: 'video/mp4' });
await u.put(() => fs.createReadStream(file), { project: 'media', path: '...', ref: '...', tag: 'final', size, sha256: hex });   // a big file: stream it, never buffer

// read: a Node stream, Range supported
const g = await u.getByRef('media', 'film:f1:clip:3', { range: 'bytes=0-1023' });  g.stream.pipe(res);   // or await g.buffer()
const meta = await u.stat('media', { ref: 'film:f1:clip:3' });                       // { id, version, size, sha256, path, ref, tag, scan, ... }
for await (const item of u.list('media', { path: 'Films/f1', tag: 'intermediate', recursive: true })) { /* paginated */ }

// manage
await u.patch('media', f.id, { name: 'final-cut.mp4', parentPath: 'Films/f1/final', tag: 'final' });
await u.remove('media', id);               // an UNTOUCHED intermediate file is deleted for good (quota freed now); a final / source / touched file goes to the person's Bin
await u.remove('media', id, { bin: true });          // force the Bin even for an intermediate
await u.remove('media', id, { permanent: true });    // only for an intermediate the app wrote and nobody changed, else conflict/not_intermediate
console.log(await u.usage('media'));                             // { byTag, total, bin:{ byTag, total }, cap:{ bytes, used (live + Bin + in flight), free }, quota, overQuota }
console.log(await u.prune('media', { olderThanSeconds: 86400 })); // DRY RUN by default; { dryRun: false } deletes, oldest first, untouched intermediates only; { skippedUserWork } counts files the person touched
console.log(await u.quota());                                    // { used, quota, free, over, plan, state }
```

## Errors

Everything throws `DriveError { code, status, requestId, detail, retryAfterS, extra }`.

| code | meaning | what the app does |
|---|---|---|
| `unavailable` | connection failure, timeout, 5xx (the object store paused, Drive deploying) | **retry later, and keep what you generated.** A file is held by the app until its put succeeds; only then keep just the ref. |
| `busy` | 429, too many calls in flight | back off (the library already retried briefly) |
| `in_progress` | another upload of the same ref is still arriving, or the file was deleted for good while this write was arriving | retry shortly (the library retries it) |
| `quota` | the person's storage is full (`detail`: `quota` or `over_quota`) | tell the person; prune intermediates; reads and deletes still work |
| `app_cap` | the app already holds its maximum in this person's project | prune intermediates, or surface "space full" |
| `file_too_large` | over the app's or the person's plan's per-file limit | do not retry |
| `not_found` | no such file in your project for this person (also: in the Bin, moved out by the person) | treat the reference as gone |
| `forbidden` | wrong app id / secret, or a project the app does not own | a deployment mistake: alert |
| `frozen` | the account is read-only | reads work; keep the file and retry later |
| `gone` | the account is being erased | stop writing for this person |
| `project_in_bin` | the person put the project folder in their Drive Bin | pause, tell the person to restore it |
| `conflict` | `detail`: `node_moved` (the person moved the file out while a new version arrived: do not retry blindly), `path_conflict`, `ref_exists`, `ref_conflict`, `tag_conflict`, `exists`, `not_empty` (`extra.items`), `not_intermediate` (`extra.blocking`), `tag_locked`, `cycle` | a logic bug in the caller, or a deliberate refusal |
| `infected` | a malware scan blocked the file (451) | do not serve it |
| `hash_mismatch` | the bytes did not match the `sha256` you sent | re-send |
| `bad_range`, `bad_request` (`detail`: `bad_path`, `bad_ref`, `bad_tag`, `bad_hash`, `bad_sub`, `bad_size`, `no_criteria` ...), `length_required`, `internal` | | fix the call |

## What is retried

Only what cannot do harm twice: GET/stat/list/usage/quota, **put** (idempotent by ref) when the body can be sent again (a Buffer or a `() => stream`), remove (a 404 after
a retried remove means the first try landed: reported as `{ ok: true, alreadyGone: true }`), and a dry-run prune. Retried on `unavailable`, `busy`, `in_progress` only, with
jittered exponential backoff bounded by `retries` (3) and `budgetMs` (30 s). **Never** retried: patch, a real prune, a one-shot stream body, any other 4xx.

## Testing your app

```js
const { createFakeDrive } = require('./fake');
const fake = createFakeDrive();                         // apps portal (media, assistant) and stories (story-writing, 600 KiB cap)
const drive = fake.client({ appId: 'portal' });         // same shape as createDriveClient(...)
fake.admin.failNext(2);                                 // the next two calls throw DriveError('unavailable')
fake.admin.failNext(1, { afterWrite: true });           // the next write LANDS but its answer is lost: test your retry
fake.admin.setState(sub, 'frozen'); fake.admin.setQuota(sub, 1e6); fake.admin.markInfected(sub, id);
fake.admin.userTrash(sub, id); fake.admin.userMoveOut(sub, id);   // what the person does in the Drive web app
```

`tests/conformance.js` runs one scenario suite against the double (`tests/fake.test.js`) **and** against the real Drive code with this real client
(`manifests/sai-drive/app/tests/appclient.test.js`): if they ever disagree, one of the two fails. `tests/lib.test.js` checks what the client sends and retries against
a stub server. Run: `node tests/fake.test.js && node tests/lib.test.js` (no Docker); the real-Drive run is part of `bash manifests/sai-drive/app/tests/run.sh`.
