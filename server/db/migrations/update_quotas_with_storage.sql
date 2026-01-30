-- Migration: Add storage tracking to quotas table
-- This adds fields to track media storage usage per user

-- Add storage-related columns
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS max_storage_mb INTEGER DEFAULT 50;
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS current_storage_mb DECIMAL(10,2) DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN quotas.max_storage_mb IS 'Maximum storage allowed in megabytes';
COMMENT ON COLUMN quotas.current_storage_mb IS 'Current storage used in megabytes';

-- Update existing quotas to match tier defaults
-- This ensures all users have proper quotas based on their tier

-- Update free tier users (default)
UPDATE quotas q
SET
  max_books = 3,
  max_words = 50000,
  max_chapters = 30,
  max_ai_requests_per_day = 10,
  max_concurrent_jobs = 1,
  max_storage_mb = 50
FROM users u
WHERE q.user_id = u.id
  AND u.tier = 'free'
  AND u.role != 'admin'; -- Don't update admins

-- Update basic tier users
UPDATE quotas q
SET
  max_books = 10,
  max_words = 250000,
  max_chapters = 100,
  max_ai_requests_per_day = 50,
  max_concurrent_jobs = 3,
  max_storage_mb = 500
FROM users u
WHERE q.user_id = u.id
  AND u.tier = 'basic'
  AND u.role != 'admin';

-- Update premium tier users
UPDATE quotas q
SET
  max_books = 999999,
  max_words = 999999999,
  max_chapters = 999999,
  max_ai_requests_per_day = 200,
  max_concurrent_jobs = 10,
  max_storage_mb = 5000
FROM users u
WHERE q.user_id = u.id
  AND u.tier = 'premium'
  AND u.role != 'admin';

-- Keep admin quotas unlimited (they already have high values)
UPDATE quotas q
SET
  max_storage_mb = 999999
FROM users u
WHERE q.user_id = u.id
  AND u.role = 'admin';

-- Create function to automatically set quotas when tier changes
CREATE OR REPLACE FUNCTION sync_quotas_on_tier_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tier != OLD.tier THEN
    -- Update quotas based on new tier
    IF NEW.tier = 'free' THEN
      UPDATE quotas
      SET
        max_books = 3,
        max_words = 50000,
        max_chapters = 30,
        max_ai_requests_per_day = 10,
        max_concurrent_jobs = 1,
        max_storage_mb = 50,
        updated_at = NOW()
      WHERE user_id = NEW.id;
    ELSIF NEW.tier = 'basic' THEN
      UPDATE quotas
      SET
        max_books = 10,
        max_words = 250000,
        max_chapters = 100,
        max_ai_requests_per_day = 50,
        max_concurrent_jobs = 3,
        max_storage_mb = 500,
        updated_at = NOW()
      WHERE user_id = NEW.id;
    ELSIF NEW.tier = 'premium' THEN
      UPDATE quotas
      SET
        max_books = 999999,
        max_words = 999999999,
        max_chapters = 999999,
        max_ai_requests_per_day = 200,
        max_concurrent_jobs = 10,
        max_storage_mb = 5000,
        updated_at = NOW()
      WHERE user_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically sync quotas when tier changes
DROP TRIGGER IF EXISTS sync_quotas_trigger ON users;
CREATE TRIGGER sync_quotas_trigger
  AFTER UPDATE OF tier ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_quotas_on_tier_change();

COMMENT ON FUNCTION sync_quotas_on_tier_change() IS 'Automatically updates user quotas when tier changes';
COMMENT ON TRIGGER sync_quotas_trigger ON users IS 'Syncs quotas table when user tier is updated';
