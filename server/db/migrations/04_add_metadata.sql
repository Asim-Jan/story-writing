-- Add metadata field to books table
-- This field stores Book Information like author, tagline, blurb, cover image, etc.

ALTER TABLE books ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Update schema version
INSERT INTO schema_version (version, description)
VALUES ('2.0.24', 'Add metadata field to books table for book information (author, tagline, blurb, etc.)')
ON CONFLICT (version) DO NOTHING;
