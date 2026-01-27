#!/usr/bin/env node

/**
 * Verify PostgreSQL Migration
 *
 * Checks that data was migrated correctly from Redis to PostgreSQL
 */

import { query, getPool } from '../db/postgres.js';
import { UserRepository, BookRepository, ChapterRepository } from '../db/repositories/index.js';
import dotenv from 'dotenv';

dotenv.config();

async function verifyMigration() {
  console.log('🔍 Verifying PostgreSQL Migration');
  console.log('═'.repeat(60));

  try {
    // Check connection
    await getPool().query('SELECT NOW()');
    console.log('✓ PostgreSQL connection successful\n');

    // Check users
    const usersResult = await query(
      'SELECT id, email, name, tier, created_at FROM users WHERE deleted_at IS NULL'
    );
    console.log(`📦 Users: ${usersResult.rows.length}`);
    usersResult.rows.forEach(user => {
      console.log(`  - ${user.email} (${user.name}) - ${user.tier} tier`);
      console.log(`    ID: ${user.id}`);
      console.log(`    Created: ${user.created_at}`);
    });

    // Check user settings
    const settingsResult = await query(
      'SELECT user_id, ai_config, preferences FROM user_settings'
    );
    console.log(`\n⚙️  User Settings: ${settingsResult.rows.length}`);
    settingsResult.rows.forEach(setting => {
      const aiConfig = setting.ai_config || {};
      console.log(`  - User ${setting.user_id}`);
      if (aiConfig.openaiApiKey) {
        console.log(`    Has OpenAI key: ${aiConfig.openaiApiKey.substring(0, 20)}...`);
      }
      if (aiConfig.geminiApiKey) {
        console.log(`    Has Gemini key: ${aiConfig.geminiApiKey.substring(0, 20)}...`);
      }
    });

    // Check quotas
    const quotasResult = await query(
      'SELECT user_id, max_books, max_words, max_chapters, current_books, current_words FROM quotas'
    );
    console.log(`\n📊 Quotas: ${quotasResult.rows.length}`);
    quotasResult.rows.forEach(quota => {
      console.log(`  - User ${quota.user_id}`);
      console.log(`    Books: ${quota.current_books}/${quota.max_books}`);
      console.log(`    Words: ${quota.current_words}/${quota.max_words}`);
      console.log(`    Chapters: ${quota.current_chapters || 0}/${quota.max_chapters}`);
    });

    // Check books
    const booksResult = await query(
      'SELECT id, owner_id, title, genre, status, chapter_count, word_count, created_at FROM books WHERE deleted_at IS NULL'
    );
    console.log(`\n📚 Books: ${booksResult.rows.length}`);
    booksResult.rows.forEach(book => {
      console.log(`  - "${book.title}" by ${book.owner_id}`);
      console.log(`    ID: ${book.id}`);
      console.log(`    Genre: ${book.genre} | Status: ${book.status}`);
      console.log(`    Chapters: ${book.chapter_count} | Words: ${book.word_count}`);
      console.log(`    Created: ${book.created_at}`);
    });

    // Check chapters
    const chaptersResult = await query(
      'SELECT id, book_id, chapter_number, title, word_count, status FROM chapters WHERE deleted_at IS NULL ORDER BY book_id, chapter_number'
    );
    console.log(`\n📄 Chapters: ${chaptersResult.rows.length}`);
    if (chaptersResult.rows.length > 0) {
      let currentBookId = null;
      chaptersResult.rows.forEach(chapter => {
        if (chapter.book_id !== currentBookId) {
          console.log(`\n  Book: ${chapter.book_id}`);
          currentBookId = chapter.book_id;
        }
        console.log(`    ${chapter.chapter_number}. ${chapter.title} (${chapter.word_count} words, ${chapter.status})`);
      });
    }

    // Check chapter versions
    const versionsResult = await query(
      'SELECT chapter_id, COUNT(*) as version_count FROM chapter_versions GROUP BY chapter_id'
    );
    console.log(`\n📝 Chapter Versions: ${versionsResult.rows.reduce((sum, row) => sum + parseInt(row.version_count), 0)} total`);
    if (versionsResult.rows.length > 0) {
      console.log(`   Across ${versionsResult.rows.length} chapters`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Verification complete!');

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await getPool().end();
  }
}

verifyMigration();
