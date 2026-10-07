-- Book imports (the rebuilt import): an upload's parsed sections, kept so a
-- review survives closing the window, a reload or a deploy. Rows that never
-- became a book are pruned after 14 days. chapters = [{title, kind, content, source}].
CREATE TABLE IF NOT EXISTS book_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  format VARCHAR(10) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash CHAR(64) NOT NULL,
  title VARCHAR(255),
  author VARCHAR(255),
  language VARCHAR(40),
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of JSONB,
  book_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_book_imports_owner ON book_imports(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_book_imports_hash ON book_imports(owner_id, file_hash);
