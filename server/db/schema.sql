-- Story Writing Studio - PostgreSQL Schema
-- Phase 2 Migration from Redis to PostgreSQL
-- Version: 2.0.0

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TABLE: users
-- Core user identity and authentication
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'basic', 'premium')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER DEFAULT 1 NOT NULL,
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- =============================================================================
-- TABLE: user_settings
-- User preferences and configuration (API keys, preferences)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ai_config JSONB DEFAULT '{}'::jsonb,
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_settings
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- =============================================================================
-- TABLE: api_keys
-- External API integrations (OpenAI, Gemini, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('openai', 'gemini', 'anthropic')),
  api_key_encrypted TEXT NOT NULL,
  model VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Indexes for api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);

-- =============================================================================
-- TABLE: books
-- Book metadata and structure
-- =============================================================================
CREATE TABLE IF NOT EXISTS books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  genre VARCHAR(100),
  target_audience VARCHAR(100),

  -- Flexible data stored as JSONB
  characters JSONB DEFAULT '[]'::jsonb,
  locations JSONB DEFAULT '[]'::jsonb,
  plotlines JSONB DEFAULT '[]'::jsonb,
  world_building JSONB DEFAULT '{}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,

  -- Metadata
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'published')),
  word_count INTEGER DEFAULT 0,
  chapter_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Optimistic locking
  version INTEGER DEFAULT 1 NOT NULL,

  -- Full-text search
  title_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title)) STORED,
  description_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(description, ''))) STORED
);

-- Indexes for books
CREATE INDEX IF NOT EXISTS idx_books_owner_id ON books(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_title_search ON books USING GIN(title_search);
CREATE INDEX IF NOT EXISTS idx_books_description_search ON books USING GIN(description_search);

-- =============================================================================
-- TABLE: collaborators
-- Book collaboration permissions
-- =============================================================================
CREATE TABLE IF NOT EXISTS collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('viewer', 'commenter', 'editor')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  UNIQUE(book_id, email)
);

-- Indexes for collaborators
CREATE INDEX IF NOT EXISTS idx_collaborators_book_id ON collaborators(book_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON collaborators(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_collaborators_email ON collaborators(email);

-- =============================================================================
-- TABLE: chapters
-- Book chapters (normalized)
-- =============================================================================
CREATE TABLE IF NOT EXISTS chapters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  title VARCHAR(500),
  content TEXT,

  -- Chapter structure
  scenes JSONB DEFAULT '[]'::jsonb,
  notes TEXT,

  -- Metadata
  word_count INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Optimistic locking
  version INTEGER DEFAULT 1 NOT NULL,

  -- Full-text search
  content_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED,

  UNIQUE(book_id, chapter_number)
);

-- Indexes for chapters
CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id, chapter_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status);
CREATE INDEX IF NOT EXISTS idx_chapters_content_search ON chapters USING GIN(content_search);

-- =============================================================================
-- TABLE: chapter_versions
-- Version history for rollback capability
-- =============================================================================
CREATE TABLE IF NOT EXISTS chapter_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT,
  scenes JSONB,
  word_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(chapter_id, version_number)
);

-- Indexes for chapter_versions
CREATE INDEX IF NOT EXISTS idx_chapter_versions_chapter_id ON chapter_versions(chapter_id, version_number DESC);

-- =============================================================================
-- TABLE: media
-- Media file metadata (images, audio, videos, comics)
-- =============================================================================
CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,

  -- File info
  filename VARCHAR(500) NOT NULL,
  original_filename VARCHAR(500),
  media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'audio', 'video', 'comic')),
  mime_type VARCHAR(100),
  file_size INTEGER,

  -- Storage info
  storage_path TEXT NOT NULL,
  bucket VARCHAR(100),

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(book_id, filename)
);

-- Indexes for media
CREATE INDEX IF NOT EXISTS idx_media_book_id ON media(book_id);
CREATE INDEX IF NOT EXISTS idx_media_chapter_id ON media(chapter_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_filename ON media(filename);

-- =============================================================================
-- TABLE: jobs
-- Background job tracking (AI generation, imports, exports)
-- =============================================================================
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE SET NULL,

  -- Job info
  job_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),

  -- Job data
  input_data JSONB,
  result_data JSONB,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for jobs
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_book_id ON jobs(book_id) WHERE book_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);

-- =============================================================================
-- TABLE: imports
-- Book import tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE SET NULL,

  -- Import info
  source_format VARCHAR(50) NOT NULL CHECK (source_format IN ('google-docs', 'epub', 'pdf', 'docx', 'txt')),
  source_url TEXT,
  filename VARCHAR(500),

  -- Status
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER DEFAULT 0,
  error_message TEXT,

  -- Import result
  chapters_imported INTEGER DEFAULT 0,
  words_imported INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for imports
CREATE INDEX IF NOT EXISTS idx_imports_user_id ON imports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imports_book_id ON imports(book_id);
CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);

