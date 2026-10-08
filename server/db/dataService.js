/**
 * Data Service - Abstraction layer for dual-write during PostgreSQL migration
 *
 * This service handles the complexity of writing to both Redis and PostgreSQL
 * during the migration phase, and provides a clean interface for reading/writing data.
 */

import { features } from '../config/features.js';
import { UserRepository, BookRepository, ChapterRepository, JobRepository } from './repositories/index.js';
import { getRedisClient } from '../services/dataAdapter.js';
import { query, transaction } from './postgres.js';

/**
 * Helper to get Redis book key
 */
function getBookKey(bookId) {
  return `book:${bookId}`;
}

/**
 * Helper to get Redis user key
 */
function getUserKey(userId) {
  return `user:${userId}`;
}

/**
 * User Data Service
 */
export class UserDataService {
  /**
   * Create a new user
   */
  static async create(userData) {
    let user = null;

    // Write to PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      const pgUserData = this.mapUserFieldsToPostgres(userData);
      // The verification fields are only written at creation (UserRepository.create takes them).
      // mapUserFieldsToPostgres is shared with updates and drops them, which stored every new
      // account's token as NULL, so the link in the sign-up email could never verify.
      for (const k of ['email_verified', 'email_verification_token', 'email_verification_token_expires']) {
        if (userData[k] !== undefined) pgUserData[k] = userData[k];
      }
      user = await UserRepository.create(pgUserData);
    }

    // Write to Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();

      // If PostgreSQL user doesn't exist, generate ID
      if (!user) {
        user = {
          id: Date.now().toString(), // Fallback to timestamp ID
          ...userData,
          createdAt: Date.now()
        };
      }

      await redis.set(getUserKey(user.id), JSON.stringify(user));
    }

    return user;
  }

  /**
   * Find user by ID
   */
  static async findById(userId) {
    // Read from PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      const user = await UserRepository.findByIdWithSettings(userId);
      return user ? this.mapUserFieldsFromPostgres(user) : null;
    }

    // Read from Redis
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();
      const data = await redis.get(getUserKey(userId));
      return data ? JSON.parse(data) : null;
    }

    return null;
  }

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    // Read from PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      const user = await UserRepository.findByEmail(email);
      return user ? this.mapUserFieldsFromPostgres(user) : null;
    }

    // Read from Redis (scan all users)
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();

      for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 100 })) {
        const data = await redis.get(key);

        // Skip if no data or invalid JSON
        if (!data) continue;

        try {
          const user = JSON.parse(data);
          if (user && user.email === email) {
            return user;
          }
        } catch (err) {
          console.error(`Failed to parse user data for key ${key}:`, err.message);
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Map Redis field names to PostgreSQL field names
   */
  static mapUserFieldsToPostgres(updates) {
    const mapped = { ...updates };

    // Map password to password_hash
    if (mapped.password) {
      mapped.password_hash = mapped.password;
      delete mapped.password;
    }

    // Remove Redis-specific fields that don't exist in PostgreSQL users table
    delete mapped.books; // Books are in separate table
    delete mapped.createdAt; // PostgreSQL uses created_at (set automatically)
    delete mapped.updatedAt; // PostgreSQL uses updated_at (set automatically)
    delete mapped.deletedAt; // PostgreSQL uses deleted_at (set automatically)

    // Remove fields that belong in user_settings table (not users table)
    delete mapped.ai_config;
    delete mapped.aiConfig;
    delete mapped.preferences;

    // Remove fields that belong in api_keys table
    delete mapped.apiKeys;
    delete mapped.api_keys;

    // Only keep valid users table columns:
    // id, email, name, password_hash, tier, role, status, created_at, updated_at, deleted_at, version
    const validUserFields = ['id', 'email', 'name', 'password_hash', 'tier', 'role', 'status', 'version'];
    const filtered = {};

    for (const key of validUserFields) {
      if (mapped[key] !== undefined) {
        filtered[key] = mapped[key];
      }
    }

    return filtered;
  }

  /**
   * Map PostgreSQL field names back to Redis/application field names
   */
  static mapUserFieldsFromPostgres(user) {
    if (!user) return null;

    const mapped = { ...user };

    // Map password_hash back to password
    if (mapped.password_hash) {
      mapped.password = mapped.password_hash;
      delete mapped.password_hash;
    }

    // Map created_at to createdAt
    if (mapped.created_at) {
      mapped.createdAt = mapped.created_at;
      delete mapped.created_at;
    }

    // Map updated_at to updatedAt
    if (mapped.updated_at) {
      mapped.updatedAt = mapped.updated_at;
      delete mapped.updated_at;
    }

    // Map deleted_at to deletedAt
    if (mapped.deleted_at) {
      mapped.deletedAt = mapped.deleted_at;
      delete mapped.deleted_at;
    }

    // Ensure role, tier, and status are included (already using correct names)
    // These fields come directly from PostgreSQL with the same names
    if (!mapped.role) {
      mapped.role = 'user';
    }
    if (!mapped.tier) {
      mapped.tier = 'free';
    }
    if (!mapped.status) {
      mapped.status = 'active';
    }

    // Initialize books array if not present
    if (!mapped.books) {
      mapped.books = [];
    }

    return mapped;
  }

  /**
   * Update user
   */
  static async update(userId, updates) {
    let user = null;

    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      const pgUpdates = this.mapUserFieldsToPostgres(updates);
      // nothing that belongs in users (e.g. only the Redis-era book list): nothing to write
      user = Object.keys(pgUpdates).length ? await UserRepository.update(userId, pgUpdates) : await UserRepository.findById(userId);
    }

    // Update Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();
      const existing = await redis.get(getUserKey(userId));

      if (existing) {
        const userData = JSON.parse(existing);
        const updated = { ...userData, ...updates };
        await redis.set(getUserKey(userId), JSON.stringify(updated));

        if (!user) {
          user = updated;
        }
      }
    }

    return user;
  }

  /**
   * Update user settings (AI config, preferences)
   */
  static async updateSettings(userId, settings) {
    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      await UserRepository.updateSettings(userId, settings);
    }

    // Update Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();
      const existing = await redis.get(getUserKey(userId));

      if (existing) {
        const userData = JSON.parse(existing);
        userData.aiConfig = settings.ai_config || settings.aiConfig || userData.aiConfig;
        userData.preferences = settings.preferences || userData.preferences;
        await redis.set(getUserKey(userId), JSON.stringify(userData));
      }
    }
  }
}

