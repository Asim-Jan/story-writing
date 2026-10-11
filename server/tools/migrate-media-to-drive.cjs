'use strict';
/* tools/migrate-media-to-drive.js: move Story Writing's EXISTING MinIO media into the owners' SAI Drive (STORIES-ON-DRIVE).
 *
 *   DRY RUN (default):  counts only. NO Drive call, works with the flag off (before go-live).
 *   --apply             needs DRIVE_APP_API_SECRET + DRIVE_CARETAKER_SUB in the environment. For every media_owners row
 *                       with NO drive_ref: reads the object from MinIO, PUTs it into the OWNER's Drive (ref
 *                       story:<bucket>:<filename>, tag source, the same path a new upload takes), reads it back and
 *                       verifies size + sha256, then records drive_ref/drive_node/drive_size on the row.
 *                       Asim's call (2026-10-11): everything migrates NOW into the CARETAKER's Drive
 *                       (DRIVE_CARETAKER_SUB), unlinked owners and ownerless objects included, under the path segment
 *                       `_unowned` — ownership is sorted later; the path carries the owner segment first, so re-homing
 *                       is a move. The media_owners row keeps the REAL owner_id when there is one.
 *                       An object with NO owner row gets one (owner = the first admin's id; no admin = skipped, reported).
 *   --verify-only       re-reads every recorded ref from Drive and checks size + sha256 (a later quiet pass; --apply also
 *                       verifies what it just wrote).
 *   --delete-local      DELETES the MinIO copy of a MIGRATED object — only in a SECOND pass (run with --apply), and only
 *                       per object after a fresh re-check: the row must still carry the same drive_ref and Drive must
 *                       still hold the same sha256. Asim decides when to run this.
 *
 * Idempotent (put is idempotent by ref) and resumable per row. Prints COUNTS and ids only — never a title, a file name,
 * an email or a byte of content. A Drive-wide problem (unavailable, full, bin, read-only, wrong secret) STOPS the run
 * (exit 2; run it again to resume — completed rows are skipped by their drive_ref); a problem with ONE object is reported
 * and skipped.
 * Run in the backend pod:
 *   kubectl -n story-writing exec -i deploy/backend -- env MIGRATE_MEDIA_TO_DRIVE_CLI=1 node - --apply < server/tools/migrate-media-to-drive.js
 */
const crypto = require('crypto');

/* The server modules are ESM and the pod's node is 20 (no require(esm)): load them with dynamic import. */
async function loadModules() {
  const tryImport = async (...paths) => { for (const p of paths) { try { return await import(p); } catch (e) { if (!/ERR_MODULE_NOT_FOUND|Cannot find/.test(e.message)) console.error(`import ${p}: ${e.message}`); } } return null; };
  const MEDIA = await tryImport('/app/server/services/mediaStorage.js', '../services/mediaStorage.js');
  const DRIVE = await tryImport('/app/server/services/driveStorage.js', '../services/driveStorage.js');
  const MAPPING = await tryImport('/app/server/utils/mediaMapping.js', '../utils/mediaMapping.js');
  if (!MEDIA || !DRIVE || !MAPPING) { console.error('migrate: could not load mediaStorage/driveStorage/mediaMapping — run this inside the backend image'); process.exit(2); }
  return { MEDIA, DRIVE, MAPPING };
}

let mediaStorage, driveStorage, MAPPING;
const BUCKETS = ['images', 'comics', 'audio', 'videos'];
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY_ONLY = args.includes('--verify-only');
const DELETE_LOCAL = args.includes('--delete-local');
const CARETAKER = process.env.DRIVE_CARETAKER_SUB || '';

