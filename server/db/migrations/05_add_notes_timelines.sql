-- Add notes and timelines fields to books table
-- These are temporary fields until we create dedicated tables

ALTER TABLE books ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE books ADD COLUMN IF NOT EXISTS timelines JSONB DEFAULT '[]'::jsonb;
ALTER TABLE books ADD COLUMN IF NOT EXISTS visuals JSONB DEFAULT '[]'::jsonb;

-- Update schema version
INSERT INTO schema_version (version, description)
VALUES ('2.0.21', 'Add notes, timelines, and visuals fields to books table')
ON CONFLICT (version) DO NOTHING;