/**
 * Book Data Service
 */
export class BookDataService {
  /**
   * Map PostgreSQL chapter fields to frontend format
   */
  static mapChapterFromPostgres(chapter) {
    if (!chapter) return null;

    return {
      id: chapter.id,
      number: chapter.chapter_number || 0,
      title: chapter.title || '',
      content: chapter.content || '',
      summary: chapter.notes || '',
      scenes: chapter.scenes || [],
      wordCount: chapter.word_count || 0,
      status: chapter.status || 'draft',
      coverImage: chapter.cover_image || null,
      coverImageFilename: chapter.cover_image_filename || null,
      createdAt: chapter.created_at,
      updatedAt: chapter.updated_at,
      version: chapter.version
    };
  }

  /**
   * Map PostgreSQL book fields to frontend format
   */
  static mapBookFieldsFromPostgres(book) {
    if (!book) return null;

    const mapped = { ...book };

    // Parse JSON fields (they're stored as JSON strings in PostgreSQL)
    if (typeof mapped.characters === 'string') {
      mapped.characters = JSON.parse(mapped.characters);
    }
    if (typeof mapped.locations === 'string') {
      mapped.locations = JSON.parse(mapped.locations);
    }
    if (typeof mapped.plotlines === 'string') {
      mapped.plotlines = JSON.parse(mapped.plotlines);
    }
    if (typeof mapped.world_building === 'string') {
      mapped.world_building = JSON.parse(mapped.world_building);
    }
    if (typeof mapped.settings === 'string') {
      mapped.settings = JSON.parse(mapped.settings);
    }
    if (typeof mapped.notes === 'string') {
      mapped.notes = JSON.parse(mapped.notes);
    }
    if (typeof mapped.timelines === 'string') {
      mapped.timelines = JSON.parse(mapped.timelines);
    }
    if (typeof mapped.visuals === 'string') {
      mapped.visuals = JSON.parse(mapped.visuals);
    }
    if (typeof mapped.audio_files === 'string') {
      mapped.audio_files = JSON.parse(mapped.audio_files);
    }
    if (typeof mapped.comic_pages === 'string') {
      mapped.comic_pages = JSON.parse(mapped.comic_pages);
    }
    if (typeof mapped.character_refs === 'string') {
      mapped.character_refs = JSON.parse(mapped.character_refs);
    }
    if (typeof mapped.animation_projects === 'string') {
      mapped.animation_projects = JSON.parse(mapped.animation_projects);
    }
    if (typeof mapped.metadata === 'string') {
      mapped.metadata = JSON.parse(mapped.metadata);
    }

    // Map snake_case to camelCase for frontend compatibility
    if (mapped.owner_id) {
      mapped.ownerId = mapped.owner_id;
    }
    if (mapped.target_audience) {
      mapped.targetAudience = mapped.target_audience;
    }
    if (mapped.world_building) {
      mapped.worldBuilding = mapped.world_building;
    }
    if (mapped.word_count !== undefined) {
      mapped.wordCount = mapped.word_count;
    }
    if (mapped.chapter_count !== undefined) {
      mapped.chapterCount = mapped.chapter_count;
    }
    if (mapped.created_at) {
      mapped.createdAt = mapped.created_at;
    }
    if (mapped.updated_at) {
      mapped.updatedAt = mapped.updated_at;
    }
    if (mapped.audio_files) {
      mapped.audioFiles = mapped.audio_files;
    }
    if (mapped.comic_pages) {
      mapped.comicPages = mapped.comic_pages;
    }
    if (mapped.character_refs) {
      mapped.characterRefs = mapped.character_refs;
    }
    if (mapped.animation_projects) {
      mapped.animationProjects = mapped.animation_projects;
    }
    if (mapped.transcripts === undefined && mapped.transcripts !== null) {
      // JSONB default '[]'
    }
    if (mapped.description && !mapped.overview) {
      // The editor binds data.overview; the schema stores description. Map it
      // BACK so a reload doesn't blank the overview textarea (the save writes
      // description from overview — without this the field round-trips to zero).
      mapped.overview = mapped.description;
    }
    if (!Array.isArray(mapped.transcripts)) {
      mapped.transcripts = [];
    }

    // Map title to bookTitle for frontend
    if (mapped.title) {
      mapped.bookTitle = mapped.title;
    }

    // Ensure arrays exist and are valid arrays (PostgreSQL auto-parses JSONB)
    if (!Array.isArray(mapped.characters)) mapped.characters = [];
    if (!Array.isArray(mapped.locations)) mapped.locations = [];
    if (!Array.isArray(mapped.plotlines)) mapped.plotlines = [];
    if (!Array.isArray(mapped.chapters)) mapped.chapters = [];
    if (!Array.isArray(mapped.notes)) mapped.notes = [];
    if (!Array.isArray(mapped.timelines)) mapped.timelines = [];
    if (!Array.isArray(mapped.visuals)) mapped.visuals = [];
    if (!Array.isArray(mapped.comicPages)) mapped.comicPages = [];
    if (!Array.isArray(mapped.animationProjects)) mapped.animationProjects = [];

    // Ensure objects exist
    if (!mapped.audioFiles && !mapped.audio_files) {
      mapped.audioFiles = {};
      mapped.audio_files = {};
    }
    if (!mapped.characterRefs && !mapped.character_refs) {
      mapped.characterRefs = {};
      mapped.character_refs = {};
    }
    if (!mapped.worldBuilding && !mapped.world_building) {
      mapped.worldBuilding = {};
      mapped.world_building = {};
    }
    if (!mapped.settings || typeof mapped.settings !== 'object') {
      mapped.settings = {};
    }
    if (!mapped.metadata || typeof mapped.metadata !== 'object') {
      mapped.metadata = {};
    }

    return mapped;
  }

