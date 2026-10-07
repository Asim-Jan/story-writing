-- Reverse of migrations/z106_portal_identity.sql. Run by hand (psql), then delete the row from schema_migrations:
--   DELETE FROM schema_migrations WHERE name = 'z106_portal_identity.sql';
-- Users linked to SAI Cloud keep their account, books and password hash; they simply lose the link (and sign in
-- with email + password again - accounts CREATED through SAI Cloud have an unusable random password and need
-- "Forgot password" first).
DROP INDEX IF EXISTS users_portal_sub_key;
ALTER TABLE users DROP COLUMN IF EXISTS portal_linked_at;
ALTER TABLE users DROP COLUMN IF EXISTS portal_sub;
