import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'story_user',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'story_writing',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✓ Connected to story_writing database');

    // Read migration file
    const migrationPath = join(__dirname, '..', 'db', 'migrations', 'add_template_books.sql');
    const migration = readFileSync(migrationPath, 'utf8');
    console.log('✓ Read migration file: add_template_books.sql');

    // Execute migration
    console.log('\n📝 Executing Template Books migration...\n');
    await client.query(migration);
    console.log('✅ Migration executed successfully!\n');

    // Verify columns added
    const columnsResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'books'
      AND column_name IN ('is_template', 'template_category', 'template_description', 'template_tags', 'clone_count')
    `);

    if (columnsResult.rows.length > 0) {
      console.log('📊 Columns added to books table:');
      columnsResult.rows.forEach(row => {
        console.log(`  ✓ ${row.column_name} (${row.data_type})`);
      });
    }

    // Verify table created
    const tableResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'template_clones'
    `);

    if (tableResult.rows.length > 0) {
      console.log('\n📊 Table created:');
      console.log(`  ✓ template_clones`);
    }

    console.log('\n✅ Template Books migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
