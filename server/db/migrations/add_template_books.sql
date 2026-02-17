-- Migration: Add Template/Sample Books Feature
-- Version: 2.18.0
-- Description: Adds support for template books that users can clone

-- Add template-related columns to books table
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS template_description TEXT,
  ADD COLUMN IF NOT EXISTS template_preview_image TEXT,
  ADD COLUMN IF NOT EXISTS template_tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS template_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clone_count INTEGER DEFAULT 0;

-- Modify foreign key constraint to allow NULL owner_id for templates
ALTER TABLE books
  DROP CONSTRAINT IF EXISTS books_owner_id_fkey;

ALTER TABLE books
  ADD CONSTRAINT books_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- Create index for template queries
CREATE INDEX IF NOT EXISTS idx_books_templates
  ON books(is_template, template_category, template_order)
  WHERE is_template = TRUE AND deleted_at IS NULL;

-- Create index for clone count (for analytics)
CREATE INDEX IF NOT EXISTS idx_books_clone_count
  ON books(clone_count DESC)
  WHERE is_template = TRUE;

-- Create template_clones audit table for tracking usage
CREATE TABLE IF NOT EXISTS template_clones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cloned_book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for template_clones
CREATE INDEX IF NOT EXISTS idx_template_clones_template
  ON template_clones(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_clones_user
  ON template_clones(user_id, created_at DESC);

-- Add comments for documentation
COMMENT ON COLUMN books.is_template IS 'Marks this book as a template/sample book available for cloning';
COMMENT ON COLUMN books.template_category IS 'Category for template gallery (e.g., Fantasy, Romance, Sci-Fi)';
COMMENT ON COLUMN books.template_description IS 'User-facing description shown in template gallery';
COMMENT ON COLUMN books.clone_count IS 'Number of times this template has been cloned';
COMMENT ON TABLE template_clones IS 'Tracks when users clone templates for analytics';
