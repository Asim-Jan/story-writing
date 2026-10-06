/**
 * Media ownership
 *
 * Who may read or delete an object in MinIO. Durable, in Postgres (`media_owners`), and checked
 * FAIL-CLOSED: an object with no owner row is readable only by a user whose own book references it
 * (the row is then backfilled), or by an admin.
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
 * another owner.
 */
export async function recordMediaOwner(bucketType, filename, { ownerId, bookId = null }) {
  if (!ownerId || !bucketType || !filename) return;
  try {
    await ensureMediaOwnersTable();
    await getPool().query(
      `INSERT INTO media_owners (bucket_type, filename, owner_id, book_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (bucket_type, filename) DO NOTHING`,
      [bucketType, filename, ownerId, isUuid(bookId) ? bookId : null]
    );
  } catch (error) {
    console.error('Failed to record media owner:', error.message);
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

  // No owner row: an object from before ownership was recorded. Allow it only if one of the user's
  // own books references the file, and record that so the search runs once per object.
  const like = '%' + filename.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const hit = (await pool.query(
    `SELECT b.id FROM books b
      WHERE b.owner_id = $1 AND b.deleted_at IS NULL
        AND (b::text LIKE $2 OR EXISTS (SELECT 1 FROM chapters c WHERE c.book_id = b.id AND c::text LIKE $2))
      LIMIT 1`,
    [userId, like]
  )).rows[0];
  if (!hit) return false;
  await recordMediaOwner(bucketType, filename, { ownerId: userId, bookId: hit.id });
  return true;
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
