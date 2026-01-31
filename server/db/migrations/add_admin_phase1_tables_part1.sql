-- Migration: Add Admin Phase 1 Enhancement Tables (Part 1 - Tables Only)
-- Creates tables for user activity, login history, content flags, and quota violations

-- ============================================================================
-- 1. USER ACTIVITY LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_activity_log (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_created_at ON user_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_activity_type ON user_activity_log(activity_type);

-- ============================================================================
-- 2. LOGIN HISTORY
-- ============================================================================
CREATE TABLE IF NOT EXISTS login_history (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  failure_reason VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON login_history(login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_success ON login_history(success);
CREATE INDEX IF NOT EXISTS idx_login_history_email ON login_history(email);

-- ============================================================================
-- 3. CONTENT FLAGS (for moderation)
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_content_flags_content_type_id ON content_flags(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_flags_status ON content_flags(status);
CREATE INDEX IF NOT EXISTS idx_content_flags_created_at ON content_flags(created_at DESC);

-- ============================================================================
-- 4. QUOTA VIOLATIONS
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_quota_violations_user_id ON quota_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_quota_violations_quota_type ON quota_violations(quota_type);
CREATE INDEX IF NOT EXISTS idx_quota_violations_created_at ON quota_violations(created_at DESC);

-- ============================================================================
-- 5. ADD CUSTOM QUOTAS FLAG
-- ============================================================================
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS custom_quotas BOOLEAN DEFAULT false;

-- ============================================================================
-- 6. SUBSCRIPTIONS TABLE (for Stripe integration)
-- ============================================================================
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ============================================================================
-- 7. PAYMENTS TABLE (for Stripe integration)
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent_id ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

-- ============================================================================
-- 8. TRIGGER TO UPDATE SUBSCRIPTION updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscriptions_timestamp ON subscriptions;
CREATE TRIGGER update_subscriptions_timestamp
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_timestamp();
