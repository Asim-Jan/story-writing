-- Migration: Add custom_focus_areas to books table
-- Version: 2.17.9
-- Date: 2026-02-07
-- Purpose: Allow users to define custom focus areas for continuity analysis
--          beyond the 5 predefined ones (timeline, characters, locations, plot, style)

-- Add custom_focus_areas column to books table
ALTER TABLE books
ADD COLUMN IF NOT EXISTS custom_focus_areas TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add index for searching custom focus areas
CREATE INDEX IF NOT EXISTS idx_books_custom_focus_areas
ON books USING GIN (custom_focus_areas);

-- Add comment for documentation
COMMENT ON COLUMN books.custom_focus_areas IS 'User-defined focus areas for continuity analysis (e.g., magic system, world-building, dialogue). Stored as array of strings.';
