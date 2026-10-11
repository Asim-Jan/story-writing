/**
 * Drive storage for Story Writing (STORIES-ON-DRIVE).
 *
 * Story Writing's generated media (images, comics, audio, videos) lives IN the person's SAI Drive,
 * in the `story-writing` project folder, through Drive's app API (/app/v1, APP-API.md) — the same
 * pattern the portal's film studio uses (portal mediastore.js). Stories keeps only REFERENCES
 * (ref + node id + size) in `media_owners`; Drive holds the bytes and is the system of record.
 * Asim's decisions 2026-10-11: everything migrates into HIS Drive now, ownership sorted later;
 * new uploads are Drive-primary immediately; MinIO serves the not-yet-migrated reads.
 *
 * Layout inside the project:
 *   <owner segment>/<folder>/<filename>     owner segment = the Drive owner's sub (u_<16 hex>).
 *   Asim's sub is the CARETAKER for the migrated objects whose real owner is not known yet
 *   (unlinked users, ownerless objects): DRIVE_CARETAKER_SUB, path segment `_unowned`.
 * ref = story:<bucketType>:<filename>       globally unique (media_owners' PK is that pair).
 * tag = source                              every file here is one a feature needs to keep working.
 *
 * Folder per bucket type: images→Covers, comics→Comics, audio→Audio, videos→Films.
 *
 * Reads stream from Drive with Range pass-through; the browser never sees a Drive id, ref or path.
 * An asset without a recorded drive_ref is MinIO's — the ref decides, never a flag.
 *
 * OFF (no DRIVE_APP_API_SECRET, or STORY_DRIVE=0): every call answers null / {ok:false} and the
 * MinIO path behaves exactly as before. Never throws from a Drive outage: a generation that
 * already succeeded must not fail because its Drive put did not.
 */

import { createRequire as _driveRequire } from 'module';

const _driveClient = _driveRequire(import.meta.url)('../vendor/drive-client/index.cjs');
const { createDriveClient } = _driveClient;

const PROJECT = 'story-writing';
const TAG = 'source';
const UNOWNED = '_unowned';

const FOLDER = {
  images: 'Covers',
  comics: 'Comics',
  audio: 'Audio',
  videos: 'Films',
};

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

class DriveStorage {
  constructor() {
    this.client = null;
    this.enabled = false;
    this.caretaker = null;
  }

  /** Build the client once. A missing secret or STORY_DRIVE=0 leaves it disabled (never throws). */
  initialize() {
    if (this.enabled) return this.client;
    const secret = process.env.DRIVE_APP_API_SECRET;
    if (!secret || process.env.STORY_DRIVE === '0') return null;
    try {
      this.client = createDriveClient({
        base: process.env.DRIVE_APP_API_URL || 'http://sai-drive-api.sai-drive.svc.cluster.local',
        appId: 'stories',
        appSecret: secret,
      });
      this.caretaker = process.env.DRIVE_CARETAKER_SUB || null;
      this.enabled = true;
      console.log(`[drive-storage] Story Writing media is stored in the person's SAI Drive (project ${PROJECT})`);
    } catch (error) {
      console.error('[drive-storage] disabled:', error.message);
    }
    return this.client;
  }

  /** The sub whose Drive holds this asset: the uploader's portal_sub, else the caretaker's. */
  subOf(user) {
    const sub = user && (user.portal_sub || user.sub);
    return /^u_[a-f0-9]{16}$/.test(sub || '') ? sub : this.caretaker;
  }

  /**
   * The uploader's user row from a Stories user id (the job processors know only that id).
   * Used to pass { driveUser } from a job; the ROW is what put() reads the portal_sub from.
   */
  async userFromId(userId) {
    if (!userId) return null;
    try {
      const { getPool } = await import('../db/postgres.js');
      const r = await getPool().query('SELECT id, portal_sub FROM users WHERE id = $1', [userId]);
      return r.rows[0] || null;
    } catch (error) {
      console.error('[drive-storage] cannot resolve the uploader:', error.message);
      return null;
    }
  }

  /** The book owner's row (the video pipeline knows a bookId, not a user). */
  async ownerOfBook(bookId) {
    if (!bookId) return null;
    try {
      const { getPool } = await import('../db/postgres.js');
      const r = await getPool().query(
        `SELECT u.id, u.portal_sub FROM books b JOIN users u ON u.id = b.owner_id WHERE b.id = $1`,
        [bookId]
      );
      return r.rows[0] || null;
    } catch (error) {
      console.error('[drive-storage] cannot resolve the book owner:', error.message);
      return null;
    }
  }

  refOf(bucketType, filename) {
    return `story:${bucketType}:${filename}`;
  }

