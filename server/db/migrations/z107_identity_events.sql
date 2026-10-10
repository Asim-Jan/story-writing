-- Identity events: the durable log the receiver dedupes on (STORIES-DELETION.md).
-- Deletion rows are kept FOREVER (the idempotency key for erasures); disabled/enabled/logout rows age out
-- (the sweeper deletes anything older than 90 days that is not an account-deleted).
CREATE TABLE IF NOT EXISTS identity_events (
  evt TEXT PRIMARY KEY,                          -- evt_<24 hex>, stable across every retry of one deletion
  jti TEXT NOT NULL,                             -- the token's jti (fresh per attempt)
  sub TEXT NOT NULL,                             -- the verified OIDC subject = users.portal_sub (the person)
  type TEXT NOT NULL,                            -- account-deleted | account-disabled | account-enabled | backchannel-logout
  at TIMESTAMPTZ NOT NULL,                       -- the event's own time (ordering for reversible events)
  handled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS identity_events_handled_at_idx ON identity_events (handled_at);

-- The event-time ordering column for reversible events (a late retry of an OLDER event must not undo a newer one).
ALTER TABLE users ADD COLUMN IF NOT EXISTS state_event_at TIMESTAMPTZ;

-- 'erased' becomes a legal status: an account-deleted erase tombstones the user row (identity scrubbed, password
-- unusable) because payments/subscriptions carry a NOT-NULL, ON-DELETE-CASCADE user_id — deleting the row would
-- destroy the money rows, which STORIES-DELETION.md forbids. 'erased' never signs in (both sign-in paths read
-- users.status) and an account-enabled event can never resurrect it (the receiver's updates keep it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users DROP CONSTRAINT users_status_check;
  END IF;
  ALTER TABLE users ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'suspended', 'banned', 'erased'));
END $$;
