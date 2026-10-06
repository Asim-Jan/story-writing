-- Migration: Add Admin Role and User Management System
-- Version: 2.3.0
-- Description: Adds role-based access control, user status management, audit logging, and tier management

-- Add role column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- Add status column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'banned'));

-- Create indexes for efficient admin queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier) WHERE deleted_at IS NULL;

-- Create admin_audit_log table for tracking admin actions
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_resource_type VARCHAR(50),
  target_resource_id UUID,

  -- Action details
  changes JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(45),
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user ON admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON admin_audit_log(created_at DESC);

-- Create system_stats view for admin dashboard
CREATE OR REPLACE VIEW system_stats AS
SELECT
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as total_users,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND tier = 'free') as free_users,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND tier = 'basic') as basic_users,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND tier = 'premium') as premium_users,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status = 'suspended') as suspended_users,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status = 'banned') as banned_users,
  (SELECT COUNT(*) FROM books WHERE deleted_at IS NULL) as total_books,
  (SELECT COALESCE(SUM(word_count), 0) FROM books WHERE deleted_at IS NULL) as total_words,
  (SELECT COUNT(*) FROM chapters WHERE deleted_at IS NULL) as total_chapters,
  (SELECT COUNT(*) FROM jobs WHERE created_at > NOW() - INTERVAL '24 hours') as jobs_last_24h,
  (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL) as new_users_last_week;

-- Function to update user tier and quotas atomically
CREATE OR REPLACE FUNCTION update_user_tier(
  p_user_id UUID,
  p_new_tier VARCHAR(20),
  p_admin_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_old_tier VARCHAR(20);
  v_max_books INTEGER;
  v_max_words INTEGER;
  v_max_chapters INTEGER;
  v_max_ai_requests INTEGER;
  v_max_concurrent_jobs INTEGER;
BEGIN
  -- Get current tier
  SELECT tier INTO v_old_tier FROM users WHERE id = p_user_id;

  -- Validate tier
  IF p_new_tier NOT IN ('free', 'basic', 'premium') THEN
    RAISE EXCEPTION 'Invalid tier: %', p_new_tier;
  END IF;

  -- Calculate new quota limits
  CASE p_new_tier
    WHEN 'free' THEN
      v_max_books := 3;
      v_max_words := 50000;
      v_max_chapters := 30;
      v_max_ai_requests := 10;
      v_max_concurrent_jobs := 1;
    WHEN 'basic' THEN
      v_max_books := 10;
      v_max_words := 200000;
      v_max_chapters := 100;
      v_max_ai_requests := 50;
      v_max_concurrent_jobs := 3;
    WHEN 'premium' THEN
      v_max_books := 999999;
      v_max_words := 999999999;
      v_max_chapters := 999999;
      v_max_ai_requests := 200;
      v_max_concurrent_jobs := 10;
  END CASE;

  -- Update user tier
  UPDATE users SET tier = p_new_tier WHERE id = p_user_id;

  -- Update quotas
  UPDATE quotas SET
    max_books = v_max_books,
    max_words = v_max_words,
    max_chapters = v_max_chapters,
    max_ai_requests_per_day = v_max_ai_requests,
    max_concurrent_jobs = v_max_concurrent_jobs
  WHERE user_id = p_user_id;

  -- Log the action
  INSERT INTO admin_audit_log (admin_id, action, target_user_id, changes)
  VALUES (
    p_admin_id,
    'tier_change',
    p_user_id,
    jsonb_build_object('old_tier', v_old_tier, 'new_tier', p_new_tier)
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update schema version
INSERT INTO schema_version (version, description)
VALUES ('2.3.0', 'Add admin role, user status, audit logging, and tier management')
ON CONFLICT (version) DO NOTHING;

-- Add comment to document migration
COMMENT ON TABLE admin_audit_log IS 'Tracks all administrative actions for security and compliance';
COMMENT ON VIEW system_stats IS 'Real-time statistics for admin dashboard';
COMMENT ON FUNCTION update_user_tier(UUID, VARCHAR, UUID) IS 'Atomically updates user tier and quotas with audit logging';
