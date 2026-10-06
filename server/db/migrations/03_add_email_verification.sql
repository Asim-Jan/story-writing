-- Add email verification columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_verification_token_expires TIMESTAMPTZ;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token) WHERE email_verification_token IS NOT NULL;

-- Create email verification log table for audit trail
CREATE TABLE IF NOT EXISTS email_verification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL, -- 'sent', 'verified', 'resent', 'expired'
  token VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_log_user_id ON email_verification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_log_created_at ON email_verification_log(created_at DESC);

-- Comment on columns
COMMENT ON COLUMN users.email_verified IS 'Whether the user has verified their email address';
COMMENT ON COLUMN users.email_verification_token IS 'Token sent to user email for verification';
COMMENT ON COLUMN users.email_verification_token_expires IS 'Expiration timestamp for verification token (24 hours)';
COMMENT ON TABLE email_verification_log IS 'Audit log for email verification actions';
