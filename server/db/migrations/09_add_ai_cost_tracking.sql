-- Migration: Add AI cost tracking
-- Purpose: Track token usage and costs for all AI operations
-- Date: 2026-02-06

-- ============================================================================
-- 1. Enhance ai_generations table with token and cost tracking
-- ============================================================================

ALTER TABLE ai_generations
ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_cost_usd DECIMAL(10, 6) DEFAULT 0;

-- Update column comment
DO $migrate$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_generations' AND column_name = 'tokens_used') THEN
    EXECUTE 'COMMENT ON COLUMN ai_generations.tokens_used IS ''DEPRECATED: Use total_tokens instead''';
  END IF;
END
$migrate$;
COMMENT ON COLUMN ai_generations.prompt_tokens IS 'Number of tokens in the prompt (input)';
COMMENT ON COLUMN ai_generations.completion_tokens IS 'Number of tokens in the completion (output)';
COMMENT ON COLUMN ai_generations.total_tokens IS 'Total tokens used (prompt + completion)';
COMMENT ON COLUMN ai_generations.estimated_cost_usd IS 'Estimated cost in USD based on model pricing';

-- ============================================================================
-- 2. Create ai_cost_summary table for daily aggregations
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_cost_summary (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,

  -- Date for daily aggregation
  date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Token usage
  total_tokens INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,

  -- Cost tracking
  total_cost_usd DECIMAL(10, 4) DEFAULT 0,

  -- Request counts by type
  text_requests INTEGER DEFAULT 0,  -- chat completions
  image_requests INTEGER DEFAULT 0,  -- DALL-E
  audio_requests INTEGER DEFAULT 0,  -- TTS/STT

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT fk_cost_summary_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cost_summary_user_date ON ai_cost_summary(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cost_summary_date ON ai_cost_summary(date DESC);

-- Comments
COMMENT ON TABLE ai_cost_summary IS 'Daily aggregated AI usage and costs per user';
COMMENT ON COLUMN ai_cost_summary.date IS 'Date of aggregation (one row per user per day)';
COMMENT ON COLUMN ai_cost_summary.total_tokens IS 'Total tokens used on this date';
COMMENT ON COLUMN ai_cost_summary.total_cost_usd IS 'Total estimated cost in USD on this date';
COMMENT ON COLUMN ai_cost_summary.text_requests IS 'Number of text generation requests (GPT models)';
COMMENT ON COLUMN ai_cost_summary.image_requests IS 'Number of image generation requests (DALL-E)';
COMMENT ON COLUMN ai_cost_summary.audio_requests IS 'Number of audio requests (TTS/STT)';

-- ============================================================================
-- 3. Create ai_pricing table for model costs
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_pricing (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(100) NOT NULL UNIQUE,

  -- Pricing per 1M tokens (OpenAI standard)
  input_price_per_1m DECIMAL(10, 4) NOT NULL,
  output_price_per_1m DECIMAL(10, 4) NOT NULL,

  -- For image/audio models (per-unit pricing)
  unit_price DECIMAL(10, 4),  -- e.g., $0.040 per image
  unit_type VARCHAR(50),      -- 'image', 'minute', 'character', etc.

  -- Metadata
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_pricing_model ON ai_pricing(model_name) WHERE is_active = TRUE;

-- Comments
COMMENT ON TABLE ai_pricing IS 'AI model pricing information for cost calculation';
COMMENT ON COLUMN ai_pricing.input_price_per_1m IS 'Price per 1 million input tokens in USD';
COMMENT ON COLUMN ai_pricing.output_price_per_1m IS 'Price per 1 million output tokens in USD';
COMMENT ON COLUMN ai_pricing.unit_price IS 'Price per unit for non-token-based models (images, audio)';
COMMENT ON COLUMN ai_pricing.unit_type IS 'Unit of measurement (image, minute, character)';

-- ============================================================================
-- 4. SAI gateway pricing (the app's AI backend) + legacy OpenAI rows kept so
--    historical generations still cost correctly.
-- ============================================================================

-- SAI models (token-based pricing; matches the gateway rate card 2026-10)
INSERT INTO ai_pricing (model_name, input_price_per_1m, output_price_per_1m) VALUES
('sai-chat', 0.100, 0.300),               -- Qwen3.8-Flash-Next via SAI gateway
('sai-chat-fast', 0.075, 0.250)           -- GLM-5.3-Flash via SAI gateway
ON CONFLICT (model_name) DO NOTHING;

-- SAI image/speech (per-unit pricing; bridge rates)
INSERT INTO ai_pricing (model_name, unit_price, unit_type, input_price_per_1m, output_price_per_1m) VALUES
('flux2-klein-9b', 0.025, 'image', 0, 0),   -- $0.025 per image (gateway image.*)
('character-sheet', 0.025, 'image', 0, 0),  -- $0.025 per sheet
('tts-1', 15.00, '1M_chars', 0, 0)          -- $0.015/1k chars = $15.00 per 1M
ON CONFLICT (model_name) DO NOTHING;

-- GPT models (token-based pricing) — historical
INSERT INTO ai_pricing (model_name, input_price_per_1m, output_price_per_1m) VALUES
('gpt-4o-mini', 0.150, 0.600),            -- $0.150/$0.600 per 1M tokens
('gpt-4o', 5.00, 15.00),                  -- $5/$15 per 1M tokens
('gpt-4-turbo', 10.00, 30.00),            -- $10/$30 per 1M tokens
('gpt-4-turbo-preview', 10.00, 30.00),    -- $10/$30 per 1M tokens
('gpt-3.5-turbo', 0.50, 1.50)             -- $0.50/$1.50 per 1M tokens
ON CONFLICT (model_name) DO NOTHING;

-- Image models (per-unit pricing)
INSERT INTO ai_pricing (model_name, unit_price, unit_type, input_price_per_1m, output_price_per_1m) VALUES
('dall-e-3', 0.040, 'image', 0, 0),         -- $0.040 per image (1024x1024 standard)
('dall-e-3-hd', 0.080, 'image', 0, 0),      -- $0.080 per image (1024x1024 HD)
('dall-e-2', 0.020, 'image', 0, 0)          -- $0.020 per image (1024x1024)
ON CONFLICT (model_name) DO NOTHING;

-- Audio models
INSERT INTO ai_pricing (model_name, unit_price, unit_type, input_price_per_1m, output_price_per_1m) VALUES
('tts-1', 15.00, '1M_chars', 0, 0),         -- $15.00 per 1M characters
('tts-1-hd', 30.00, '1M_chars', 0, 0),      -- $30.00 per 1M characters
('whisper-1', 0.006, 'minute', 0, 0)        -- $0.006 per minute
ON CONFLICT (model_name) DO NOTHING;

-- ============================================================================
-- 5. Create function to update summary on new generation
-- ============================================================================

CREATE OR REPLACE FUNCTION update_ai_cost_summary()
RETURNS TRIGGER AS $$
BEGIN
  -- Update or insert daily summary
  INSERT INTO ai_cost_summary (
    user_id,
    date,
    total_tokens,
    prompt_tokens,
    completion_tokens,
    total_cost_usd,
    text_requests
  ) VALUES (
    NEW.user_id,
    CURRENT_DATE,
    COALESCE(NEW.total_tokens, 0),
    COALESCE(NEW.prompt_tokens, 0),
    COALESCE(NEW.completion_tokens, 0),
    COALESCE(NEW.estimated_cost_usd, 0),
    1
  )
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    total_tokens = ai_cost_summary.total_tokens + COALESCE(NEW.total_tokens, 0),
    prompt_tokens = ai_cost_summary.prompt_tokens + COALESCE(NEW.prompt_tokens, 0),
    completion_tokens = ai_cost_summary.completion_tokens + COALESCE(NEW.completion_tokens, 0),
    total_cost_usd = ai_cost_summary.total_cost_usd + COALESCE(NEW.estimated_cost_usd, 0),
    text_requests = ai_cost_summary.text_requests + 1,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_update_cost_summary ON ai_generations;
CREATE TRIGGER trg_update_cost_summary
  AFTER INSERT ON ai_generations
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_cost_summary();

COMMENT ON FUNCTION update_ai_cost_summary IS 'Automatically updates daily cost summary when new AI generation is recorded';

-- ============================================================================
-- 6. Create helper function to calculate cost
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_generation_cost(
  p_model VARCHAR(100),
  p_prompt_tokens INTEGER,
  p_completion_tokens INTEGER
) RETURNS DECIMAL(10, 6) AS $$
DECLARE
  v_input_price DECIMAL(10, 4);
  v_output_price DECIMAL(10, 4);
  v_input_cost DECIMAL(10, 6);
  v_output_cost DECIMAL(10, 6);
BEGIN
  -- Get pricing for model
  SELECT input_price_per_1m, output_price_per_1m
  INTO v_input_price, v_output_price
  FROM ai_pricing
  WHERE model_name = p_model AND is_active = TRUE
  LIMIT 1;

  -- If model not found, return 0
  IF v_input_price IS NULL THEN
    RETURN 0;
  END IF;

  -- Calculate costs
  v_input_cost := (p_prompt_tokens::DECIMAL / 1000000.0) * v_input_price;
  v_output_cost := (p_completion_tokens::DECIMAL / 1000000.0) * v_output_price;

  RETURN v_input_cost + v_output_cost;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_generation_cost IS 'Calculates estimated cost for a text generation based on token usage and model pricing';

-- ============================================================================
-- 7. Create views for common queries
-- ============================================================================

-- User monthly costs view
CREATE OR REPLACE VIEW v_user_monthly_costs AS
SELECT
  user_id,
  DATE_TRUNC('month', date) as month,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost_usd) as total_cost,
  SUM(text_requests) as text_requests,
  SUM(image_requests) as image_requests,
  SUM(audio_requests) as audio_requests,
  COUNT(DISTINCT date) as active_days
FROM ai_cost_summary
GROUP BY user_id, DATE_TRUNC('month', date);

COMMENT ON VIEW v_user_monthly_costs IS 'Monthly aggregated AI costs per user';

-- System-wide daily costs view
CREATE OR REPLACE VIEW v_daily_system_costs AS
SELECT
  date,
  SUM(total_cost_usd) as daily_cost,
  SUM(total_tokens) as daily_tokens,
  SUM(text_requests + image_requests + audio_requests) as daily_requests,
  COUNT(DISTINCT user_id) as active_users
FROM ai_cost_summary
GROUP BY date
ORDER BY date DESC;

COMMENT ON VIEW v_daily_system_costs IS 'Daily system-wide AI cost metrics';

-- ============================================================================
-- Migration complete
-- ============================================================================

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'AI cost tracking migration completed successfully';
  RAISE NOTICE 'Tables created: ai_cost_summary, ai_pricing';
  RAISE NOTICE 'Columns added to ai_generations: prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd';
  RAISE NOTICE 'Functions created: update_ai_cost_summary(), calculate_generation_cost()';
  RAISE NOTICE 'Views created: v_user_monthly_costs, v_daily_system_costs';
END $$;
