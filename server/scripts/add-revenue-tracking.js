import pg from 'pg';

const { Client } = pg;

async function addRevenueTracking() {
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

    // Add indexes for revenue queries
    console.log('\n📝 Adding revenue tracking indexes...\n');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at DESC);`);
    console.log('✓ idx_payments_status_created created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC);`);
    console.log('✓ idx_payments_user_created created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status) WHERE status = 'active';`);
    console.log('✓ idx_subscriptions_status created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);`);
    console.log('✓ idx_subscriptions_tier created');

    // Create webhook events log table
    console.log('\n📝 Creating stripe_webhook_events table...\n');

    await client.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id SERIAL PRIMARY KEY,
        event_id VARCHAR(255) UNIQUE NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        processed BOOLEAN DEFAULT false,
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ stripe_webhook_events table created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON stripe_webhook_events(event_type);`);
    console.log('✓ idx_webhook_events_type created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON stripe_webhook_events(processed);`);
    console.log('✓ idx_webhook_events_processed created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON stripe_webhook_events(created_at DESC);`);
    console.log('✓ idx_webhook_events_created created');

    // Add cancellation tracking columns
    console.log('\n📝 Adding cancellation tracking to subscriptions...\n');

    await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;`);
    console.log('✓ cancellation_reason column added');

    await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_by_admin_id UUID REFERENCES users(id);`);
    console.log('✓ canceled_by_admin_id column added');

    // Create materialized view for revenue metrics
    console.log('\n📝 Creating revenue_metrics materialized view...\n');

    // Drop existing view if it exists
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS revenue_metrics;`);

    await client.query(`
      CREATE MATERIALIZED VIEW revenue_metrics AS
      SELECT
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) FILTER (WHERE status = 'succeeded') as successful_payments,
        SUM(amount) FILTER (WHERE status = 'succeeded') as daily_revenue,
        COUNT(DISTINCT user_id) FILTER (WHERE status = 'succeeded') as paying_users
      FROM payments
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date DESC;
    `);
    console.log('✓ revenue_metrics view created');

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_metrics_date ON revenue_metrics(date);`);
    console.log('✓ idx_revenue_metrics_date created');

    // Create refresh function
    console.log('\n📝 Creating revenue metrics refresh function...\n');

    await client.query(`
      CREATE OR REPLACE FUNCTION refresh_revenue_metrics()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY revenue_metrics;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✓ refresh_revenue_metrics() function created');

    console.log('\n✅ All revenue tracking enhancements completed successfully!');
    console.log('\nNote: Run "SELECT refresh_revenue_metrics();" daily to update metrics');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

addRevenueTracking().catch(console.error);
