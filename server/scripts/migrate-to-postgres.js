/**
 * Redis to PostgreSQL Migration Script
 *
 * This script migrates all data from Redis to PostgreSQL.
 * Run this BEFORE enabling dual-write mode.
 *
 * Usage:
 *   node server/scripts/migrate-to-postgres.js [--dry-run] [--skip-users] [--skip-books]
 *
 * Options:
 *   --dry-run: Preview what will be migrated without making changes
 *   --skip-users: Skip user migration
 *   --skip-books: Skip book migration
 */

import { createClient } from 'redis';
import { UserRepository, BookRepository, ChapterRepository } from '../db/repositories/index.js';
import { query } from '../db/postgres.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import CryptoJS from 'crypto-js';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

dotenv.config();

// UUID namespace for converting timestamp IDs
const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_USERS = args.includes('--skip-users');
const SKIP_BOOKS = args.includes('--skip-books');

// Encryption key for API keys (same as in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;

/**
 * Convert timestamp ID to UUID (deterministic)
 * This ensures the same timestamp always converts to the same UUID
 */
function timestampToUUID(timestampId) {
  // Check if it's already a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(timestampId)) {
    return timestampId;
  }

  // Convert timestamp to UUID using v5 (deterministic)
  return uuidv5(timestampId.toString(), NAMESPACE_UUID);
}

/**
 * Encrypt API key (same algorithm as current system)
 */
function encryptApiKey(apiKey) {
  if (!apiKey) return null;
  if (!ENCRYPTION_KEY) {
    console.warn('⚠️  No ENCRYPTION_KEY found, API keys will not be encrypted properly');
    return apiKey;
  }

  return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
}

/**
 * Convert timestamp to milliseconds
 * Handles both numeric timestamps and ISO date strings
 */
function toTimestamp(value) {
  if (!value) return Date.now();

  // If it's a number, return as-is
  if (typeof value === 'number') return value;

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    if (!isNaN(parsed)) return parsed;
  }

  // Default to current time
  return Date.now();
}

/**
 * Connect to Redis
 */
async function connectRedis() {
  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380')
    }
  });

  client.on('error', (err) => console.error('Redis Client Error', err));
  await client.connect();
  console.log('✓ Connected to Redis');
  return client;
}

/**
 * Migration Statistics
 */
const stats = {
  users: { scanned: 0, migrated: 0, skipped: 0, errors: 0 },
  books: { scanned: 0, migrated: 0, skipped: 0, errors: 0 },
  chapters: { scanned: 0, migrated: 0, skipped: 0, errors: 0 },
  errors: []
};

/**
 * Migrate Users
 */
