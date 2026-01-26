import { createClient } from 'redis';
import { mediaStorage } from '../services/mediaStorage.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Migration Script: Move existing media files to MinIO
 * Migrates files from /public/* to MinIO and updates book data
 */

const getBookKey = (bookId) => `book:${bookId}`;

async function migrateMedia() {
  console.log('🚀 Starting media migration to MinIO...\n');

  // Connect to Redis
  const redisClient = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    }
  });

  await redisClient.connect();
  console.log('✓ Connected to Redis\n');

  // Initialize MinIO
  try {
    await mediaStorage.initialize();
    console.log('✓ MinIO initialized\n');
  } catch (error) {
    console.error('✗ Failed to initialize MinIO:', error.message);
    console.error('Make sure MinIO is running: docker-compose up -d minio');
    process.exit(1);
  }

  // Media directories
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const mediaDirectories = {
    images: path.join(publicDir, 'images'),
    audio: path.join(publicDir, 'audio'),
    comics: path.join(publicDir, 'comics'),
  };

  const stats = {
    booksProcessed: 0,
    filesUploaded: 0,
    filesFailed: 0,
    booksUpdated: 0,
    totalSize: 0,
  };

  // Step 1: Upload all existing files to MinIO
  console.log('📁 Uploading existing files to MinIO...\n');

  for (const [bucketType, dirPath] of Object.entries(mediaDirectories)) {
    if (!fs.existsSync(dirPath)) {
      console.log(`⊘ Directory not found: ${dirPath}`);
      continue;
    }

    const files = fs.readdirSync(dirPath);
    console.log(`  ${bucketType}: ${files.length} files`);

    for (const filename of files) {
      if (filename === '.gitkeep' || filename.startsWith('.')) continue;

      const filePath = path.join(dirPath, filename);
      const fileStats = fs.statSync(filePath);

      if (!fileStats.isFile()) continue;

      try {
        // Check if already exists in MinIO
        const exists = await mediaStorage.exists(bucketType, filename);
        if (exists) {
          console.log(`    ⊙ ${filename} (already in MinIO)`);
          continue;
        }

        // Upload to MinIO
        await mediaStorage.uploadFile(bucketType, filePath, filename);
        stats.filesUploaded++;
        stats.totalSize += fileStats.size;
        console.log(`    ✓ ${filename} (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (error) {
        console.error(`    ✗ ${filename}: ${error.message}`);
        stats.filesFailed++;
      }
    }
  }

  console.log(`\n✓ Uploaded ${stats.filesUploaded} files (${(stats.totalSize / 1024 / 1024).toFixed(2)} MB)\n`);

  // Step 2: Update book data with storage keys
  console.log('📚 Updating book data with storage keys...\n');

  // Get all book keys
  const keys = [];
  const stream = redisClient.scanIterator({ MATCH: 'book:*', COUNT: 100 });
  for await (const key of stream) {
    keys.push(key);
  }

  console.log(`Found ${keys.length} books\n`);

  for (const key of keys) {
    const bookId = key.replace('book:', '');
    const data = await redisClient.get(key);
    if (!data) continue;

    let book = JSON.parse(data);
    let updated = false;

    // Update visuals
    if (book.visuals && Array.isArray(book.visuals)) {
      book.visuals = book.visuals.map(visual => {
        if (visual.storageKey) return visual; // Already migrated

        const filename = visual.filename || extractFilenameFromUrl(visual.url);
        if (!filename) return visual;

        updated = true;
        return {
          ...visual,
          url: `/api/media/images/${filename}`,
          storageKey: `images/${filename}`,
          bucket: 'book-images',
        };
      });
    }

    // Update audioFiles
    if (book.audioFiles && typeof book.audioFiles === 'object') {
      for (const [chapterId, audioData] of Object.entries(book.audioFiles)) {
        if (audioData.storageKey) continue; // Already migrated

        const filename = audioData.filename || extractFilenameFromUrl(audioData.audioUrl);
        if (!filename) continue;

        updated = true;
        book.audioFiles[chapterId] = {
          ...audioData,
          audioUrl: `/api/media/audio/${filename}`,
          storageKey: `audio/${filename}`,
          bucket: 'book-audio',
        };
      }
    }

    // Update characterRefs
    if (book.characterRefs && typeof book.characterRefs === 'object') {
      for (const [charId, imageUrl] of Object.entries(book.characterRefs)) {
        if (typeof imageUrl === 'object' && imageUrl.storageKey) continue; // Already migrated

        const url = typeof imageUrl === 'string' ? imageUrl : imageUrl.url;
        const filename = extractFilenameFromUrl(url);
        if (!filename) continue;

        updated = true;
        book.characterRefs[charId] = {
          url: `/api/media/comics/${filename}`,
          storageKey: `comics/${filename}`,
          bucket: 'book-comics',
          filename,
        };
      }
    }

    // Update comicPages panels
    if (book.comicPages && Array.isArray(book.comicPages)) {
      book.comicPages = book.comicPages.map(page => ({
        ...page,
        panels: page.panels.map(panel => {
          if (panel.storageKey) return panel; // Already migrated

          const filename = panel.filename || extractFilenameFromUrl(panel.imageUrl);
          if (!filename) return panel;

          updated = true;
          return {
            ...panel,
            imageUrl: `/api/media/comics/${filename}`,
            storageKey: `comics/${filename}`,
            bucket: 'book-comics',
          };
        }),
      }));
    }

    // Save updated book
    if (updated) {
      await redisClient.set(key, JSON.stringify(book));
      stats.booksUpdated++;
      console.log(`  ✓ Updated book: ${book.bookTitle || bookId}`);
    }

    stats.booksProcessed++;
  }

  console.log(`\n📊 Migration Complete!\n`);
  console.log(`  Books processed: ${stats.booksProcessed}`);
  console.log(`  Books updated: ${stats.booksUpdated}`);
  console.log(`  Files uploaded: ${stats.filesUploaded}`);
  console.log(`  Files failed: ${stats.filesFailed}`);
  console.log(`  Total size migrated: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\n✅ All media is now centralized in MinIO!`);
  console.log(`   Access MinIO Console at: http://localhost:9001`);
  console.log(`   Username: minioadmin`);
  console.log(`   Password: minioadmin123\n`);

  await redisClient.quit();
  process.exit(0);
}

/**
 * Extract filename from URL
 * @param {string} url - URL or path
 * @returns {string|null} Filename
 */
function extractFilenameFromUrl(url) {
  if (!url) return null;

  // Handle both absolute URLs and relative paths
  const match = url.match(/\/(images|audio|comics)\/([^?#]+)/);
  if (match) {
    return match[2];
  }

  return null;
}

// Run migration
migrateMedia().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