if (DELETE_LOCAL && !APPLY) { console.error('--delete-local runs WITH --apply (a second, verifying pass)'); process.exit(2); }

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function bufOf(stream) {
  const chunks = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/* The rows to consider: every media_owners row (with owner + drive state), and — after them —
   the MinIO objects with NO row (listed per bucket, ownerless). */
async function ownedRows() {
  const { getPool } = await import('../db/postgres.js');
  const { rows } = await getPool().query(
    `SELECT bucket_type, filename, owner_id, drive_ref, drive_node, drive_size FROM media_owners ORDER BY created_at`);
  return rows.filter(r => BUCKETS.includes(r.bucket_type));
}

async function allObjects(bucketType) {
  // list via the existing MinIO client (minio's listObjects is an async iterable)
  const bucket = mediaStorage.buckets[bucketType];
  const out = [];
  const it = mediaStorage.client.listObjects(bucket, '', true);
  for await (const o of it) if (o.name) out.push({ name: o.name, size: o.size });
  return out;
}

async function firstAdminId() {
  const { getPool } = await import('../db/postgres.js');
  const { rows } = await getPool().query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  return rows[0] ? rows[0].id : null;
}

async function main() {
  const mods = await loadModules();
  mediaStorage = mods.MEDIA.mediaStorage;
  driveStorage = mods.DRIVE.driveStorage;
  MAPPING = mods.MAPPING;
  if ((APPLY || VERIFY_ONLY) && !driveStorage.initialize()) { console.error('migrate: Drive storage is not enabled in this environment (DRIVE_APP_API_SECRET)'); process.exit(2); }
  if (APPLY && !CARETAKER) { console.error('migrate: DRIVE_CARETAKER_SUB is required (everything lands in that account until ownership is sorted)'); process.exit(2); }
  await mediaStorage.initialize();
  const counts = { rows: 0, withRef: 0, uploaded: 0, verified: 0, mismatches: 0, skipped: 0, deleted: 0, ownerless: 0, noAdmin: 0 };
  const problems = [];
  const stop = (msg) => { console.error(`STOP: ${msg}`); process.exit(2); };

  const rows = await ownedRows();
  counts.rows = rows.length;

  for (const r of rows) {
    if (r.drive_ref) { counts.withRef++; }
    if (VERIFY_ONLY || (r.drive_ref && APPLY && !DELETE_LOCAL)) {
      // verify a recorded ref (or re-verify during an --apply resume)
      const sub = await MAPPING.driveSubOf(r.bucket_type, r.filename);
      if (!sub) { counts.skipped++; problems.push(`${r.bucket_type}/${r.drive_ref}: no owner sub recorded — cannot verify`); continue; }
      const g = await driveStorage.streamFor(sub, r.bucket_type, r.filename);
      if (!g) { counts.mismatches++; problems.push(`${r.bucket_type}: Drive has no copy for a recorded ref`); continue; }
      const got = await bufOf(g.stream);
      const local = r.drive_size == null ? null : Number(r.drive_size);   // pg BIGINT answers as a string
      if (local && got.length !== local) { counts.mismatches++; problems.push(`${r.bucket_type}: size mismatch (row ${local}, Drive ${got.length})`); continue; }
      counts.verified++;
      continue;
    }
    if (!APPLY) continue;   // dry run: counts only
    if (r.drive_ref) continue;   // migrated already (resumable)
    if (DELETE_LOCAL) {
      // the SECOND pass: delete the MinIO copy after a fresh check
      const sub = await MAPPING.driveSubOf(r.bucket_type, r.filename);
      if (!sub) { counts.skipped++; continue; }
      const g = await driveStorage.streamFor(sub, r.bucket_type, r.filename);
      if (!g) { counts.skipped++; problems.push(`${r.bucket_type}: ref recorded but Drive has no copy — NOT deleting the MinIO object`); continue; }
      const got = await bufOf(g.stream);
      const local = await bufOf(await mediaStorage.getStream(mediaStorage.buckets[r.bucket_type], r.filename));
      if (!got.equals(local)) { counts.skipped++; problems.push(`${r.bucket_type}: Drive and MinIO bytes differ — NOT deleting`); continue; }
      await mediaStorage.delete(r.bucket_type, r.filename);
      counts.deleted++;
      continue;
    }
    // the FIRST apply pass: read from MinIO, put into Drive
    let local;
    try { local = await bufOf(await mediaStorage.getStream(mediaStorage.buckets[r.bucket_type], r.filename)); }
    catch (e) { counts.skipped++; problems.push(`${r.bucket_type}: MinIO read failed (${e.code || e.message}) — left in MinIO`); continue; }
    // the OWNER: the caretaker's sub is what the app API call NAMES (Asim's call); the row keeps the real owner_id.
    const res = await driveStorage.put(r.bucket_type, local, r.filename, { portal_sub: CARETAKER });
    if (!res.ok) {
      if (['unavailable', 'busy', 'in_progress', 'quota', 'app_cap', 'frozen', 'bin', 'gone', 'config'].includes(res.reason)) stop(`Drive-wide problem (${res.reason}) — nothing lost, run again to resume`);
      counts.skipped++; problems.push(`${r.bucket_type}: put refused (${res.reason})`); continue;
    }
    const { getPool } = await import('../db/postgres.js');
    await getPool().query(
      `UPDATE media_owners SET drive_ref = $1, drive_node = $2, drive_size = $3, drive_owner = $4 WHERE bucket_type = $5 AND filename = $6`,
      [res.ref, res.node, res.size, res.ownerSub, r.bucket_type, r.filename]);
    counts.uploaded++;
  }

  {
    // the ownerless objects: counted always, assigned + migrated under --apply (Asim's call)
    for (const bt of BUCKETS) {
      const listed = await allObjects(bt);
      const known = new Set(rows.filter(r => r.bucket_type === bt).map(r => r.filename));
      for (const o of listed) {
        if (known.has(o.name)) continue;
        counts.ownerless++;
        if (!APPLY || DELETE_LOCAL) continue;
        let local;
        try { local = await bufOf(await mediaStorage.getStream(mediaStorage.buckets[bt], o.name)); }
        catch (e) { counts.skipped++; problems.push(`${bt}: ownerless object unreadable (${e.code || e.message})`); continue; }
        const adminId = await firstAdminId();
        if (!adminId) { counts.noAdmin++; continue; }
        const { getPool } = await import('../db/postgres.js');
        await MAPPING.recordMediaOwner(bt, o.name, { ownerId: adminId });
        const res = await driveStorage.put(bt, local, o.name, { portal_sub: CARETAKER });
        if (!res.ok) {
          if (['unavailable', 'busy', 'in_progress', 'quota', 'app_cap', 'frozen', 'bin', 'gone', 'config'].includes(res.reason)) stop(`Drive-wide problem (${res.reason}) — nothing lost, run again to resume`);
          counts.skipped++; problems.push(`${bt}: ownerless put refused (${res.reason})`); continue;
        }
        await getPool().query(`UPDATE media_owners SET drive_ref = $1, drive_node = $2, drive_size = $3, drive_owner = $4 WHERE bucket_type = $5 AND filename = $6`,
          [res.ref, res.node, res.size, res.ownerSub, bt, o.name]);
        counts.uploaded++;
      }
    }
  }

  console.log(`migrate-media-to-drive: rows=${counts.rows} withRef=${counts.withRef} uploaded=${counts.uploaded} verified=${counts.verified} mismatches=${counts.mismatches} ownerless=${counts.ownerless} deleted=${counts.deleted} skipped=${counts.skipped}${counts.noAdmin ? ` noAdmin=${counts.noAdmin}` : ''}`);
  if (problems.length) { console.log('problems:'); for (const p of problems.slice(0, 20)) console.log(` - ${p}`); }
  process.exit(counts.mismatches ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
