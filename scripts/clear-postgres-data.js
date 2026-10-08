#!/usr/bin/env node

/**
 * Clear PostgreSQL application data (start fresh)
 * This keeps the schema but removes all data
 */

import pg from 'pg';
import { loadPgConfig } from './pgEnv.js';

const { Pool } = pg;

const pool = new Pool(loadPgConfig());

async function clearData() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Clearing PostgreSQL application data...\n');

    await client.query('BEGIN');

    // Get counts before deletion
    const beforeCounts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM books) as books,
        (SELECT COUNT(*) FROM chapters) as chapters,
        (SELECT COUNT(*) FROM jobs) as jobs
    `);

    console.log('📊 Data before clearing:');
    console.log(`   Users: ${beforeCounts.rows[0].users}`);
    console.log(`   Books: ${beforeCounts.rows[0].books}`);
    console.log(`   Chapters: ${beforeCounts.rows[0].chapters}`);
    console.log(`   Jobs: ${beforeCounts.rows[0].jobs}\n`);

    // Delete data (cascade will handle foreign keys)
    console.log('🧹 Deleting data...');

    await client.query('DELETE FROM jobs');
    console.log('   ✓ Jobs cleared');

    await client.query('DELETE FROM chapter_versions');
    console.log('   ✓ Chapter versions cleared');

    await client.query('DELETE FROM chapters');
    console.log('   ✓ Chapters cleared');

    await client.query('DELETE FROM books');
    console.log('   ✓ Books cleared');

    // Try to delete from optional tables (might not exist in current schema)
    try {
      await client.query('DELETE FROM user_settings');
      console.log('   ✓ User settings cleared');
    } catch (e) {
      console.log('   ⊘ User settings table not found (skipping)');
    }

    await client.query('DELETE FROM users');
    console.log('   ✓ Users cleared');

    await client.query('COMMIT');

    console.log('\n✅ PostgreSQL data cleared successfully!\n');
    console.log('📝 Schema remains intact - ready for fresh data');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error clearing data:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

clearData();