async function migrateUsers(redis) {
  if (SKIP_USERS) {
    console.log('⏭️  Skipping user migration (--skip-users)');
    return;
  }

  console.log('\n📦 Migrating Users...');

  for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 100 })) {
    stats.users.scanned++;

    // Skip non-user keys (like user:email:*, user:undefined:*)
    if (key.includes(':email:') || key.includes(':undefined:') || key.split(':').length > 2) {
      console.log(`  ⏭️  Skipping non-user key: ${key}`);
      stats.users.skipped++;
      continue;
    }

    try {
      const data = await redis.get(key);
      if (!data) {
        console.log(`  ⏭️  Skipping empty key: ${key}`);
        stats.users.skipped++;
        continue;
      }

      const user = JSON.parse(data);

      // Validate user has required fields
      if (!user.email || !user.password) {
        console.log(`  ⏭️  Skipping invalid user (missing email/password): ${key}`);
        stats.users.skipped++;
        continue;
      }

      // Convert ID to UUID first
      const convertedId = timestampToUUID(user.id);

      // Check if user already exists in PostgreSQL
      const existing = await UserRepository.findById(convertedId);
      if (existing) {
        console.log(`  ⏭️  User ${user.email} already exists (${user.id})`);
        stats.users.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate user: ${user.email} (${user.id})`);
        stats.users.migrated++;
        continue;
      }

      // Prepare user data for PostgreSQL
      const userData = {
        id: convertedId,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        password_hash: user.password,
        tier: user.tier || 'free'
      };

      // Store original ID mapping if conversion happened
      if (user.id !== convertedId) {
        console.log(`    Converted ID: ${user.id} → ${convertedId}`);
      }

      // Create user (this also creates settings and quotas)
      await query(
        `INSERT INTO users (id, email, name, password_hash, tier, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6/1000.0), to_timestamp($7/1000.0))
         ON CONFLICT (id) DO NOTHING`,
        [
          userData.id,
          userData.email,
          userData.name,
          userData.password_hash,
          userData.tier,
          toTimestamp(user.createdAt),
          toTimestamp(user.updatedAt)
        ]
      );

      // Migrate user settings
      const aiConfig = user.aiConfig || {};
      const preferences = user.preferences || {};

      // Encrypt API keys before storing
      if (aiConfig.openaiApiKey) {
        aiConfig.openaiApiKey = encryptApiKey(aiConfig.openaiApiKey);
      }
      if (aiConfig.geminiApiKey) {
        aiConfig.geminiApiKey = encryptApiKey(aiConfig.geminiApiKey);
      }

      await query(
        `INSERT INTO user_settings (user_id, ai_config, preferences)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
         SET ai_config = $2, preferences = $3`,
        [userData.id, JSON.stringify(aiConfig), JSON.stringify(preferences)]
      );

      // Create quota record
      const tier = userData.tier;
      await query(
        `INSERT INTO quotas (user_id, max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          userData.id,
          tier === 'free' ? 3 : tier === 'basic' ? 10 : 999999,
          tier === 'free' ? 50000 : tier === 'basic' ? 200000 : 999999999,
          tier === 'free' ? 30 : tier === 'basic' ? 100 : 999999,
          tier === 'free' ? 10 : tier === 'basic' ? 50 : 200,
          tier === 'free' ? 1 : tier === 'basic' ? 3 : 10
        ]
      );

      console.log(`  ✓ Migrated user: ${user.email} (${user.id})`);
      stats.users.migrated++;

    } catch (error) {
      console.error(`  ❌ Error migrating user ${key}:`, error.message);
      stats.users.errors++;
      stats.errors.push({ type: 'user', key, error: error.message });
    }
  }

  console.log(`\n✅ Users: ${stats.users.migrated} migrated, ${stats.users.skipped} skipped, ${stats.users.errors} errors`);
}

/**
 * Migrate Books and Chapters
 */