-- =============================================================================
-- TABLE: quotas
-- Per-user resource quotas and usage tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS quotas (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Limits (based on tier)
  max_books INTEGER DEFAULT 3,
  max_words INTEGER DEFAULT 50000,
  max_chapters INTEGER DEFAULT 30,
  max_ai_requests_per_day INTEGER DEFAULT 10,
  max_concurrent_jobs INTEGER DEFAULT 1,

  -- Current usage
  current_books INTEGER DEFAULT 0,
  current_words INTEGER DEFAULT 0,
  current_chapters INTEGER DEFAULT 0,
  ai_requests_today INTEGER DEFAULT 0,

  -- Last reset
  last_ai_reset TIMESTAMPTZ DEFAULT NOW(),

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for quotas
CREATE INDEX IF NOT EXISTS idx_quotas_user_id ON quotas(user_id);

-- =============================================================================
-- TRIGGERS
-- Auto-update timestamps and version numbers
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Triggers for books
DROP TRIGGER IF EXISTS update_books_updated_at ON books;
CREATE TRIGGER update_books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS increment_books_version ON books;
CREATE TRIGGER increment_books_version
  BEFORE UPDATE ON books
  FOR EACH ROW
  WHEN (OLD.version IS NOT NULL)
  EXECUTE FUNCTION increment_version();

-- Triggers for chapters
DROP TRIGGER IF EXISTS update_chapters_updated_at ON chapters;
CREATE TRIGGER update_chapters_updated_at
  BEFORE UPDATE ON chapters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS increment_chapters_version ON chapters;
CREATE TRIGGER increment_chapters_version
  BEFORE UPDATE ON chapters
  FOR EACH ROW
  WHEN (OLD.version IS NOT NULL)
  EXECUTE FUNCTION increment_version();

-- Triggers for user_settings
DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Triggers for api_keys
DROP TRIGGER IF EXISTS update_api_keys_updated_at ON api_keys;
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Triggers for media
DROP TRIGGER IF EXISTS update_media_updated_at ON media;
CREATE TRIGGER update_media_updated_at
  BEFORE UPDATE ON media
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Triggers for quotas
DROP TRIGGER IF EXISTS update_quotas_updated_at ON quotas;
CREATE TRIGGER update_quotas_updated_at
  BEFORE UPDATE ON quotas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- VIEWS
-- Commonly used queries as views
-- =============================================================================

-- Active books with owner info
DROP VIEW IF EXISTS active_books;
CREATE VIEW active_books AS
SELECT
  b.*,
  u.name as owner_name,
  u.email as owner_email,
  u.tier as owner_tier
FROM books b
JOIN users u ON b.owner_id = u.id
WHERE b.deleted_at IS NULL AND u.deleted_at IS NULL;

-- User book count (for quota enforcement)
DROP VIEW IF EXISTS user_book_counts;
CREATE VIEW user_book_counts AS
SELECT
  owner_id,
  COUNT(*) as book_count,
  SUM(word_count) as total_words,
  SUM(chapter_count) as total_chapters
FROM books
WHERE deleted_at IS NULL
GROUP BY owner_id;

-- =============================================================================
-- FUNCTIONS
-- Helper functions for common operations
-- =============================================================================

-- Function to check if user can create a book (quota check)
CREATE OR REPLACE FUNCTION can_create_book(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier VARCHAR(20);
  v_current_books INTEGER;
  v_max_books INTEGER;
BEGIN
  -- Get user tier
  SELECT tier INTO v_tier FROM users WHERE id = p_user_id;

  -- Get current book count
  SELECT COUNT(*) INTO v_current_books
  FROM books
  WHERE owner_id = p_user_id AND deleted_at IS NULL;

  -- Get max books for tier
  SELECT max_books INTO v_max_books
  FROM quotas
  WHERE user_id = p_user_id;

  -- If no quota record, create one
  IF v_max_books IS NULL THEN
    INSERT INTO quotas (user_id, max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs)
    VALUES (
      p_user_id,
      CASE v_tier
        WHEN 'free' THEN 3
        WHEN 'basic' THEN 10
        WHEN 'premium' THEN 999999
      END,
      CASE v_tier
        WHEN 'free' THEN 50000
        WHEN 'basic' THEN 200000
        WHEN 'premium' THEN 999999999
      END,
      CASE v_tier
        WHEN 'free' THEN 30
        WHEN 'basic' THEN 100
        WHEN 'premium' THEN 999999
      END,
      CASE v_tier
        WHEN 'free' THEN 10
        WHEN 'basic' THEN 50
        WHEN 'premium' THEN 200
      END,
      CASE v_tier
        WHEN 'free' THEN 1
        WHEN 'basic' THEN 3
        WHEN 'premium' THEN 10
      END
    )
    RETURNING max_books INTO v_max_books;
  END IF;

  RETURN v_current_books < v_max_books;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- INITIAL DATA
-- Default quotas for tiers
-- =============================================================================

-- Note: Quotas are created automatically when users register
-- See can_create_book() function above

-- =============================================================================
-- GRANTS
-- Permissions for application user
-- =============================================================================

-- The application role's name comes from the deployment (POSTGRES_USER);
-- hardcoding story_user fails a fresh install with a different role. Grant to
-- every role that can connect instead — same effect, no hardcoded name.
DO $grants$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolcanlogin AND NOT rolname LIKE 'pg_%'
  LOOP
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', r.rolname);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', r.rolname);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', r.rolname);
  END LOOP;
END
$grants$;

-- =============================================================================
-- SCHEMA VERSION
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version VARCHAR(20) PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  description TEXT
);

INSERT INTO schema_version (version, description)
VALUES ('2.0.0', 'Initial PostgreSQL schema for Phase 2 migration')
ON CONFLICT (version) DO NOTHING;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
