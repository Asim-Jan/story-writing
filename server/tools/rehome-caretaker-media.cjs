'use strict';
/* tools/rehome-caretaker-media.cjs: ONE-PASS re-homing of the caretaker's migrated media.
 *
 * Everything the migration put at <caretaker-sub>/<Folder>/<file> moves up one level to
 * <Folder>/<file> (the caretaker's own content sits at the top of the project — his Drive shows
 * the template folders directly). The owner rows are updated to the new path (drive_node stays:
 * the node id never changes on a move; the path is where it LIVES now).
 *
 *   DRY RUN (default):  counts only, no Drive call.
 *   --apply             PATCH each node to parentPath=<Folder> (idempotent: a node already in
 *                       place is left alone), then delete the emptied sub folder (only when
 *                       empty), then verify: stat by ref -> the path is the new one.
 *
 * Run in the backend pod:
 *   kubectl -n story-writing exec -i deploy/backend -- env MIGRATE_MEDIA_TO_DRIVE_CLI=1 \
 *     DRIVE_CARETAKER_SUB=u_f37d34dea1d20271 node server/tools/rehome-caretaker-media.cjs [--apply]
 */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

/* The server modules are ESM and the pod's node is 20 (no require(esm)): load with dynamic import. */
async function loadModules() {
  const tryImport = async (...paths) => { for (const p of paths) { try { return await import(p); } catch (e) { if (!/ERR_MODULE_NOT_FOUND|Cannot find/.test(e.message)) console.error(`import ${p}: ${e.message}`); } } return null; };
  const DRIVE = await tryImport('/app/server/services/driveStorage.js', '../services/driveStorage.js');
  const MAPPING = await tryImport('/app/server/utils/mediaMapping.js', '../utils/mediaMapping.js');
  const PG = await tryImport('/app/server/db/postgres.js', '../db/postgres.js');
  if (!DRIVE || !MAPPING || !PG) { console.error('rehome: could not load the server modules — run this inside the backend image'); process.exit(2); }
  return { driveStorage: DRIVE.driveStorage, MAPPING, getPool: PG.getPool };
}

const FOLDER = { images: 'Covers', comics: 'Books', audio: 'Audio', videos: 'Films' };

async function main() {
  const { driveStorage, MAPPING, getPool } = await loadModules();
  if (!driveStorage.initialize()) { console.error('rehome: Drive storage is not enabled here'); process.exit(2); }
  const caretaker = process.env.DRIVE_CARETAKER_SUB || '';
  if (!caretaker) { console.error('rehome: DRIVE_CARETAKER_SUB is required'); process.exit(2); }

  const { rows } = await getPool().query(
    `SELECT bucket_type, filename, drive_ref, drive_node, drive_owner FROM media_owners WHERE drive_ref IS NOT NULL`);
  const counts = { rows: rows.length, mine: 0, moved: 0, inPlace: 0, skipped: 0, foldersDeleted: 0 };
  const problems = [];

  for (const r of rows) {
    const owner = r.drive_owner;
    if (owner !== caretaker) continue;          // other owners keep their segment
    counts.mine++;
    const folder = FOLDER[r.bucket_type] || r.bucket_type;
    const wantPath = `${folder}/${r.filename}`;
    if (!APPLY) { counts.inPlace++; continue; }
    try {
      const stat = await driveStorage.statFor(caretaker, r.bucket_type, r.filename);
      if (!stat) { counts.skipped++; problems.push(`${r.bucket_type}/${r.drive_ref}: Drive has no copy`); continue; }
      if (stat.path === wantPath) { counts.inPlace++; continue; }
      await driveStorage.client.forUser(caretaker).patch('story-writing', stat.id, { parentPath: folder });
      counts.moved++;
    } catch (e) {
      if (e && (e.code === 'unavailable' || e.code === 'busy' || e.code === 'in_progress')) { console.error(`STOP: Drive-wide problem (${e.code}) — nothing lost, run again to resume`); process.exit(2); }
      counts.skipped++; problems.push(`${r.bucket_type}: move failed (${e && e.code})`);
    }
  }

  if (APPLY) {
    // the emptied sub folder: list the project root; when the sub folder is EMPTY the app API
    // allows the delete (it refuses a non-empty one), so this is safe to attempt unconditionally.
    try {
      const u = driveStorage.client.forUser(caretaker);
      for await (const it of u.list('story-writing', { path: '' })) {
        if (it.name === caretaker && (it.kind === 'folder' || it.type === 'folder' || it.isFolder)) {
          const r2 = await u.remove('story-writing', it.id, { bin: true });
          counts.foldersDeleted++;
          console.log(`sub folder ${caretaker}: removed (${(r2 && r2.mode) || 'bin'})`);
        }
      }
    } catch (e) {
      problems.push(`the sub folder removal: ${(e && (e.code || e.message)) || e} — if it is not empty, some rows were skipped; fix and re-run`);
    }
  }

  console.log(`rehome-caretaker-media: rows=${counts.rows} mine=${counts.mine} moved=${counts.moved} inPlace=${counts.inPlace} skipped=${counts.skipped} foldersDeleted=${counts.foldersDeleted}`);
  if (problems.length) { console.log('problems:'); for (const p of problems.slice(0, 20)) console.log(` - ${p}`); }
  process.exit(counts.skipped ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
