import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runSchema() {
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

    // Read schema file
    const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    console.log('✓ Read schema file');

    // Execute schema
    console.log('\n📝 Executing schema...\n');
    await client.query(schema);
    console.log('✅ Schema executed successfully!\n');

    // Verify tables created
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('📊 Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    // Verify views created
    const viewsResult = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('\n👁️  Views created:');
    viewsResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    // Verify functions created
    const functionsResult = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND routine_type = 'FUNCTION'
      ORDER BY routine_name
    `);

    console.log('\n⚙️  Functions created:');
    functionsResult.rows.forEach(row => {
      console.log(`  - ${row.routine_name}`);
    });

    // Check schema version
    const versionResult = await client.query('SELECT * FROM schema_version ORDER BY applied_at DESC LIMIT 1');
    if (versionResult.rows.length > 0) {
      const version = versionResult.rows[0];
      console.log(`\n✅ Schema Version: ${version.version} (${version.description})`);
      console.log(`   Applied at: ${version.applied_at}`);
    }

    console.log('\n✅ Database schema is ready!');
    console.log('\nNext steps:');
    console.log('1. Create repository classes');
    console.log('2. Create data service layer');
    console.log('3. Set up dual-write functionality');

  } catch (error) {
    console.error('❌ Error running schema:', error.message);
    if (error.position) {
      console.error(`   Error at position: ${error.position}`);
    }
    throw error;
  } finally {
    await client.end();
  }
}

runSchema().catch(console.error);
