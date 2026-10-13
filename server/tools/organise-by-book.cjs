'use strict';
/* tools/organise-by-book.cjs: ONE-PASS organisation of the caretaker's migrated media into BOOK folders.
 *
 * Asim's call (2026-10-11): a book's files live in "<safe title> (<id8>)/<Folder>/<file>" so a whole
 * book is one grab; the readable name + the short id are both stable-enough (a title rename is just a
 * move — the ref, not the path, is the address). The 13 bookless objects (standalone generations) are
 * DELETED on his explicit say-so (Drive copy to the Bin, the row forgotten; MinIO is retired since 2.23.79).
 *
 *   DRY RUN (default):  counts + the per-book breakdown, no Drive call, no delete.
 *   --apply             per book-bound row: stat by ref -> PATCH parentPath to the book folder
 *                       (intermediates auto-create; a node already in place is left alone).
 *                       Per bookless row: remove the Drive copy (to the Bin), forget the row.
 *   A Drive-wide problem stops the run (exit 2, nothing lost, resumable).
 *
 * Run in the backend pod:
 *   kubectl -n story-writing exec -i deploy/backend -- env MIGRATE_MEDIA_TO_DRIVE_CLI=1 \
 *     DRIVE_CARETAKER_SUB=u_f37d34dea1d20271 node server/tools/organise-by-book.cjs [--apply]
 */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

/* The server modules are ESM and the pod's node is 20 (no require(esm)): load with dynamic import. */
async function loadModules() {
  const tryImport = async (...paths) => { for (const p of paths) { try { return await import(p); } catch (e) { if (!/ERR_MODULE_NOT_FOUND|Cannot find/.test(e.message)) console.error(`import ${p}: ${e.message}`); } } return null; };
  const DRIVE = await tryImport('/app/server/services/driveStorage.js', '../services/driveStorage.js');
  const MAPPING = await tryImport('/app/server/utils/mediaMapping.js', '../utils/mediaMapping.js');
  const MEDIA = await tryImport('/app/server/services/mediaStorage.js', '../services/mediaStorage.js');
  const PG = await tryImport('/app/server/db/postgres.js', '../db/postgres.js');
  if (!DRIVE || !MAPPING || !MEDIA || !PG) { console.error('organise: could not load the server modules — run this inside the backend image'); process.exit(2); }
  return { driveStorage: DRIVE.driveStorage, MAPPING, mediaStorage: MEDIA.mediaStorage, getPool: PG.getPool };
}

const FOLDER = { images: 'Covers', comics: 'Books', audio: 'Audio', videos: 'Films' };

async function main() {
  const { driveStorage, MAPPING, mediaStorage, getPool } = await loadModules();
  if (!driveStorage.initialize()) { console.error('organise: Drive storage is not enabled here'); process.exit(2); }
  const caretaker = process.env.DRIVE_CARETAKER_SUB || '';
  if (!caretaker) { console.error('organise: DRIVE_CARETAKER_SUB is required'); process.exit(2); }

  const { rows } = await getPool().query(
    `SELECT m.bucket_type, m.filename, m.book_id, m.drive_ref, m.drive_node, m.drive_owner, b.title
     FROM media_owners m LEFT JOIN books b ON b.id = m.book_id WHERE m.drive_ref IS NOT NULL`);
  const counts = { rows: rows.length, bookBound: 0, bookless: 0, moved: 0, inPlace: 0, deleted: 0, skipped: 0 };
  const problems = [];
  const perBook = new Map();

  for (const r of rows) {
    const folder = FOLDER[r.bucket_type] || r.bucket_type;
    if (!r.book_id) {
      counts.bookless++;
      if (!APPLY) continue;
      try {
        const owner = r.drive_owner || caretaker;
        const st = await driveStorage.statFor(owner, r.bucket_type, r.filename);
        if (st) await driveStorage.client.forUser(owner).remove('story-writing', st.id, { bin: true });
        await getPool().query(`DELETE FROM media_owners WHERE bucket_type = $1 AND filename = $2`, [r.bucket_type, r.filename]);
        counts.deleted++;
      } catch (e) {
        if (e && (e.code === 'unavailable' || e.code === 'busy' || e.code === 'in_progress')) { console.error(`STOP: Drive-wide problem (${e.code})`); process.exit(2); }
        counts.skipped++; problems.push(`${r.bucket_type}/${r.filename}: bookless delete failed (${e && e.code})`);
      }
      continue;
    }
    counts.bookBound++;
    const book = { id: r.book_id, title: r.title };
    const wantSeg = driveStorage.bookFolder(book.id, book.title);
    perBook.set(wantSeg, (perBook.get(wantSeg) || 0) + 1);
    if (!APPLY) continue;
    try {
      const owner = r.drive_owner || caretaker;
      const stat = await driveStorage.statFor(owner, r.bucket_type, r.filename);
      if (!stat) { counts.skipped++; problems.push(`${r.bucket_type}/${r.drive_ref}: Drive has no copy`); continue; }
      const wantPath = `${wantSeg}/${folder}/${r.filename}`;
      if (stat.path === wantPath) { counts.inPlace++; continue; }
      await driveStorage.client.forUser(owner).patch('story-writing', stat.id, { parentPath: `${wantSeg}/${folder}` });
      counts.moved++;
    } catch (e) {
      if (e && (e.code === 'unavailable' || e.code === 'busy' || e.code === 'in_progress')) { console.error(`STOP: Drive-wide problem (${e.code})`); process.exit(2); }
      counts.skipped++; problems.push(`${r.bucket_type}: move failed (${e && e.code})`);
    }
  }

  console.log(`organise-by-book: rows=${counts.rows} bookBound=${counts.bookBound} booklessDeleted=${counts.deleted} moved=${counts.moved} inPlace=${counts.inPlace} skipped=${counts.skipped}`);
  for (const [b, n] of [...perBook.entries()].sort((a, c) => c[1] - a[1])) console.log(`  ${b}: ${n} files`);
  if (problems.length) { console.log('problems:'); for (const p of problems.slice(0, 20)) console.log(` - ${p}`); }
  process.exit(counts.skipped ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