  /**
   * Create a new book
   */
  static async create(bookData) {
    let book = null;

    // Extract chapters from bookData if present
    const chapters = bookData.chapters;
    const bookDataWithoutChapters = { ...bookData };
    delete bookDataWithoutChapters.chapters;

    // Accept camelCase payloads (AI orchestrator) — map onto the repository's
    // snake_case fields. Repository destructures with defaults, so snake_case
    // callers are unaffected.
    if (!bookDataWithoutChapters.owner_id && bookDataWithoutChapters.ownerId) {
      bookDataWithoutChapters.owner_id = bookDataWithoutChapters.ownerId;
    }
    if (!bookDataWithoutChapters.title && bookDataWithoutChapters.bookTitle) {
      bookDataWithoutChapters.title = bookDataWithoutChapters.bookTitle;
    }
    if (!bookDataWithoutChapters.description && bookDataWithoutChapters.overview) {
      bookDataWithoutChapters.description = bookDataWithoutChapters.overview;
    }
    if (!bookDataWithoutChapters.target_audience && bookDataWithoutChapters.targetAudience) {
      bookDataWithoutChapters.target_audience = bookDataWithoutChapters.targetAudience;
    }
    if (!bookDataWithoutChapters.audio_files && bookDataWithoutChapters.audioFiles) {
      bookDataWithoutChapters.audio_files = bookDataWithoutChapters.audioFiles;
    }

    // Write to PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      book = await BookRepository.create(bookDataWithoutChapters);
      if (book) {
        book = this.mapBookFieldsFromPostgres(book);

        // Create chapters if provided
        if (chapters && Array.isArray(chapters) && chapters.length > 0) {
          await this.syncChapters(book.id, chapters);
          // Reload chapters
          const createdChapters = await ChapterRepository.findByBookId(book.id);
          book.chapters = (createdChapters || []).map(ch => this.mapChapterFromPostgres(ch));
        } else {
          book.chapters = [];
        }
      }
    }