async function migrateBooks(redis) {
  if (SKIP_BOOKS) {
    console.log('⏭️  Skipping book migration (--skip-books)');
    return;
  }

  console.log('\n📚 Migrating Books...');

  for await (const key of redis.scanIterator({ MATCH: 'book:*', COUNT: 100 })) {
    stats.books.scanned++;

    try {
      const data = await redis.get(key);
      if (!data) {
        console.log(`  ⏭️  Skipping empty book: ${key}`);
        stats.books.skipped++;
        continue;
      }

      const book = JSON.parse(data);

      // Skip books without owner or ID
      if (!book.id || !book.ownerId) {
        console.log(`  ⏭️  Skipping book with missing ID or owner: ${key}`);
        console.log(`     Book data: id=${book.id}, ownerId=${book.ownerId}, title=${book.title}`);
        stats.books.skipped++;
        continue;
      }

      // Convert IDs to UUIDs first
      const convertedBookId = timestampToUUID(book.id);

      // Check if book already exists
      const existing = await BookRepository.findById(convertedBookId);
      if (existing) {
        console.log(`  ⏭️  Book "${book.title}" already exists (${book.id})`);
        stats.books.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate book: "${book.title}" (${book.id}) with ${book.chapters?.length || 0} chapters`);
        stats.books.migrated++;
        stats.chapters.migrated += book.chapters?.length || 0;
        continue;
      }

      // Prepare book data
      const bookData = {
        id: convertedBookId,
        owner_id: timestampToUUID(book.ownerId),
        title: book.title,
        description: book.description || '',
        genre: book.genre || '',
        target_audience: book.targetAudience || '',
        characters: book.characters || [],
        locations: book.locations || [],
        plotlines: book.plotlines || [],
        world_building: book.worldBuilding || {},
        settings: book.settings || {},
        status: book.status || 'draft',
        word_count: 0, // Will be calculated from chapters
        chapter_count: 0 // Will be calculated from chapters
      };

      // Create book
      await query(
        `INSERT INTO books (
          id, owner_id, title, description, genre, target_audience,
          characters, locations, plotlines, world_building, settings, status,
          created_at, updated_at, version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, to_timestamp($13/1000.0), to_timestamp($14/1000.0), 1)
        ON CONFLICT (id) DO NOTHING`,
        [
          bookData.id,
          bookData.owner_id,
          bookData.title,
          bookData.description,
          bookData.genre,
          bookData.target_audience,
          JSON.stringify(bookData.characters),
          JSON.stringify(bookData.locations),
          JSON.stringify(bookData.plotlines),
          JSON.stringify(bookData.world_building),
          JSON.stringify(bookData.settings),
          bookData.status,
          toTimestamp(book.createdAt),
          toTimestamp(book.updatedAt)
        ]
      );

      // Migrate collaborators
      if (book.collaborators && book.collaborators.length > 0) {
        for (const collab of book.collaborators) {
          await query(
            `INSERT INTO collaborators (book_id, email, role, status, invited_at, accepted_at)
             VALUES ($1, $2, $3, $4, NOW(), CASE WHEN $4 = 'active' THEN NOW() ELSE NULL END)
             ON CONFLICT (book_id, email) DO NOTHING`,
            [bookData.id, collab.email, collab.role || 'viewer', collab.status || 'active']
          );
        }
      }

      // Migrate chapters
      let totalWordCount = 0;
      if (book.chapters && book.chapters.length > 0) {
        for (const chapter of book.chapters) {
          stats.chapters.scanned++;

          try {
            const content = chapter.content || '';
            const wordCount = content.trim().split(/\s+/).filter(w => w.length > 0).length;
            totalWordCount += wordCount;

            const chapterId = timestampToUUID(chapter.id || `${book.id}-ch-${chapter.number}`);

            await query(
              `INSERT INTO chapters (
                id, book_id, chapter_number, title, content, scenes, notes,
                word_count, status, created_at, updated_at, version
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10/1000.0), to_timestamp($11/1000.0), 1)
              ON CONFLICT (id) DO NOTHING`,
              [
                chapterId,
                bookData.id,
                chapter.number || chapter.chapter_number,
                chapter.title || `Chapter ${chapter.number}`,
                content,
                JSON.stringify(chapter.scenes || []),
                chapter.notes || '',
                wordCount,
                chapter.status || 'draft',
                toTimestamp(chapter.createdAt),
                toTimestamp(chapter.updatedAt)
              ]
            );

            // Create initial version
            await query(
              `INSERT INTO chapter_versions (
                chapter_id, version_number, content, scenes, word_count, created_at
              )
              VALUES ($1, 1, $2, $3, $4, to_timestamp($5/1000.0))
              ON CONFLICT (chapter_id, version_number) DO NOTHING`,
              [
                chapterId,
                content,
                JSON.stringify(chapter.scenes || []),
                wordCount,
                toTimestamp(chapter.createdAt)
              ]
            );

            stats.chapters.migrated++;

          } catch (error) {
            console.error(`    ❌ Error migrating chapter ${chapter.number}:`, error.message);
            stats.chapters.errors++;
          }
        }
      }

      // Update book statistics
      await query(
        `UPDATE books
         SET word_count = $1, chapter_count = $2
         WHERE id = $3`,
        [totalWordCount, book.chapters?.length || 0, bookData.id]
      );

      console.log(`  ✓ Migrated book: "${book.title}" (${book.chapters?.length || 0} chapters, ${totalWordCount} words)`);
      stats.books.migrated++;

    } catch (error) {
      console.error(`  ❌ Error migrating book ${key}:`, error.message);
      stats.books.errors++;
      stats.errors.push({ type: 'book', key, error: error.message });
    }
  }

  console.log(`\n✅ Books: ${stats.books.migrated} migrated, ${stats.books.skipped} skipped, ${stats.books.errors} errors`);
  console.log(`✅ Chapters: ${stats.chapters.migrated} migrated, ${stats.chapters.errors} errors`);
}

/**
 * Verify migration
 */
async function verifyMigration(redis) {
  console.log('\n🔍 Verifying migration...');

  // Count Redis data
  let redisUserCount = 0;
  let redisBookCount = 0;

  for await (const key of redis.scanIterator({ MATCH: 'user:*' })) {
    redisUserCount++;
  }

  for await (const key of redis.scanIterator({ MATCH: 'book:*' })) {
    redisBookCount++;
  }

  // Count PostgreSQL data
  const pgUserResult = await query('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL');
  const pgBookResult = await query('SELECT COUNT(*) as count FROM books WHERE deleted_at IS NULL');
  const pgChapterResult = await query('SELECT COUNT(*) as count FROM chapters WHERE deleted_at IS NULL');

  const pgUserCount = parseInt(pgUserResult.rows[0].count);
  const pgBookCount = parseInt(pgBookResult.rows[0].count);
  const pgChapterCount = parseInt(pgChapterResult.rows[0].count);

  console.log('\n📊 Migration Summary:');
  console.log('═'.repeat(60));
  console.log(`Redis Users:       ${redisUserCount}`);
  console.log(`PostgreSQL Users:  ${pgUserCount}`);
  console.log(`Match:             ${redisUserCount === pgUserCount ? '✅' : '❌'}`);
  console.log('');
  console.log(`Redis Books:       ${redisBookCount}`);
  console.log(`PostgreSQL Books:  ${pgBookCount}`);
  console.log(`Match:             ${redisBookCount === pgBookCount ? '✅' : '❌'}`);
  console.log('');
  console.log(`PostgreSQL Chapters: ${pgChapterCount}`);
  console.log('═'.repeat(60));

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  ${stats.errors.length} errors occurred during migration:`);
    stats.errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. [${err.type}] ${err.key}: ${err.error}`);
    });
  }

  return {
    redisUserCount,
    redisBookCount,
    pgUserCount,
    pgBookCount,
    pgChapterCount,
    allMatched: redisUserCount === pgUserCount && redisBookCount === pgBookCount
  };
}

/**
 * Main migration function
 */
async function main() {
  console.log('🚀 Redis to PostgreSQL Migration');
  console.log('═'.repeat(60));

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
  }

  console.log(`Redis: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
  console.log(`PostgreSQL: ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${process.env.POSTGRES_DB}`);
  console.log('═'.repeat(60));

  const redis = await connectRedis();

  try {
    const startTime = Date.now();

    // Migrate users first
    await migrateUsers(redis);

    // Migrate books and chapters
    await migrateBooks(redis);

    // Verify migration
    const verification = await verifyMigration(redis);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n⏱️  Migration completed in ${duration} seconds`);

    if (DRY_RUN) {
      console.log('\n✅ Dry run complete! Review the output above.');
      console.log('   To perform the actual migration, run without --dry-run flag.');
    } else if (verification.allMatched && stats.errors.length === 0) {
      console.log('\n✅ Migration successful! All data migrated correctly.');
      console.log('\nNext steps:');
      console.log('1. Update .env: USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=false');
      console.log('2. Restart the application');
      console.log('3. Monitor for 24-48 hours');
      console.log('4. Update .env: READ_FROM_POSTGRES=true');
      console.log('5. Monitor for another 24-48 hours');
      console.log('6. Update .env: DUAL_WRITE=false (PostgreSQL only)');
    } else {
      console.log('\n⚠️  Migration completed with issues. Please review errors above.');
      console.log('   Fix the issues and re-run the migration.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await redis.quit();
    console.log('\n✓ Disconnected from Redis');
    process.exit(0);
  }
}

// Run migration
main().catch(console.error);