  /* A book's folder: "<safe title> (<first 8 of id>)" — readable AND unique; a rename is just a
     move (the ref, not the path, is the address). Junk titles fall back to the short id alone. */
  bookFolder(bookId, title) {
    const id8 = String(bookId || '').replace(/-/g, '').slice(0, 8);
    const safe = String(title || '').replace(/[^\p{L}\p{N} ()-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return safe ? `${safe} (${id8})` : id8 || 'untitled';
  }

  pathOf(sub, bucketType, filename, book = null) {
    /* The CARETAKER's own content sits at the top of the project (his Drive shows the template
       folders directly); every OTHER owner's content lands under that owner's sub segment, so
       re-homing it later is a folder move. Unlinked owners get the literal _unowned segment.
       A book-bound asset lives in the BOOK's folder ("<title> (<id8>)/<Folder>/<file>") so a
       whole book is one grab; bookless assets sit directly in the type folder. */
    const type = FOLDER[bucketType] || bucketType;
    const seg = sub === this.caretaker ? '' : `${sub || UNOWNED}/`;
    const bookSeg = book && book.id ? `${this.bookFolder(book.id, book.title)}/` : '';
    return `${seg}${bookSeg}${type}/${filename}`;
  }

  mimeOf(filename) {
    const m = /\.(png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm|mov)$/i.exec(String(filename));
    return m ? MIME[m[0].toLowerCase()] : 'application/octet-stream';
  }

  /**
   * Upload a buffer into the owner's Drive. Returns
   *   { ok: true, ref, node, path, size }                   — stored (idempotent by ref),
   *   { ok: false, reason, retry, userMessage? }            — not stored; the caller keeps the MinIO copy.
   * Never throws.
   */
  async put(bucketType, buffer, filename, user, book = null) {
    if (!this.initialize()) return { ok: false, reason: 'disabled', retry: false };
    const ref = this.refOf(bucketType, filename);
    const sub = this.subOf(user);
    if (!sub) return { ok: false, reason: 'no_owner', retry: false };
    const path = this.pathOf(sub, bucketType, filename, book);
    try {
      const r = await this.client.forUser(sub).put(buffer, {
        project: PROJECT, path, ref, tag: TAG, sha256: true,
        contentType: this.mimeOf(filename),
      });
      return { ok: true, ref, node: r.id, path, size: buffer.length, ownerSub: sub };
    } catch (error) {
      const code = (error && error.code) || 'error';
      console.error(`[drive-storage] put failed (${code}):`, error.message);
      return { ok: false, reason: code, retry: !!(error && error.retryable) };
    }
  }

  /**
   * Delete an asset's Drive copy (the person named by X-Sub is the DRIVE owner — resolve from
   * media_owners' drive_owner first, the uploader's portal_sub as fallback). The copy goes to the
   * person's Drive BIN by default (undoable by them); { permanent: true } is only for the erasure
   * flow. Returns { ok } | null when Stories holds no Drive copy for it. A transport error
   * THROWS — a delete must not lie about what it deleted.
   */
  async removeFor(sub, bucketType, filename, o = {}) {
    if (!this.initialize()) return null;
    const ref = this.refOf(bucketType, filename);
    // resolve the node id: the ref alone cannot DELETE (the API's remove takes an id)
    const stat = await this.statFor(sub, bucketType, filename);
    if (!stat) return null;
    /* Only the CLIENT's retried-404 counts as already-gone; a first-404 throws (the caller
       retries the whole delete — the row still names the node, so a concurrent delete is the
       only way to see a first 404 here, and that is a 503-retry, not a silent success). */
    return await this.client.forUser(sub).remove(PROJECT, stat.id, { bin: !o.permanent });
  }

  /** A stat by ref: { id, version, size, path } | null (null = no Drive copy). */
  async statFor(sub, bucketType, filename) {
    if (!this.initialize()) return null;
    try {
      return await this.client.forUser(sub).stat(PROJECT, { ref: this.refOf(bucketType, filename) });
    } catch (error) {
      if (error && error.code === 'not_found') return null;
      throw error;
    }
  }

  /**
   * Stream an asset out of Drive by ref, for the owner sub the CALLER resolved from media_owners
   * (the person named by X-Sub must be the Drive owner, not the requester). Returns
   *   { stream, contentType, size, contentRange, status } — a Drive copy exists,
   *   null                                                 — Stories holds no Drive copy (fall back to MinIO).
   * A Drive transport error THROWS (the caller answers 502; it must not silently serve MinIO
   * bytes that may be older than the Drive copy).
   */
  async streamFor(sub, bucketType, filename, range = undefined) {
    if (!this.initialize()) return null;
    try {
      return await this.client.forUser(sub).getByRef(PROJECT, this.refOf(bucketType, filename), { range });
    } catch (error) {
      if (error && error.code === 'not_found') return null;
      console.error(`[drive-storage] get failed (${error && error.code}):`, error.message);
      throw error;
    }
  }
}

export const driveStorage = new DriveStorage();
