import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { driveStorage } from './driveStorage.js';

dotenv.config();

/**
 * Media Storage: the person's SAI Drive is the ONLY store (MinIO retired in 2.23.79).
 *
 * Until 2.23.76 this class spoke MinIO (or S3) and Drive was layered on top. The migration is
 * finished (every media_owners row with bytes carries a drive_ref, MinIO's buckets are empty and
 * its StatefulSet is at 0), so MinIO and S3 are gone from the code: no client, no bucket check at
 * boot, no MINIO_* requirement. Every byte goes through driveStorage (the app API client the app
 * already used for its Drive-first uploads).
 *
 *   upload()      put into the owner's Drive and record media_owners.drive_ref (+ node, size, owner)
 *   open()        the Drive read for the HTTP route (Range pass-through, content type, status)
 *   getStream()   a Node Readable of the whole object (never buffered here)
 *   downloadTo()  stream an object to a local file (films, clips, music: never held in memory)
 *   getFile()     a Buffer, for SMALL objects only (a reference image, a voice sample), size-capped
 *   delete()      the Drive copy (to the holder's Bin; the erasure flow passes the holder it resolved)
 *
 * Whose Drive holds an object: media_owners.drive_owner, else the uploader's portal_sub (driveSubOf),
 * else the CARETAKER (DRIVE_CARETAKER_SUB: where an ownerless upload lands, driveStorage.subOf).
 * The ref (story:<bucketType>:<filename>) is the address; the browser never sees a Drive id or path.
 *
 * Errors carry `code` and `status`: NotFound/404 (no copy anywhere), storage_unavailable/503 (Drive
 * down or not configured: retry), infected/451 (the scanner flagged it), quota/413 (Drive refused the
 * size). Never a MinIO error, never ENOTFOUND for a host that no longer exists.
 */

export const BUCKET_TYPES = ['images', 'audio', 'comics', 'videos'];

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
export const contentTypeOf = (filename) => CONTENT_TYPES[path.extname(String(filename)).toLowerCase()] || 'application/octet-stream';

const TOO_BIG = new Set(['quota', 'app_cap', 'file_too_large']);

/** A storage error the routes can map without knowing Drive: { code, status, retryable }. */
export function storageError(message, { code = 'storage_unavailable', status = 503, cause } = {}) {
  return Object.assign(new Error(message), { code, status, retryable: status === 503, ...(cause ? { cause } : {}) });
}

