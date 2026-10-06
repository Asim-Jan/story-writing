-- Add missing component storage to books table
-- These fields were in the frontend but never persisted to PostgreSQL

ALTER TABLE books ADD COLUMN IF NOT EXISTS audio_files JSONB DEFAULT '{}'::jsonb;
ALTER TABLE books ADD COLUMN IF NOT EXISTS comic_pages JSONB DEFAULT '[]'::jsonb;
ALTER TABLE books ADD COLUMN IF NOT EXISTS character_refs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE books ADD COLUMN IF NOT EXISTS animation_projects JSONB DEFAULT '[]'::jsonb;

-- Update schema version
INSERT INTO schema_version (version, description)
VALUES ('2.0.23', 'Add audio_files, comic_pages, character_refs, animation_projects fields')
ON CONFLICT (version) DO NOTHING;
