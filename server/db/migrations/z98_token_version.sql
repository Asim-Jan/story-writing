-- JWT revocation: bump users.token_version to invalidate every issued token
-- (logout-everywhere, password reset, suspension). Tokens carry the version
-- they were issued with; the auth middleware refuses mismatches.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
