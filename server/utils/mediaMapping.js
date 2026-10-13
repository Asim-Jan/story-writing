/**
 * Media ownership
 *
 * Who may read or delete a stored media object (the bytes live in the owner's SAI Drive). Durable, in Postgres (`media_owners`), and checked
 * FAIL-CLOSED: an object with no owner row is refused to everyone but an admin and the caretaker.
 *
 * This replaced a Redis key per object with a 30-day TTL that failed OPEN: a missing key (expired,
 * evicted by allkeys-lru, never written by half the upload routes, or a Redis error) let any
 * signed-in user read any file, and the Redis client had no error listener, so a Redis restart
 * crashed the API process.
 */

import { getPool } from '../db/postgres.js';

let ready = null;

export function ensureMediaOwnersTable() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS media_owners (
        bucket_type VARCHAR(20)  NOT NULL,
        filename    VARCHAR(500) NOT NULL,
        owner_id    UUID         NOT NULL,
        book_id     UUID,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (bucket_type, filename)
      );
      CREATE INDEX IF NOT EXISTS idx_media_owners_owner ON media_owners(owner_id);
      CREATE INDEX IF NOT EXISTS idx_media_owners_book ON media_owners(book_id);
    `).catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/**
 * Record who owns an object. First writer wins: re-recording an existing name never moves it to
 * another owner. `drive` (from mediaStorage.upload's result, STORIES-ON-DRIVE) carries the asset's
 * SAI Drive reference — written on the FIRST insert and also on an existing row whose drive_ref
 * is still NULL (the owner row may predate the Drive copy; the ref is a fact about the file, not
 * a choice, so a later re-record with a ref fills it in).
 */
export async function recordMediaOwner(bucketType, filename, { ownerId, bookId = null, drive = null }) {
  if (!ownerId || !bucketType || !filename) return;
  try {
    await ensureMediaOwnersTable();
    if (drive && drive.ok) {
      await getPool().query(
        `INSERT INTO media_owners (bucket_type, filename, owner_id, book_id, drive_ref, drive_node, drive_size, drive_owner)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bucket_type, filename) DO UPDATE
           SET drive_ref = COALESCE(media_owners.drive_ref, EXCLUDED.drive_ref),
               drive_node = COALESCE(media_owners.drive_node, EXCLUDED.drive_node),
               drive_size = COALESCE(media_owners.drive_size, EXCLUDED.drive_size),
               drive_owner = COALESCE(media_owners.drive_owner, EXCLUDED.drive_owner)`,
        [bucketType, filename, ownerId, isUuid(bookId) ? bookId : null, drive.ref, drive.node, drive.size, drive.ownerSub]
      );
    } else {
      await getPool().query(
        `INSERT INTO media_owners (bucket_type, filename, owner_id, book_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (bucket_type, filename) DO NOTHING`,
        [bucketType, filename, ownerId, isUuid(bookId) ? bookId : null]
      );
    }
  } catch (error) {
    console.error('Failed to record media owner:', error.message);
  }
}

/**
 * The sub whose Drive holds an asset's bytes. The row's drive_owner is the truth (it is the
 * account the bytes were ACTUALLY written into — the caretaker for everything migrated before
 * ownership is sorted); the uploader's portal_sub is only the fallback for rows recorded before
 * drive_owner existed.
 */
export async function driveSubOf(bucketType, filename) {
  try {
    await ensureMediaOwnersTable();
    const r = await getPool().query(
      `SELECT m.drive_owner, u.portal_sub
       FROM media_owners m LEFT JOIN users u ON u.id = m.owner_id
       WHERE m.bucket_type = $1 AND m.filename = $2 AND m.drive_ref IS NOT NULL`,
      [bucketType, filename]
    );
    const row = r.rows[0];
    if (!row) return null;
    for (const sub of [row.drive_owner, row.portal_sub]) {
      if (/^u_[a-f0-9]{16}$/.test(sub || '')) return sub;
    }
    return null;
  } catch (error) {
    console.error('Failed to resolve the Drive owner:', error.message);
    return null;
  }
}

/** The Drive node id recorded for an object (null = none recorded): the delete's fallback when the ref no longer answers. */
export async function driveNodeOf(bucketType, filename) {
  try {
    await ensureMediaOwnersTable();
    const r = await getPool().query('SELECT drive_node FROM media_owners WHERE bucket_type = $1 AND filename = $2', [bucketType, filename]);
    return (r.rows[0] && r.rows[0].drive_node) || null;
  } catch (error) {
    console.error('Failed to resolve the Drive node:', error.message);
    return null;
  }
}

/**
 * Legacy callback shape used by mediaStorage.upload(..., setMediaBookMapping): the owner is the
 * book's owner.
 */
export async function setMediaBookMapping(bucketType, filename, bookId) {
  if (!isUuid(bookId)) return;
  try {
    const r = await getPool().query('SELECT owner_id FROM books WHERE id = $1', [bookId]);
    if (r.rows[0]) await recordMediaOwner(bucketType, filename, { ownerId: r.rows[0].owner_id, bookId });
  } catch (error) {
    console.error('Failed to set media mapping:', error.message);
  }
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Can this user read (mode 'read') or delete (mode 'delete') the object?
 * read:   owner, the owning book's owner, a collaborator on that book, or an admin.
 * delete: owner, the owning book's owner, or an admin.
 */
export async function canAccessMedia(user, bucketType, filename, mode = 'read') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const userId = user.id || user.userId;
  await ensureMediaOwnersTable();
  const pool = getPool();

  const row = (await pool.query(
    `SELECT m.owner_id, m.book_id, b.owner_id AS book_owner
       FROM media_owners m LEFT JOIN books b ON b.id = m.book_id
      WHERE m.bucket_type = $1 AND m.filename = $2`,
    [bucketType, filename]
  )).rows[0];

  if (row) {
    if (row.owner_id === userId || row.book_owner === userId) return true;
    if (mode !== 'read' || !row.book_id) return false;
    const collab = await pool.query(
      'SELECT 1 FROM collaborators WHERE book_id = $1 AND lower(email) = lower($2) LIMIT 1',
      [row.book_id, user.email || '']
    ).catch(() => ({ rows: [] }));
    return collab.rows.length > 0;
  }

  /* No owner row. This used to fall back to "a book of yours mentions the file name" and then RECORD the
     requester as the owner: any user who pasted a file name into their own book's text became able to
     read AND delete an object that was not theirs. Every object Stories stores now gets its row when it
     is written, and the migration gave every legacy object one, so a row-less object is refused for
     everyone but the caretaker (whose Drive holds ownerless objects) and admins (above). Logged, with no
     file name, so a real gap shows up. */
  const caretaker = process.env.DRIVE_CARETAKER_SUB || '';
  if (caretaker && user.portal_sub === caretaker) return true;
  console.warn(`[media] refused ${mode} of a ${bucketType} object that has no ownership row (user ${userId})`);
  return false;
}

export async function forgetMediaOwner(bucketType, filename) {
  try {
    await getPool().query('DELETE FROM media_owners WHERE bucket_type = $1 AND filename = $2', [bucketType, filename]);
  } catch (error) {
    console.error('Failed to forget media owner:', error.message);
  }
}

/* Kept for callers that still import it; ownership lives in Postgres now. */
export async function getMediaBookMapping(bucketType, filename) {
  try {
    await ensureMediaOwnersTable();
    const r = await getPool().query('SELECT book_id FROM media_owners WHERE bucket_type = $1 AND filename = $2', [bucketType, filename]);
    return r.rows[0]?.book_id || null;
  } catch {
    return null;
  }
}
