#!/usr/bin/env node

/**
 * Check PostgreSQL data (for debugging)
 */

import pg from 'pg';
import { loadPgConfig } from './pgEnv.js';

const { Pool } = pg;

const pool = new Pool(loadPgConfig());

async function checkData() {
  const client = await pool.connect();

  try {
    console.log('📊 PostgreSQL Data Check\n');

    // Check users
    const users = await client.query('SELECT id, email, name, created_at FROM users WHERE deleted_at IS NULL');
    console.log(`Users: ${users.rows.length}`);
    users.rows.forEach(user => {
      console.log(`  - ${user.email} (${user.id})`);
    });

    console.log('');

    // Check books
    const books = await client.query(`
      SELECT b.id, b.owner_id, b.title, b.status, b.created_at, u.email as owner_email
      FROM books b
      JOIN users u ON b.owner_id = u.id
      WHERE b.deleted_at IS NULL
      ORDER BY b.created_at DESC
    `);
    console.log(`Books: ${books.rows.length}`);
    books.rows.forEach(book => {
      console.log(`  - "${book.title}" by ${book.owner_email} (${book.id})`);
      console.log(`    Status: ${book.status}, Owner ID: ${book.owner_id}`);
    });

    console.log('');

    // Check chapters
    const chapters = await client.query('SELECT COUNT(*) as count FROM chapters WHERE deleted_at IS NULL');
    console.log(`Chapters: ${chapters.rows[0].count}`);

    console.log('');

    // Check jobs
    const jobs = await client.query('SELECT COUNT(*) as count FROM jobs');
    console.log(`Jobs: ${jobs.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkData();
