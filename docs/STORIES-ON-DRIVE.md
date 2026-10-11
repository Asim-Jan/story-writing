# STORIES-ON-DRIVE: Story Writing's media lives in SAI Drive

Status: BUILT 2026-10-11 (flag-gated, migration tool ready). The decisions behind it are Asim's
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

## Write path

`mediaStorage.upload(..., { driveUser })` — after the MinIO write (which STAYS: the MinIO copy is
the fallback through the migration window), the bytes go into the owner's Drive. A Drive outage
NEVER fails the upload: the file is in MinIO, `drive_ref` stays NULL, and the next migration pass
(or the next write of the same ref) picks it up. `recordMediaOwner` writes the ref columns when the
result carries `drive`.

Every media-producing site passes `driveUser` now: the four index.js generators (standalone visual,
comic panel, TTS chapter, audiobook), the generic upload route, and the four job/service sites
(imageProcessor, audioProcessor — which now also records ownership —, videoGenerator,
videoAssembler — owner resolved from the book).

## Read path

`GET /api/media/:bucketType/:filename`:

1. ACL first (unchanged, fail-closed).
2. If the owner row has a `drive_ref` → stream from Drive (the app API call names the asset's Drive
   OWNER, resolved from media_owners — not the requester), Range pass-through for audio/video.
3. No `drive_ref` → MinIO as before.
4. Drive transport error → **503** (the browser retries). Never a silent fallback to possibly-stale
   MinIO bytes: the ref decides where the truth is, and a recorded ref says Drive.
5. A recorded ref with no Drive copy (only possible mid-migration) → falls back to MinIO.

With storage off (no `DRIVE_APP_API_SECRET`, or `STORY_DRIVE=0`) everything behaves exactly as
before and no Drive call is ever made.

## The migration

`server/tools/migrate-media-to-drive.cjs`, run in the backend pod:

```
kubectl -n story-writing exec -i deploy/backend -- env \
  MIGRATE_MEDIA_TO_DRIVE_CLI=1 DRIVE_CARETAKER_SUB=u_f37d34dea1d20271 \
  node server/tools/migrate-media-to-drive.cjs            # DRY RUN: counts only, no Drive call
kubectl -n story-writing exec -i deploy/backend -- env \
  MIGRATE_MEDIA_TO_DRIVE_CLI=1 DRIVE_CARETAKER_SUB=u_f37d34dea1d20271 \
  node server/tools/migrate-media-to-drive.cjs --apply    # migrate + verify, resumable
kubectl -n story-writing exec -i deploy/backend -- env \
  MIGRATE_MEDIA_TO_DRIVE_CLI=1 DRIVE_CARETAKER_SUB=u_f37d34dea1d20271 \
  node server/tools/migrate-media-to-drive.cjs --apply --delete-local   # LATER pass
```

- `--apply` migrates every ownerless/unlinked object into the CARETAKER's Drive under `_unowned/…`
  and gives ownerless objects an owner row (the first admin's id). Printout: counts + ids only.
- A Drive-wide problem stops the run (exit 2) — nothing is lost, run it again to resume (completed
  rows are skipped by their recorded ref).
- `--delete-local` is a LATER, second pass: per object it re-checks the row's ref AND re-reads both
  copies (byte-equal) before deleting the MinIO object. Do not run it until an `--apply` report
  shows uploaded+verified with mismatches 0.
- State today (measured 2026-10-11): 260 MinIO objects ≈ 465 MB (story-images 172, story-videos 84,
  story-audio 4, story-comics 0); owner rows 256 (155 images + 68 videos + 1 audio belong to the
  caretaker account; 1 image row belongs to an erased throwaway). Drive has 11 TiB available.

## What to watch after go-live

- `[drive-storage] kept in MinIO only (<reason>)` in the backend/worker logs — the Drive put
  failed; the migration tool or the next same-ref write picks the file up. Repeated `quota` means
  the caretaker's Drive is full.
- The migration report lines are counts only; `problems:` names bucket + kind, never content.

## Tests

- `server/tests/drive.test.js` (17 checks, `npm run test:drive`): boots the REAL server against a
  throwaway Postgres + Redis + MinIO and a FAKE Drive app API — the read path (Drive-served bytes,
  Range, content type), the ref-decides rule (no Drive call for a legacy object, none with storage
  off), the ACL over Drive-held bytes, the 503 on a failing Drive, and the storage seam's unit
  behaviours (owner paths, the ref scheme, idempotency by ref, the caretaker for unlinked owners).
- `server/vendor/drive-client/tests/*.cjs` (3 files, `npm run test:drive-client`) — the vendored
  client's own suites.
- `npm run test:regress` — 305 checks, still green (the media read + upload sites are exercised).
