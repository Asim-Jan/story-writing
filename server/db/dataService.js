/**
 * Data Service - Abstraction layer for dual-write during PostgreSQL migration
 *
 * This service handles the complexity of writing to both Redis and PostgreSQL
 * during the migration phase, and provides a clean interface for reading/writing data.
 */

import { features } from '../config/features.js';
import { UserRepository, BookRepository, ChapterRepository, JobRepository } from './repositories/index.js';
import { getRedisClient } from '../services/dataAdapter.js';
import { query } from './postgres.js';

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
      user = await UserRepository.update(userId, pgUpdates);
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
  static async update(bookId, userId, updates, expectedVersion = null) {
    let book = null;

    // Extract chapters from updates if present (they need special handling)
    const chapters = updates.chapters;
    const bookUpdates = { ...updates };
    delete bookUpdates.chapters; // Remove chapters from book updates

    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      try {
        book = await BookRepository.update(bookId, userId, bookUpdates, expectedVersion || 1);
        if (book) {
          book = this.mapBookFieldsFromPostgres(book);
        }

        // Sync chapters to chapters table if provided
        if (chapters && Array.isArray(chapters)) {
          await this.syncChapters(bookId, chapters);
          // Reload chapters to return updated book with chapters
          const updatedChapters = await ChapterRepository.findByBookId(bookId);
          if (book) {
            book.chapters = (updatedChapters || []).map(ch => this.mapChapterFromPostgres(ch));
          }
        }
      } catch (error) {
        if (error.message.includes('CONFLICT')) {
          throw error; // Propagate conflict error
        }
        console.error('PostgreSQL update error:', error);
      }
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
