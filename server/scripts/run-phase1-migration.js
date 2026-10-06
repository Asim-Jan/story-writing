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
    const migrationPath = join(__dirname, '..', 'db', 'migrations', 'add_admin_phase1_tables.sql');
    const migration = readFileSync(migrationPath, 'utf8');
    console.log('✓ Read migration file: add_admin_phase1_tables.sql');

    // Execute migration
    console.log('\n📝 Executing Phase 1 Admin Tables migration...\n');
    await client.query(migration);
    console.log('✅ Migration executed successfully!\n');

    // Verify tables created
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN ('user_activity_log', 'login_history', 'content_flags', 'quota_violations', 'subscriptions', 'payments')
      ORDER BY table_name
    `);

    console.log('📊 Phase 1 Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    // Check if custom_quotas column was added
    const quotasColumnResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'quotas'
      AND column_name = 'custom_quotas'
    `);

    if (quotasColumnResult.rows.length > 0) {
      console.log('  ✓ custom_quotas column added to quotas table');
    }

    console.log('\n✅ Phase 1 Admin Tables migration complete!');

  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    if (error.position) {
      console.error(`   Error at position: ${error.position}`);
    }
    throw error;
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
