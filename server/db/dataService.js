/**
 * Data Service - Abstraction layer for dual-write during PostgreSQL migration
 *
 * This service handles the complexity of writing to both Redis and PostgreSQL
 * during the migration phase, and provides a clean interface for reading/writing data.
 */

import { features } from '../config/features.js';
import { UserRepository, BookRepository, ChapterRepository, JobRepository } from './repositories/index.js';
import { getRedisClient } from '../services/redis.js';

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
      user = await UserRepository.create(userData);
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
      return await UserRepository.findByIdWithSettings(userId);
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
      return await UserRepository.findByEmail(email);
    }

    // Read from Redis (scan all users)
    if (features.shouldReadFromRedis()) {
      const redis = await getRedisClient();

      for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 100 })) {
        const data = await redis.get(key);
        const user = JSON.parse(data);
        if (user.email === email) {
          return user;
        }
      }
    }

    return null;
  }

  /**
   * Update user
   */
  static async update(userId, updates) {
    let user = null;

    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      user = await UserRepository.update(userId, updates);
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
   * Create a new book
   */
  static async create(bookData) {
    let book = null;

    // Write to PostgreSQL if enabled
    if (features.shouldWriteToPostgres()) {
      book = await BookRepository.create(bookData);
    }

    // Write to Redis if needed
    if (features.shouldWriteToRedis()) {
      const redis = await getRedisClient();

      // If PostgreSQL book doesn't exist, generate ID
      if (!book) {
        book = {
          id: Date.now().toString(),
          ...bookData,
          chapters: [],
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
        book.chapters = chapters || [];
      }
      return book;
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
        const book = JSON.parse(data);

        if (book.ownerId === userId) {
          books.push(book);
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

    // Update PostgreSQL if enabled
    if (features.shouldWriteToPostgres() && expectedVersion !== null) {
      try {
        book = await BookRepository.update(bookId, userId, updates, expectedVersion);
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

        // Apply updates
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
