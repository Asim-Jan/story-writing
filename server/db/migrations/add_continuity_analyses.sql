-- Migration: Add continuity_analyses table for storing continuity check history
-- Purpose: Track all continuity analyses with results, scores, and metadata

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create continuity_analyses table
CREATE TABLE IF NOT EXISTS continuity_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL,
  user_id UUID NOT NULL,

  -- Analysis results stored as JSONB for flexibility
  -- Structure: { summary: { score, passed, warnings, critical }, issues: [...] }
  analysis_result JSONB NOT NULL,

  -- Overall score (0-100) for quick sorting/filtering
  score INTEGER CHECK (score >= 0 AND score <= 100),

  -- Optional focus areas used in analysis (e.g., ['timeline', 'characters'])
  focus_areas TEXT[],

  -- Optional chapter IDs for incremental analysis
  chapter_ids UUID[],

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign key constraints
  CONSTRAINT fk_continuity_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  CONSTRAINT fk_continuity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_continuity_book ON continuity_analyses(book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_continuity_user ON continuity_analyses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_continuity_score ON continuity_analyses(score DESC);

-- Comments for documentation
COMMENT ON TABLE continuity_analyses IS 'Stores history of continuity analyses for books';
COMMENT ON COLUMN continuity_analyses.analysis_result IS 'Full analysis result including summary and issues array';
COMMENT ON COLUMN continuity_analyses.score IS 'Overall quality score from 0-100';
COMMENT ON COLUMN continuity_analyses.focus_areas IS 'Optional array of focus areas: timeline, characters, locations, plot, style';
COMMENT ON COLUMN continuity_analyses.chapter_ids IS 'Optional array of chapter UUIDs for incremental analysis';
