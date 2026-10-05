import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

async function createUserActivityTable() {
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

    // Create user_activity_log table
    console.log('\n📝 Creating user_activity_log table...\n');

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_activity_log (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        activity_type VARCHAR(50) NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ user_activity_log table created');

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON user_activity_log(user_id);`);
    console.log('✓ idx_user_activity_log_user_id created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_log_created_at ON user_activity_log(created_at DESC);`);
    console.log('✓ idx_user_activity_log_created_at created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_log_activity_type ON user_activity_log(activity_type);`);
    console.log('✓ idx_user_activity_log_activity_type created');

    // Create content_flags table
    console.log('\n📝 Creating content_flags table...\n');
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_flags (
        id SERIAL PRIMARY KEY,
        content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('book', 'chapter')),
        content_id UUID NOT NULL,
        flagged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
        reviewed_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP WITH TIME ZONE,
        admin_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ content_flags table created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_content_flags_content_type_id ON content_flags(content_type, content_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_content_flags_status ON content_flags(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_content_flags_created_at ON content_flags(created_at DESC);`);
    console.log('✓ content_flags indexes created');

    // Create quota_violations table
    console.log('\n📝 Creating quota_violations table...\n');
    await client.query(`
      CREATE TABLE IF NOT EXISTS quota_violations (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quota_type VARCHAR(50) NOT NULL,
        attempted_value INTEGER NOT NULL,
        limit_value INTEGER NOT NULL,
        tier VARCHAR(20) NOT NULL,
        endpoint VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ quota_violations table created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_quota_violations_user_id ON quota_violations(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quota_violations_quota_type ON quota_violations(quota_type);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quota_violations_created_at ON quota_violations(created_at DESC);`);
    console.log('✓ quota_violations indexes created');

    // Add custom_quotas column to quotas table
    console.log('\n📝 Adding custom_quotas column to quotas table...\n');
    await client.query(`ALTER TABLE quotas ADD COLUMN IF NOT EXISTS custom_quotas BOOLEAN DEFAULT false;`);
    console.log('✓ custom_quotas column added');

    // Create subscriptions table
    console.log('\n📝 Creating subscriptions table...\n');
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
        stripe_customer_id VARCHAR(255) NOT NULL,
        tier VARCHAR(20) NOT NULL CHECK (tier IN ('basic', 'premium')),
        status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid', 'trialing')),
        current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
        current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
        cancel_at_period_end BOOLEAN DEFAULT false,
        canceled_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ subscriptions table created');

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);`);
    console.log('✓ subscriptions indexes created');

    // Create payments table
    console.log('\n📝 Creating payments table...\n');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
        subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
        amount INTEGER NOT NULL,
        currency VARCHAR(3) DEFAULT 'usd',
        status VARCHAR(20) NOT NULL CHECK (status IN ('succeeded', 'pending', 'failed', 'refunded')),
        payment_method VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ payments table created');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent_id ON payments(stripe_payment_intent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);`);
    console.log('✓ payments indexes created');

    // Create trigger function and trigger for subscriptions
    console.log('\n📝 Creating subscription update trigger...\n');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_subscription_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✓ update_subscription_timestamp() function created');

    await client.query(`DROP TRIGGER IF EXISTS update_subscriptions_timestamp ON subscriptions;`);
    await client.query(`
      CREATE TRIGGER update_subscriptions_timestamp
        BEFORE UPDATE ON subscriptions
        FOR EACH ROW
        EXECUTE FUNCTION update_subscription_timestamp();
    `);
    console.log('✓ update_subscriptions_timestamp trigger created');

    console.log('\n✅ All Phase 1 Admin Tables created successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

createUserActivityTable().catch(console.error);
