-- Custom audiobook voices: a user's own voice sample (in MinIO audio) and its
-- transcript, cloned per request by Qwen3-TTS. consent_at records the user's
-- confirmation that they own the voice or have the speaker's permission.
CREATE TABLE IF NOT EXISTS custom_voices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  sample_filename VARCHAR(255) NOT NULL,
  transcript TEXT,
  duration_sec NUMERIC(6, 2) NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_voices_owner ON custom_voices(owner_id);
