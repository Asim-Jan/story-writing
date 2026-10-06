-- Save-path integrity: transcripts + chapter cover images need real columns.
-- (These were carried in the client's book object and silently dropped by the
-- save round-trip — the field never existed server-side.)

ALTER TABLE books ADD COLUMN IF NOT EXISTS transcripts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE chapters ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS cover_image_filename VARCHAR(500);
