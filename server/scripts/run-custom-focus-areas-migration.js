import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const client = new Client({
    host: 'story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com',
    port: 5432,
    user: 'story_user',
    password: 'lg4eC9aS9MAosq4dNZ/HLbZrVqvDqvOR',
    database: 'story_writing',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✓ Connected to story_writing database');

    // Read migration file
    const migrationPath = join(__dirname, '..', 'db', 'migrations', 'add_custom_focus_areas.sql');
    const migration = readFileSync(migrationPath, 'utf8');
    console.log('✓ Read migration file: add_custom_focus_areas.sql');

    // Execute migration
    console.log('\n📝 Executing Custom Focus Areas migration...\n');
    await client.query(migration);
    console.log('✅ Migration executed successfully!\n');

    // Verify column added to books table
    const columnsResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'books'
      AND column_name = 'custom_focus_areas'
    `);

    if (columnsResult.rows.length > 0) {
      console.log('📊 Column added to books table:');
      columnsResult.rows.forEach(row => {
        console.log(`  ✓ ${row.column_name} (${row.data_type})`);
      });
    } else {
      console.log('⚠️  Warning: custom_focus_areas column not found');
    }

    // Verify index created
    const indexResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'books'
      AND indexname = 'idx_books_custom_focus_areas'
    `);

    if (indexResult.rows.length > 0) {
      console.log('\n📊 Index created:');
      indexResult.rows.forEach(row => {
        console.log(`  ✓ ${row.indexname}`);
      });
    }

    console.log('\n✅ Custom Focus Areas migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
