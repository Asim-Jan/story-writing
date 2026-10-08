-- Sign in with SAI Cloud (OpenID Connect): a Stories account can be linked to ONE SAI Cloud account.
-- The link is the portal's stable user id (`sub`, "u_<16 hex>") - never the email, which can change at the portal.
--   portal_sub        NULL for every existing user; UNIQUE, so one sub can never reach two Stories users, and
--                     one Stories user holds at most one sub (a single column).
--   portal_linked_at  when the link was made (audit).
-- Additive and idempotent: nothing is rewritten, users.id and every book stay as they are. Reverse with
-- server/db/migrations-down/z106_portal_identity.down.sql (kept OUT of this directory: the runner applies every .sql here).
ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_sub VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_linked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_portal_sub_key ON users (portal_sub);
COMMENT ON COLUMN users.portal_sub IS 'SAI Cloud (portal) user id from the OIDC sub claim; unique; NULL = not linked';
