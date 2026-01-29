#!/usr/bin/env node

/**
 * Test book API response
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'story_writing',
  user: process.env.POSTGRES_USER || 'story_user',
  password: process.env.POSTGRES_PASSWORD || 'lg4eC9aS9MAosq4dNZ/HLbZrVqvDqvOR',
  ssl: {
    rejectUnauthorized: false
  }
});

async function testBookData() {
  const client = await pool.connect();

  try {
    // Get the book
    const result = await client.query(`
      SELECT * FROM books WHERE deleted_at IS NULL LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('No books found');
      return;
    }

    const book = result.rows[0];
    console.log('Raw PostgreSQL book data:');
    console.log(JSON.stringify(book, null, 2));

    console.log('\nField types:');
    console.log('characters type:', typeof book.characters);
    console.log('locations type:', typeof book.locations);
    console.log('plotlines type:', typeof book.plotlines);
    console.log('chapters type:', typeof book.chapters);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testBookData();
