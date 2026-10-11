-- z108 down: drop the Drive reference columns (the MinIO-only state is what they mean by NULL,
-- so dropping them is safe; the media_owners table itself stays — it predates Drive).
DROP INDEX IF EXISTS idx_media_owners_drive_ref;
ALTER TABLE media_owners DROP COLUMN IF EXISTS drive_ref;
ALTER TABLE media_owners DROP COLUMN IF EXISTS drive_node;
ALTER TABLE media_owners DROP COLUMN IF EXISTS drive_size;
