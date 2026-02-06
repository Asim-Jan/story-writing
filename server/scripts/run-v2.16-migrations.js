import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations() {
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

    // Migration 1: Continuity Analyses Table
    console.log('\n📝 Running migration 1: add_continuity_analyses.sql...');
    const migration1Path = join(__dirname, '..', 'db', 'migrations', 'add_continuity_analyses.sql');
    const migration1 = readFileSync(migration1Path, 'utf8');
    await client.query(migration1);
    console.log('✅ Migration 1 executed successfully!\n');

    // Migration 2: AI Generations Table
    console.log('📝 Running migration 2: add_ai_generations.sql...');
    const migration2Path = join(__dirname, '..', 'db', 'migrations', 'add_ai_generations.sql');
    const migration2 = readFileSync(migration2Path, 'utf8');
    await client.query(migration2);
    console.log('✅ Migration 2 executed successfully!\n');

    // Verify tables created
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN ('continuity_analyses', 'ai_generations')
      ORDER BY table_name
    `);

    console.log('📊 v2.16.0 Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    // Verify indexes
    const indexesResult = await client.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('continuity_analyses', 'ai_generations')
      ORDER BY tablename, indexname
    `);

    console.log('\n🔍 Indexes created:');
    indexesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.tablename}.${row.indexname}`);
    });

    console.log('\n✅ All v2.16.0 migrations complete!');
    console.log('\n📋 Summary:');
    console.log('  • continuity_analyses table - stores analysis history');
    console.log('  • ai_generations table - stores AI generation history');
    console.log('  • Indexes for performance optimization');
    console.log('  • Foreign key constraints for data integrity');

  } catch (error) {
    console.error('❌ Error running migrations:', error.message);
    if (error.detail) {
      console.error(`   Detail: ${error.detail}`);
    }
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }

    // If error is about table already existing, that's OK
    if (error.message.includes('already exists')) {
      console.log('\n⚠️  Tables already exist - this is safe to ignore if re-running migrations');
    } else {
      throw error;
    }
  } finally {
    await client.end();
  }
}

runMigrations().catch(console.error);
