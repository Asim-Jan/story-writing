-- Migration: Add ai_generations table for storing AI generation history
-- Purpose: Track all AI generations for comparison, reuse, and analysis

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ai_generations table
CREATE TABLE IF NOT EXISTS ai_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  book_id UUID,  -- Nullable for user-level generations not tied to a book

  -- Generation metadata
  tool_type VARCHAR(50) NOT NULL,  -- 'dialogue', 'chapter-outline', 'plot-analysis', etc.
  prompt TEXT NOT NULL,             -- User's input prompt
  result JSONB NOT NULL,            -- Generated result (structure varies by tool type)

  -- AI model information
  model VARCHAR(50) DEFAULT 'gpt-4o-mini',
  tokens_used INTEGER,              -- Optional: track token consumption

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign key constraints
  CONSTRAINT fk_ai_gen_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_gen_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_gen_user ON ai_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gen_book ON ai_generations(book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gen_tool ON ai_generations(tool_type);
CREATE INDEX IF NOT EXISTS idx_ai_gen_created ON ai_generations(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE ai_generations IS 'Stores history of all AI generations for comparison and reuse';
COMMENT ON COLUMN ai_generations.tool_type IS 'Type of AI tool used: dialogue, chapter-outline, plot-analysis, character-arc, etc.';
COMMENT ON COLUMN ai_generations.prompt IS 'User input prompt that generated the result';
COMMENT ON COLUMN ai_generations.result IS 'AI-generated result stored as JSONB (structure varies by tool)';
COMMENT ON COLUMN ai_generations.model IS 'AI model used for generation (e.g., gpt-4o-mini, gpt-4)';
COMMENT ON COLUMN ai_generations.tokens_used IS 'Number of tokens consumed (if tracked)';
