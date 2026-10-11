-- z108: Story Writing's media references (STORIES-ON-DRIVE).
-- Drive holds the bytes; Stories keeps only REFERENCES. NULL = the asset is still only in MinIO
-- (the migration has not reached it, or its Drive put failed) — the read path falls back to MinIO
-- whenever drive_ref is NULL, so the two stores can coexist through the migration window.
-- media_owners itself is created at runtime (mediaMapping.ensureMediaOwnersTable); on a fresh
-- install this migration runs BEFORE that, so it creates the table with the full shape itself.
CREATE TABLE IF NOT EXISTS media_owners (
  bucket_type VARCHAR(20)  NOT NULL,
  filename    VARCHAR(500) NOT NULL,
  owner_id    UUID         NOT NULL,
  book_id     UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_type, filename)
);
ALTER TABLE media_owners ADD COLUMN IF NOT EXISTS drive_ref   VARCHAR(200);
ALTER TABLE media_owners ADD COLUMN IF NOT EXISTS drive_owner VARCHAR(40);   -- the sub whose Drive holds the bytes (the caretaker for migrated objects; NOT necessarily the owner_id's portal_sub)
ALTER TABLE media_owners ADD COLUMN IF NOT EXISTS drive_node  VARCHAR(40);
ALTER TABLE media_owners ADD COLUMN IF NOT EXISTS drive_size  BIGINT;
CREATE INDEX IF NOT EXISTS idx_media_owners_drive_ref ON media_owners(drive_ref) WHERE drive_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_owners_owner ON media_owners(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_owners_book ON media_owners(book_id);
COMMENT ON COLUMN media_owners.drive_ref  IS 'SAI Drive ref (story:<bucket>:<filename>) when the bytes live in a person''s Drive; NULL = MinIO only';
COMMENT ON COLUMN media_owners.drive_owner IS 'The X-Sub the app API call must name for this ref (the caretaker''s sub for migrated objects); NULL = resolve from owner_id''s portal_sub';
COMMENT ON COLUMN media_owners.drive_node IS 'The Drive node id the ref resolved to (the folder path may change; the node does not)';
