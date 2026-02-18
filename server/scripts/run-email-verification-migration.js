import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function runMigration() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✓ Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', 'add_email_verification.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('\n📝 Running email verification migration...\n');

    // Run migration
    await client.query(migrationSQL);

    console.log('✅ Email verification migration completed successfully!');

    // Verify changes
    console.log('\n🔍 Verifying changes...\n');

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('email_verified', 'email_verification_token', 'email_verification_token_expires')
      ORDER BY column_name;
    `);

    console.log('New columns added to users table:');
    console.table(result.rows);

    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'email_verification_log';
    `);

    if (tableCheck.rows.length > 0) {
      console.log('\n✓ email_verification_log table created successfully');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n✓ Database connection closed');
  }
}

runMigration();