    // Write to Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();

      // If PostgreSQL book doesn't exist, generate ID
      if (!book) {
        book = {
          id: Date.now().toString(),
          ...bookData,
          chapters: chapters || [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }

      await redis.set(getBookKey(book.id), JSON.stringify(book));
    }

    return book;
  }

  /**
   * Find book by ID
   */
  static async findById(bookId) {
    // Read from PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      const book = await BookRepository.findByIdWithCollaborators(bookId);
      if (book) {
        // Also fetch chapters
        const chapters = await ChapterRepository.findByBookId(bookId);
        book.chapters = (chapters || []).map(ch => this.mapChapterFromPostgres(ch));

        // Map to frontend format
        return this.mapBookFieldsFromPostgres(book);
      }
      return null;
    }

    // Read from Redis
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();
      const data = await redis.get(getBookKey(bookId));
      return data ? JSON.parse(data) : null;
    }

    return null;
  }

  /**
   * Find all books for a user
   */
  static async findByUser(userId, options = {}) {
    // Read from PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      return await BookRepository.findByUser(userId, options);
    }

    // Read from Redis
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();
      const books = [];

      for await (const key of redis.scanIterator({ MATCH: 'book:*', COUNT: 100 })) {
        const data = await redis.get(key);

        // Skip if no data or invalid JSON
        if (!data) continue;

        try {
          const book = JSON.parse(data);
          if (book && book.ownerId === userId) {
            books.push(book);
          }
        } catch (err) {
          console.error(`Failed to parse book data for key ${key}:`, err.message);
          continue;
        }
      }

      // Sort by updatedAt
      books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      return books;
    }

    return [];
  }

  /**
   * Update book
   */
  /**
   * Server-side write (job processors). A job runs for seconds to minutes; the
   * copy of the book it loaded at the start is stale by the time it saves, and
   * writing that copy back silently reverted whatever the user saved meanwhile.
   * This re-reads the book, lets `mutate` apply the job's ONE change to the
   * fresh copy, and writes against the fresh version. A save landing between
   * the read and the write is a CONFLICT: re-read and re-apply, a few times.
   * @param {(book: object) => object|null} mutate - returns the updates, or null for nothing to write
   */
  static async applyServerWrite(bookId, userId, mutate, attempts = 4) {
    for (let i = 1; ; i++) {
      const book = await this.findById(bookId);
      if (!book) throw Object.assign(new Error('Book not found'), { code: 'NOT_FOUND' });
      const updates = mutate(book);
      if (!updates || Object.keys(updates).length === 0) return book;
      try {
        return await this.update(bookId, userId, updates, book.version);
      } catch (err) {
        const conflict = err.code === 'CONFLICT' || String(err.message).includes('CONFLICT');
        if (!conflict || i >= attempts) throw err;
      }
    }
  }

  static async update(bookId, userId, updates, expectedVersion = null) {
    let book = null;

    // Extract chapters from updates if present (they need special handling)
    const chapters = updates.chapters;
    const bookUpdates = { ...updates };
    delete bookUpdates.chapters; // Remove chapters from book updates

    // camelCase fields that have no columns of their own fold into metadata
    // (the create path + GET mapper do the same dance): importedFrom,
    // importAnalysis. animationProjects maps to its snake column.
    if (bookUpdates.importedFrom || bookUpdates.importAnalysis || bookUpdates.animationProjects) {
      const md = { ...(bookUpdates.metadata || {}) };
      if (bookUpdates.importedFrom) md.importedFrom = bookUpdates.importedFrom;
      if (bookUpdates.importAnalysis) md.importAnalysis = bookUpdates.importAnalysis;
      if (bookUpdates.importedFrom || bookUpdates.importAnalysis) bookUpdates.metadata = md;
      delete bookUpdates.importedFrom;
      delete bookUpdates.importAnalysis;
      if (bookUpdates.animationProjects !== undefined) {
        bookUpdates.animation_projects = bookUpdates.animationProjects;
        delete bookUpdates.animationProjects;
      }
    }

    // Server-side writers (job callbacks, SSE stages) pass no version — they
    // hold a stale copy of the book by definition. They get the versionless
    // internal path: read the CURRENT version and write against it. User
    // saves keep the strict client-version check.
    if (expectedVersion === null || expectedVersion === undefined) {
      const cur = await query('SELECT version FROM books WHERE id = $1 AND deleted_at IS NULL', [bookId]);
      expectedVersion = cur.rows[0]?.version ?? 1;
    }

    // Update PostgreSQL if enabled.
    // IMPORTANT: the book row and the chapter sync happen in ONE transaction — a
    // save either lands whole or not at all. The old code updated the book, then
    // synced chapters as independent statements, then SWALLOWED any error: a
    // failed sync returned 200 with the book silently missing chapters, and a
    // blank-book client save could hard-delete chapters with no way back.
    // Errors now propagate: conflict -> 409, anything else -> 500. Never a silent 200.
    if (features.shouldWriteToPostgres()) {
      let finalVersion = null;
      let finalUpdatedAt = null;
      book = await transaction(async (client) => {
        // The book row runs ON the transaction client (blocker (a)/(d): the
        // pool call let the stats UPDATE commit its own version bump outside
        // the transaction and returned a version the DB had already left).
        // Chapters-only saves (the job processors) have no row fields — the
        // repo throws 'No valid fields' on an empty object. Sync the chapters
        // against the loaded row instead, with an explicit version bump so
        // stale clients still conflict.
        const hasFieldUpdates = Object.keys(bookUpdates).some(k => k !== 'chapters');
        let updated = null;
        if (hasFieldUpdates) {
          updated = await BookRepository.update(bookId, userId, bookUpdates, expectedVersion || 1, client);
          if (updated) {
            updated = this.mapBookFieldsFromPostgres(updated);
          }
        } else {
          const existing = await client.query('SELECT * FROM books WHERE id = $1 AND deleted_at IS NULL', [bookId]);
          if (existing.rows.length === 0) {
            const err = new Error('Book not found');
            err.code = 'NOT_FOUND';
            throw err;
          }
          const row = existing.rows[0];
          if (row.owner_id !== userId) {
            const collab = await client.query(
              `SELECT 1 FROM collaborators c WHERE c.book_id = $1 AND c.user_id = $2
                 AND c.status = 'active' AND c.role IN ('editor', 'admin')`,
              [bookId, userId]
            );
            if (collab.rowCount === 0) {
              const err = new Error('Not authorized to update this book');
              err.code = 'FORBIDDEN';
              throw err;
            }
          }
          if (row.version !== expectedVersion) {
            const err = new Error('CONFLICT: Book was modified by another user. Please refresh and try again.');
            err.code = 'CONFLICT';
            throw err;
          }
          updated = this.mapBookFieldsFromPostgres(row);
          await client.query('UPDATE books SET updated_at = NOW() WHERE id = $1', [bookId]);
        }

        let updatedChapters = null;
        if (chapters && Array.isArray(chapters)) {
          await this.syncChaptersInClient(client, bookId, chapters);
          // reload ON THE TRANSACTION CLIENT — a pool read here would see the
          // pre-commit snapshot (versions one step behind what was just written)
          updatedChapters = (await client.query(
            'SELECT * FROM chapters WHERE book_id = $1 AND deleted_at IS NULL ORDER BY chapter_number ASC',
            [bookId]
          )).rows;
          if (updated) {
            updated.chapters = (updatedChapters || []).map(ch => this.mapChapterFromPostgres(ch));
          }
        }

        // FINAL version read, after every statement in this save: the books
        // trigger bumps the version on EVERY UPDATE of the row (the field
        // update AND the stats update = two bumps per save). The client must
        // store the REAL final version or its next save 409s against a
        // version that never existed from its point of view.
        if (updated) {
          const final = (await client.query(
            'SELECT version, updated_at FROM books WHERE id = $1',
            [bookId]
          )).rows[0];
          if (final) {
            updated.version = final.version;
            updated.updatedAt = final.updated_at;
          }
          for (const ch of (updated.chapters || [])) {
            const cv = (updatedChapters || []).find(c => c.id === ch.id);
            if (cv) ch.version = cv.version;
          }
        }

        return updated;
      });
    }

    // Update Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();
      const existing = await redis.get(getBookKey(bookId));

      if (existing) {
        const bookData = JSON.parse(existing);

        // Check ownership
        if (bookData.ownerId !== userId) {
          throw new Error('Not authorized to update this book');
        }

        // Apply updates (including chapters for Redis)
        const updated = { ...bookData, ...updates, updatedAt: Date.now() };
        await redis.set(getBookKey(bookId), JSON.stringify(updated));

        if (!book) {
          book = updated;
        }
      }
    }

    return book;
  }

  /**
   * Sync chapters from frontend array to chapters table
   * This handles the migration from Redis-style (chapters as array) to PostgreSQL-style (chapters table)
   */
  static async syncChapters(bookId, chaptersArray) {
    if (!features.shouldWriteToPostgres()) return;

    console.log(`Syncing ${chaptersArray.length} chapters for book ${bookId}`);

    // Get existing chapters from database
    const existingChapters = await ChapterRepository.findByBookId(bookId);
    const existingChapterMap = new Map(existingChapters.map(ch => [ch.id, ch]));
    const existingByNumber = new Map(existingChapters.map(ch => [ch.chapter_number, ch]));

    // Track which chapters are in the new array
    const chaptersToKeep = new Set();

    for (const chapter of chaptersArray) {
      const chapterData = {
        book_id: bookId,
        chapter_number: chapter.number || chapter.chapterNumber || chapter.chapter_number || 0,
        title: chapter.title || '',
        content: chapter.content || '',
        scenes: chapter.scenes || [],
        notes: chapter.summary || chapter.notes || '',
        status: chapter.status || 'draft'
      };

      // Try to find existing chapter by ID or chapter_number
      let existingChapter = null;
      if (chapter.id && existingChapterMap.has(chapter.id)) {
        existingChapter = existingChapterMap.get(chapter.id);
      } else if (existingByNumber.has(chapterData.chapter_number)) {
        existingChapter = existingByNumber.get(chapterData.chapter_number);
      }

      if (existingChapter) {
        // Update existing chapter
        chaptersToKeep.add(existingChapter.id);
        try {
          await ChapterRepository.update(
            existingChapter.id,
            {
              chapter_number: chapterData.chapter_number,
              title: chapterData.title,
              content: chapterData.content,
              scenes: chapterData.scenes,
              notes: chapterData.notes,
              status: chapterData.status
            },
            existingChapter.version,
            null // userId for version history (optional)
          );
          console.log(`  ✓ Updated chapter ${existingChapter.id} (number: ${chapterData.chapter_number})`);
        } catch (error) {
          console.error(`  ✗ Failed to update chapter ${existingChapter.id}:`, error.message);
        }
      } else {
        // Create new chapter
        try {
          const newChapter = await ChapterRepository.create(chapterData);
          chaptersToKeep.add(newChapter.id);
          console.log(`  ✓ Created chapter ${newChapter.id} (number: ${chapterData.chapter_number})`);
        } catch (error) {
          console.error(`  ✗ Failed to create chapter:`, error.message);
        }
      }
    }

    // Delete chapters that are no longer in the array
    // Use hard delete (not soft delete) to allow chapter numbers to be reused
    for (const existing of existingChapters) {
      if (!chaptersToKeep.has(existing.id)) {
        try {
          // Hard delete instead of soft delete to free up the (book_id, chapter_number) constraint
          await query('DELETE FROM chapters WHERE id = $1', [existing.id]);
          console.log(`  ✓ Deleted chapter ${existing.id} (number: ${existing.chapter_number})`);
        } catch (error) {
          console.error(`  ✗ Failed to delete chapter ${existing.id}:`, error.message);
        }
      }
    }

    // Update book statistics
    await BookRepository.updateStats(bookId);
  }

  /**
   * syncChapters on the CALLER'S transaction client — same logic as syncChapters
   * but: (a) runs inside the book-save transaction so a save lands whole or not
   * at all; (b) FAILS CLOSED — a failed chapter update/delete aborts the whole
   * save instead of being logged and swallowed (the old behaviour returned 200
   * while the book's chapters were silently wrong); (c) treats chapter numbers
   * as data, not identity: the client's string/int mixing is coerced, and the
   * UNIQUE(book_id, chapter_number) constraint stays as the integrity backstop.
   */
  static async syncChaptersInClient(client, bookId, chaptersArray) {
    console.log(`Syncing ${chaptersArray.length} chapters for book ${bookId} (in save transaction)`);

    const existingChapters = (await client.query(
      'SELECT * FROM chapters WHERE book_id = $1 AND deleted_at IS NULL',
      [bookId]
    )).rows;
    const existingChapterMap = new Map(existingChapters.map(ch => [ch.id, ch]));
    const existingByNumber = new Map(existingChapters.map(ch => [ch.chapter_number, ch]));

    // number arrives as a string from the client (and from some AI payloads).
    // A missing or zero number gets the next free one: two unnumbered chapters
    // both became 0 and hit UNIQUE(book_id, chapter_number) on every save.
    const numberOf = (ch) => parseInt(ch.number ?? ch.chapterNumber ?? ch.chapter_number ?? 0, 10) || 0;
    let nextNumber = Math.max(0, ...chaptersArray.map(numberOf)) + 1;

    // 1. What each payload row is. Identity: the chapter's OWN id first; fall
    // back to number ONLY when the payload row has no id (a genuinely new
    // chapter). Two payload rows may not claim the same identity: the first
    // wins, later ones become new rows and the UNIQUE constraint catches true
    // collisions.
    const claimed = new Set();
    const plan = chaptersArray.map((chapter) => {
      const chapterData = {
        book_id: bookId,
        chapter_number: numberOf(chapter) || nextNumber++,
        title: chapter.title || '',
        content: chapter.content || '',
        scenes: chapter.scenes || [],
        notes: chapter.summary || chapter.notes || '',
        status: chapter.status || 'draft',
        cover_image: chapter.coverImage || null,
        cover_image_filename: chapter.coverImageFilename || null
      };
      let existingChapter = null;
      if (chapter.id && existingChapterMap.has(chapter.id)) {
        existingChapter = existingChapterMap.get(chapter.id);
      } else if (!chapter.id && existingByNumber.has(chapterData.chapter_number)) {
        existingChapter = existingByNumber.get(chapterData.chapter_number);
      }
      if (existingChapter && claimed.has(existingChapter.id)) existingChapter = null;
      if (existingChapter) claimed.add(existingChapter.id);
      return { chapterData, existingChapter };
    });

    // 2. Hard-delete chapters the payload no longer carries, FIRST: deleting
    // chapter 3 and renumbering 4 -> 3 in one save used to update 4 -> 3 while
    // the old 3 still existed and fail on UNIQUE(book_id, chapter_number).
    // Only when the payload is chapter-bearing (non-empty): an EMPTY array with
    // chapters in the DB is how a blank-book client wipes everything; that is
    // treated as a conflict instead of a mass delete. A user deleting every
    // chapter does it through the chapter UI, which sends the remaining state,
    // never an empty array behind a fully-loaded book.
    if (chaptersArray.length === 0 && existingChapters.length > 0) {
      throw new Error('CONFLICT: refusing to delete all chapters from an empty payload');
    }
    for (const existing of existingChapters) {
      if (!claimed.has(existing.id)) {
        // chapter_versions has ON DELETE CASCADE on chapters: deleting the row
        // takes its version history with it. That is intended: a chapter the
        // client no longer has is gone; its content survives in the save the
        // next sync writes if it returns.
        await client.query('DELETE FROM chapters WHERE id = $1', [existing.id]);
      }
    }

    // 3. Chapters whose number changes step aside to a temporary negative
    // number first, so any renumbering (a shift after a delete, a swap, a full
    // 1..N) never collides with a number another chapter still holds.
    const moving = plan.filter(p => p.existingChapter && p.existingChapter.chapter_number !== p.chapterData.chapter_number);
    if (moving.length) {
      for (let i = 0; i < moving.length; i++) {
        await client.query('UPDATE chapters SET chapter_number = $1 WHERE id = $2', [-(i + 1), moving[i].existingChapter.id]);
      }
      // that bumped their version (trigger); the updates below check against it
      const fresh = await client.query('SELECT id, version FROM chapters WHERE id = ANY($1::uuid[])', [moving.map(p => p.existingChapter.id)]);
      const versions = new Map(fresh.rows.map(r => [r.id, r.version]));
      for (const p of moving) p.existingChapter = { ...p.existingChapter, version: versions.get(p.existingChapter.id) };
    }

    // 4. Write every chapter at its final number.
    for (const { chapterData, existingChapter } of plan) {
      if (existingChapter) {
        // Update through the repository ON THIS CLIENT: that carries the
        // version bump (trigger-checked), the word-count recompute, and the
        // chapter_versions history the old sync silently skipped. The
        // expectedVersion is the row's version read INSIDE this transaction,
        // so the optimistic check is against data no one else could have
        // changed between the read and the write.
        const updates = {
          chapter_number: chapterData.chapter_number,
          title: chapterData.title,
          content: chapterData.content,
          scenes: chapterData.scenes,
          notes: chapterData.notes,
          status: chapterData.status,
        };
        if (chapterData.cover_image !== null) {
          updates.cover_image = chapterData.cover_image;
          updates.cover_image_filename = chapterData.cover_image_filename;
        }
        const result = await ChapterRepository.update(
          existingChapter.id, updates, existingChapter.version, null, client
        );
        if (!result) {
          throw new Error(`CONFLICT: chapter ${existingChapter.id} vanished mid-save`);
        }
      } else {
        const wordCount = (chapterData.content || '').trim().split(/\s+/).filter(Boolean).length;
        await client.query(
          `INSERT INTO chapters (book_id, chapter_number, title, content, scenes, notes, status, cover_image, cover_image_filename, word_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [bookId, chapterData.chapter_number, chapterData.title, chapterData.content,
            JSON.stringify(chapterData.scenes), chapterData.notes, chapterData.status,
            chapterData.cover_image, chapterData.cover_image_filename, wordCount]
        );
      }
    }

    // statistics: same statement as BookRepository.updateStats but on this client
    await client.query(
      `UPDATE books b
       SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE book_id = b.id AND deleted_at IS NULL),
           word_count = (SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE book_id = b.id AND deleted_at IS NULL)
       WHERE b.id = $1`,
      [bookId]
    );
  }

  /**
   * Delete book
   */
  static async delete(bookId, userId) {
    // Delete from PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      await BookRepository.delete(bookId, userId);
    }

    // Delete from Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();
      const existing = await redis.get(getBookKey(bookId));

      if (existing) {
        const book = JSON.parse(existing);

        // Check ownership
        if (book.ownerId !== userId) {
          throw new Error('Not authorized to delete this book');
        }

        await redis.del(getBookKey(bookId));
      }
    }

    return true;
  }

  /**
   * Check if user has access to book
   */
  static async checkAccess(bookId, userId) {
    // Check PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      return await BookRepository.checkAccess(bookId, userId);
    }

    // Check Redis
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();
      const data = await redis.get(getBookKey(bookId));

      if (!data) return null;

      const book = JSON.parse(data);

      // Check if owner
      if (book.ownerId === userId) {
        return { access_role: 'owner', has_access: true };
      }

      // Check if collaborator
      const collaborator = book.collaborators?.find(c => c.email === userId || c.user_id === userId);
      if (collaborator && collaborator.status === 'active') {
        return { access_role: collaborator.role, has_access: true };
      }

      return null;
    }

    return null;
  }
}

/**
 * Chapter Data Service
 */
export class ChapterDataService {
  /**
   * Create a new chapter
   */
  static async create(chapterData) {
    let chapter = null;

    // Write to PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      chapter = await ChapterRepository.create(chapterData);
    }

    // Write to Redis if needed (update book's chapters array)
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();
      const bookData = await redis.get(getBookKey(chapterData.book_id));

      if (bookData) {
        const book = JSON.parse(bookData);

        // If PostgreSQL chapter doesn't exist, create one
        if (!chapter) {
          chapter = {
            id: Date.now().toString(),
            ...chapterData,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
        }

        // Add to book's chapters array
        book.chapters = book.chapters || [];
        book.chapters.push(chapter);
        book.updatedAt = Date.now();

        await redis.set(getBookKey(chapterData.book_id), JSON.stringify(book));
      }
    }

    return chapter;
  }

  /**
   * Find chapters for a book
   */
  static async findByBookId(bookId) {
    // Read from PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      return await ChapterRepository.findByBookId(bookId);
    }

    // Read from Redis
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();
      const data = await redis.get(getBookKey(bookId));

      if (!data) return [];

      const book = JSON.parse(data);
      return book.chapters || [];
    }

    return [];
  }

  /**
   * Update chapter
   */
  static async update(chapterId, updates, expectedVersion = null, userId = null) {
    let chapter = null;

    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres() && expectedVersion !== null) {
      try {
        chapter = await ChapterRepository.update(chapterId, updates, expectedVersion, userId);
      } catch (error) {
        if (error.message.includes('CONFLICT')) {
          throw error;
        }
        console.error('PostgreSQL chapter update error:', error);
      }
    }

    // Update Redis if needed (find chapter in book's chapters array)
    if (features.shouldWriteToRedis()) {
      // This is complex in Redis - need to scan all books
      // For now, we'll skip Redis update during dual-write for chapters
      // The migration script will sync the final state
      console.log('Note: Chapter updates in dual-write mode only update PostgreSQL');
    }

    return chapter;
  }
}

/**
 * Job Data Service
 */
export class JobDataService {
  /**
   * Create a new job
   */
  static async create(jobData) {
    let job = null;

    // Write to PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      job = await JobRepository.create(jobData);
    }

    // Jobs are not stored in Redis in the current system (they use Bull queue)
    // So we only write to PostgreSQL

    return job;
  }

  /**
   * Find job by ID
   */
  static async findById(jobId) {
    // Read from PostgreSQL if enabled
    if (features.shouldReadFromPostgres()) {
      return await JobRepository.findById(jobId);
    }

    // Jobs are not stored in Redis
    return null;
  }

  /**
   * Update job
   */
  static async update(jobId, updates) {
    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      return await JobRepository.update(jobId, updates);
    }

    return null;
  }
}

export default {
  User: UserDataService,
  Book: BookDataService,
  Chapter: ChapterDataService,
  Job: JobDataService
};
