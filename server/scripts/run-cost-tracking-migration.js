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
    const migrationPath = join(__dirname, '..', 'db', 'migrations', 'add_ai_cost_tracking.sql');
    const migration = readFileSync(migrationPath, 'utf8');
    console.log('✓ Read migration file: add_ai_cost_tracking.sql');

    // Execute migration
    console.log('\n📝 Executing AI Cost Tracking migration...\n');
    await client.query(migration);
    console.log('✅ Migration executed successfully!\n');

    // Verify tables created
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN ('ai_cost_summary', 'ai_pricing')
      ORDER BY table_name
    `);

    console.log('📊 New Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    // Verify columns added to ai_generations
    const columnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'ai_generations'
      AND column_name IN ('prompt_tokens', 'completion_tokens', 'total_tokens', 'estimated_cost_usd')
      ORDER BY column_name
    `);

    console.log('\n📊 Columns added to ai_generations:');
    columnsResult.rows.forEach(row => {
      console.log(`  ✓ ${row.column_name}`);
    });

    // Verify pricing data
    const pricingResult = await client.query(`
      SELECT model_name, input_price_per_1m, output_price_per_1m, unit_price
      FROM ai_pricing
      WHERE is_active = TRUE
      ORDER BY model_name
    `);

    console.log('\n💰 AI Pricing data loaded:');
    pricingResult.rows.forEach(row => {
      if (row.unit_price) {
        console.log(`  ✓ ${row.model_name}: $${row.unit_price} per unit`);
      } else {
        console.log(`  ✓ ${row.model_name}: $${row.input_price_per_1m}/$${row.output_price_per_1m} per 1M tokens`);
      }
    });

    // Verify functions created
    const functionsResult = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND routine_type = 'FUNCTION'
      AND routine_name IN ('update_ai_cost_summary', 'calculate_generation_cost')
      ORDER BY routine_name
    `);

    console.log('\n⚙️  Functions created:');
    functionsResult.rows.forEach(row => {
      console.log(`  ✓ ${row.routine_name}()`);
    });

    // Verify views created
    const viewsResult = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      AND table_name IN ('v_user_monthly_costs', 'v_daily_system_costs')
      ORDER BY table_name
    `);

    console.log('\n👁️  Views created:');
    viewsResult.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    console.log('\n✅ AI Cost Tracking migration complete!');
    console.log('\n📋 Summary:');
    console.log('  • ai_cost_summary table - daily aggregated costs per user');
    console.log('  • ai_pricing table - model pricing for cost calculation');
    console.log('  • Enhanced ai_generations with token tracking columns');
    console.log('  • Automatic trigger to update daily summaries');
    console.log('  • Helper functions for cost calculation');
    console.log('  • Views for common cost queries');

  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    if (error.detail) {
      console.error(`   Detail: ${error.detail}`);
    }
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }

    // If error is about table/column already existing, that's OK
    if (error.message.includes('already exists')) {
      console.log('\n⚠️  Some objects already exist - this is safe to ignore if re-running migrations');
    } else {
      throw error;
    }
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
