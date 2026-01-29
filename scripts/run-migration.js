#!/usr/bin/env node

/**
 * Run database migration
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function runMigration(filename) {
  const client = await pool.connect();

  try {
    const migrationPath = path.join(__dirname, '..', 'server', 'db', 'migrations', filename);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`\n📋 Running migration: ${filename}\n`);

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log(`✅ Migration ${filename} completed successfully!\n`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Migration failed:`, error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: node run-migration.js <migration-file.sql>');
  process.exit(1);
}

runMigration(migrationFile);
