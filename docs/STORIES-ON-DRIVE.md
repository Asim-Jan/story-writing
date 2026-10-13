# STORIES-ON-DRIVE: Story Writing's media lives in SAI Drive

Status: BUILT 2026-10-11; since 2.23.79 (2026-10-13) Drive is the ONLY media store (MinIO retired). The decisions behind it are Asim's
(2026-10-10/11): **Drive is the system of record for generated content** — apps store the bytes IN
Drive and keep only references; everything migrates into the caretaker's Drive now, ownership is
sorted later; new uploads are Drive-primary immediately.

## What runs where

| Piece | Where |
|---|---|
| The bytes | the person's SAI Drive, project folder `story-writing` (`SAI Apps/Story Writing/…`), written through Drive's app API (`/app/v1`) |
| The references | Stories' Postgres, `media_owners.drive_ref / drive_node / drive_size` (migration `z108`) |
| The ACL | unchanged — `media_owners` + `canAccessMedia` decide who may read; Drive never checks |
| The client | `server/vendor/drive-client/` (vendored from `manifests/_drive-client`, zero deps) |
| The storage seam | `server/services/driveStorage.js` |

## Layout inside the project

```
<owner segment>/<folder>/<filename>
```

- `owner segment` = the uploader's `portal_sub` (`u_<16 hex>`), or the **caretaker**'s sub with the
  literal segment `_unowned` for the migrated objects whose real owner has no portal link yet
  (`DRIVE_CARETAKER_SUB`, `u_f37d34dea1d20271` — asim.jan@solutionsai.co.uk).
- `folder` per bucket type: images→`Covers`, comics→`Books`, audio→`Audio`, videos→`Films`.
- `ref` = `story:<bucketType>:<filename>` — globally unique (media_owners' PK is that pair), so the
  put is idempotent and the read needs no path.

## 2.23.79: Drive is the ONLY media store (MinIO retired)

The migration finished on 2026-10-12 (every `media_owners` row with bytes has a `drive_ref`, MinIO's
buckets were emptied and its StatefulSet scaled to 0). 2.23.76 still DEPENDED on MinIO, and with the
hostname gone it was partly broken: a failed bucket check at boot (`ENOTFOUND minio`) switched every
media route and every non-text job to 503 for the life of the pod; `upload()` checked MinIO before
writing to Drive; films, exports, take reuse, character references and cloned voices read MinIO only;
account erasure aborted (503, retried forever) for anyone with media. 2.23.79 removes MinIO and S3
from the code entirely:

- `services/mediaStorage.js` is a thin layer over `driveStorage`: no client, no boot probe, no
  `MINIO_*` requirement (the old constructor threw in production without them; the keys may stay in
  the ConfigMap/Secret, unused). Errors carry `status`: 404 not found, 503 retryable, 413 too big,
  451 infected.
- Routes that need storage check only that Drive is CONFIGURED (`requireMediaStorage`); a Drive
  outage is answered per request with a retryable 503.

## Write path

`mediaStorage.upload(bucketType, buffer, filename, metadata, setMapping, { driveUser, bookId })`
puts the bytes in the owner's Drive and records `media_owners` (owner, ref, node, size, Drive owner)
ITSELF, so no caller can leave an unreadable object behind (2.23.76's stitched films and scene clips
had no owner row at all). The owner: `driveUser`; a `{ userId }`-only caller is resolved to the user
row (portal_sub); no user + a `bookId` = the book's owner; nobody = the caretaker. A Drive failure
FAILS the upload (503 retryable, 413 over the cap): there is no other store to fall back to.

## Read path

`GET /api/media/:bucketType/:filename`:

1. ACL first (unchanged, fail-closed).
2. The holder = `media_owners.drive_owner`, else the uploader's `portal_sub`, else the caretaker.
   Stream from that Drive by ref (the app API call names the holder, not the requester), Range
   passed through.
3. No Drive copy → 404. Drive down or not configured → 503 (the browser retries). Infected → 451.

Server-side readers use the same seam: `getFile` (small, size-capped: reference pictures, voice
samples), `downloadTo` (films, takes, voice-over, music: streamed to a temp file, never held in
memory) and `getStream`.

## Deletes and account erasure

- `DELETE /api/media/...`: the Drive copy goes to the holder's Bin, then the row. Drive down = 503
  and nothing is deleted.
- Account erasure (`portalAuth/erasure.js`): a copy in the person's OWN Drive is left to Drive's own
  account lifecycle (Drive receives the same account-deleted event: pending_erase at once, bytes
  erased at day 30 — `sai-drive/APPS-INTEGRATION.md` section 7); a copy held in ANOTHER account (the
  caretaker's, for objects migrated before their owner linked) is removed by Stories (to that
  holder's Bin, emptied after 30 days). Gone copies count as removed; only a real Drive outage stops
  the erase (503, the portal retries).

## The migration (done)

`server/tools/migrate-media-to-drive.cjs` moved MinIO's objects into Drive (2026-10-11/12) and was
removed with MinIO in 2.23.79 (it read MinIO directly); it is in git history before that release.

## What to watch after go-live

- `[drive-storage] put failed (<code>)` / `Media upload error` with 503 in the backend/worker logs:
  Drive refused or could not be reached; the generation answered 503 and nothing was stored.
  Repeated `quota` / `app_cap` (413) means the owner's Drive (or Stories' app cap) is full.
- `/api/health` → `services.storage` says `sai-drive` + `configured`.

## Tests

- `npm run test:media` (no database): `media-drive-only.test.js` — the REAL MediaStorage over the
  vendored in-process fake Drive with no MinIO/AWS variable anywhere: uploads (owner, book owner,
  `{userId}` callers, not configured = 503, outage = 503, cap = 413), every read (open with Range,
  stream, buffer with cap, download to disk, caretaker fallback, 404, 503), delete, and the eraser
  (own-Drive copies left to Drive, caretaker copies removed, outage = retry, gone = done); plus
  `suite-script.test.js` (the SAI Cloud switcher's `/sai-suite.js` route, script tag, CSP and layout).
- `server/tests/drive.test.js` (`npm run test:drive`): the REAL server over HTTP against a throwaway
  Postgres + Redis and a fake Drive app API (`fake-drive-http.mjs`), no MinIO: boot, upload over
  HTTP, read/Range/404/503, the caretaker, ACL, delete (and delete during an outage), unconfigured
  storage.
- `npm run test:regress`: its media section now runs against the fake Drive by default (it was
  skipped without a throwaway MinIO) and pins that each of the five server-side read sites
  (videoAssembler, filmExport, filmDirector take reuse, characterReferences, voices) reads from Drive.
- `portalAuth/tests/identityEvents.test.js`: erasure with the real MediaStorage + fake Drive.