/* A Drive client error -> a storage error (NotFound / infected / too big / unavailable). */
function fromDrive(error, what) {
  if (error && error.status && ['NotFound', 'infected', 'quota', 'storage_unavailable', 'too_large'].includes(error.code)) return error;
  const c = error && error.code;
  if (c === 'not_found') return storageError(`${what}: not found`, { code: 'NotFound', status: 404, cause: error });
  if (c === 'infected') return storageError(`${what}: failed the malware scan`, { code: 'infected', status: 451, cause: error });
  if (TOO_BIG.has(c)) return storageError(`${what}: the store refused the size (${c})`, { code: 'quota', status: 413, cause: error });
  return storageError(`${what}: storage temporarily unavailable (${c || (error && error.message) || 'error'})`, { cause: error });
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* The database-backed lookups, loaded lazily so a unit test (or a tool) can inject its own. */
const defaultDeps = {
  async ownerSubOf(bucketType, filename) {
    const { driveSubOf } = await import('../utils/mediaMapping.js');
    return driveSubOf(bucketType, filename);
  },
  async recordOwner(bucketType, filename, rec) {
    const { recordMediaOwner } = await import('../utils/mediaMapping.js');
    return recordMediaOwner(bucketType, filename, rec);
  },
  async bookOf(bookId) {
    if (!isUuid(bookId)) return null;
    try {
      const { getPool } = await import('../db/postgres.js');
      const r = await getPool().query('SELECT id, title FROM books WHERE id = $1', [bookId]);
      return r.rows[0] || null;
    } catch (e) {
      console.warn('[media] book lookup failed:', e.message);
      return null;
    }
  },
};

export class MediaStorage {
  /** No configuration is required to construct (the Drive client is built on first use). */
  constructor({ drive = driveStorage, deps = {} } = {}) {
    this.drive = drive;
    this.deps = { ...defaultDeps, ...deps };
    // Kept for callers that index by bucket type: the "bucket" is the bucket type now (Drive has no buckets).
    this.buckets = Object.fromEntries(BUCKET_TYPES.map(t => [t, t]));
  }

  /** Drive storage is configured (DRIVE_APP_API_SECRET set, STORY_DRIVE not "0"). */
  get driveEnabled() {
    return this.drive.initialize() !== null && !!this.drive.enabled;
  }

  /** Nothing to create at boot (kept so an older caller keeps working). Never touches the network. */
  async initialize() {}

  _type(bucketType) {
    if (!BUCKET_TYPES.includes(bucketType)) throw storageError(`Invalid bucket type: ${bucketType}`, { code: 'bad_request', status: 400 });
  }

  /**
   * Store a buffer in the owner's SAI Drive.
   * @param {string} bucketType  'images' | 'audio' | 'comics' | 'videos'
   * @param {Buffer} buffer
   * @param {string} filename    the server-chosen name (the ref is story:<bucketType>:<filename>)
   * @param {Object} metadata    legacy object metadata; only metadata.bookId is still read
   * @param {Function} setMapping legacy owner callback, used only when the owner cannot be resolved
   * @param {Object} opts        { driveUser (a user row with portal_sub: the OWNER), bookId, driveBook }
   *   No driveUser: the book's owner when a bookId is known, else the caretaker's Drive.
   * The media_owners row (owner + drive_ref) is recorded HERE whenever the owner is known, so a
   * caller that forgets to record the ref can never leave an unreadable object behind.
   * Throws a storage error (503 retryable, 413 too big); there is no other store to fall back to.
   */
  async upload(bucketType, buffer, filename, metadata = {}, setMapping = null, opts = {}) {
    this._type(bucketType);
    if (!this.driveEnabled) throw storageError('Failed to upload to storage: media storage (SAI Drive) is not configured');
    const contentType = contentTypeOf(filename);
    const bookId = opts.bookId || (metadata && metadata.bookId) || null;
    const book = opts.driveBook || (bookId ? await this.deps.bookOf(bookId) : null);
    let owner = opts.driveUser || (bookId && this.drive.ownerOfBook ? await this.drive.ownerOfBook(bookId) : null);
    // a caller that knows only the user's id (an API-key request: { userId }) still writes into THAT
    // person's Drive, not the caretaker's: the row carries the portal_sub
    if (owner && !owner.portal_sub && !owner.sub && (owner.id || owner.userId) && this.drive.userFromId) {
      owner = (await this.drive.userFromId(owner.id || owner.userId)) || owner;
    }

    const drive = await this.drive.put(bucketType, buffer, filename, owner, book);
    if (!drive || !drive.ok) {
      const reason = (drive && drive.reason) || 'error';
      const tooBig = TOO_BIG.has(reason);
      throw storageError(`Failed to upload to storage: SAI Drive refused the file (${reason})`,
        { code: tooBig ? 'quota' : 'storage_unavailable', status: tooBig ? 413 : 503 });
    }
    console.log(`✓ Stored in SAI Drive: ${drive.path}`);

    const ownerId = owner && (owner.id || owner.userId);
    if (ownerId) {
      await this.deps.recordOwner(bucketType, filename, { ownerId, bookId: isUuid(bookId) ? bookId : null, drive });
    } else if (bookId && typeof setMapping === 'function') {
      await setMapping(bucketType, filename, bookId);
    }
    return { storageKey: `${bucketType}/${filename}`, bucket: bucketType, filename, size: buffer.length, contentType, drive };
  }

  /** The sub whose Drive holds the object: the recorded owner, else the caretaker (null = nobody). */
  async holderOf(bucketType, filename) {
    return (await this.deps.ownerSubOf(bucketType, filename)) || this.drive.caretaker || null;
  }

  /**
   * Open an object for reading: { stream, contentType, size, contentRange, status }.
   * `range` is passed through to Drive (a 206 comes back with contentRange). Touch `.stream` ONCE.
   */
  async open(bucketType, filename, { range } = {}) {
    this._type(bucketType);
    if (!this.driveEnabled) throw storageError('Media storage (SAI Drive) is not configured');
    const holder = await this.holderOf(bucketType, filename);
    if (!holder) throw storageError(`${bucketType}/${filename}: not found`, { code: 'NotFound', status: 404 });
    let g;
    try {
      g = await this.drive.streamFor(holder, bucketType, filename, range);
    } catch (error) {
      throw fromDrive(error, `${bucketType}/${filename}`);
    }
    if (!g) throw storageError(`${bucketType}/${filename}: not found`, { code: 'NotFound', status: 404 });
    return g;
  }

  /** The whole object as a Node Readable (streamed from Drive, never buffered here). */
  async getStream(bucketType, filename) {
    const g = await this.open(bucketType, filename);
    return g.stream;
  }

  /** Stream an object into a local file (videos, music, voice-overs: never held in memory). */
  async downloadTo(bucketType, filename, destPath) {
    const stream = await this.getStream(bucketType, filename);
    try {
      await pipeline(stream, fs.createWriteStream(destPath));
    } catch (error) {
      throw fromDrive(error, `${bucketType}/${filename}`);
    }
    return destPath;
  }

  /**
   * A SMALL object as a Buffer (a reference picture, a voice sample). maxBytes (default 64 MiB)
   * stops reading past the cap, so a mistaken call on a film can never fill the heap.
   */
  async getFile(bucketType, filename, { maxBytes = 64 * 1024 * 1024 } = {}) {
    const stream = await this.getStream(bucketType, filename);
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy();
          throw storageError(`${bucketType}/${filename} is larger than ${maxBytes} bytes`, { code: 'too_large', status: 413 });
        }
        chunks.push(chunk);
      }
    } catch (error) {
      throw fromDrive(error, `${bucketType}/${filename}`);
    }
    return Buffer.concat(chunks);
  }

  /** Does Drive hold the object? */
  async exists(bucketType, filename) {
    this._type(bucketType);
    if (!this.driveEnabled) return false;
    const holder = await this.holderOf(bucketType, filename);
    if (!holder) return false;
    try {
      return !!(await this.drive.statFor(holder, bucketType, filename));
    } catch (error) {
      throw fromDrive(error, `${bucketType}/${filename}`);
    }
  }

  /**
   * Delete the Drive copy. → { removed: true, mode } | { gone: true } (no copy: nothing to do).
   * opts.sub: the holder the caller already resolved (the erasure flow reads its rows itself).
   * opts.permanent: the erasure flow (an untouched intermediate goes for good; every other file goes
   * to the holder's Bin, which Drive empties after 30 days). A transport error THROWS (a delete must
   * not lie about what it deleted); a missing or already-gone copy does not.
   */
  async delete(bucketType, filename, { sub, permanent = false } = {}) {
    this._type(bucketType);
    if (!this.driveEnabled) throw storageError('Media storage (SAI Drive) is not configured');
    const holder = sub || await this.holderOf(bucketType, filename);
    if (!holder) return { gone: true };
    try {
      const r = await this.drive.removeFor(holder, bucketType, filename, { permanent });
      if (!r) return { gone: true };
      console.log(`✓ Deleted from SAI Drive: ${bucketType}/${filename}`);
      return { removed: true, mode: r.mode || null };
    } catch (error) {
      if (error && (error.code === 'not_found' || error.code === 'gone')) return { gone: true };
      throw fromDrive(error, `${bucketType}/${filename}`);
    }
  }
}

// Singleton instance
export const mediaStorage = new MediaStorage();
