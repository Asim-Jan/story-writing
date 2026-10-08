-- Reverse of migrations/z106_portal_identity.sql. Run by hand (psql), then delete the row from schema_migrations:
--   DELETE FROM schema_migrations WHERE name = 'z106_portal_identity.sql';
-- Users linked to SAI Cloud keep their account and books, but they simply lose the link, and NOT always their password:
--   * accounts CREATED through SAI Cloud have an unusable random password;
--   * accounts LINKED AUTOMATICALLY (Stories email verified, portal email verified) had their old password hash REPLACED by an
--     unusable one at link time. That hash is gone for good and this script cannot bring it back;
--   * accounts linked at the password step ("Linking your account") kept the password they proved.
-- After this rollback, linked accounts need "Forgot password" before they can sign in with email + password again.
DROP INDEX IF EXISTS users_portal_sub_key;
ALTER TABLE users DROP COLUMN IF EXISTS portal_linked_at;
ALTER TABLE users DROP COLUMN IF EXISTS portal_sub;
