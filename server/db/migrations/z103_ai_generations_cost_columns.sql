-- Prod was baselined with 09_add_ai_cost_tracking.sql marked applied, but its
-- ai_generations has none of 09's columns and no summary trigger (the table
-- was rebuilt after 09 ran). Every generation-history insert failed on
-- total_tokens and the cost-by-tool screen errored. Re-assert 09's parts that
-- live on ai_generations; everything here is idempotent.

ALTER TABLE ai_generations
ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_cost_usd DECIMAL(10, 6) DEFAULT 0;

-- the function exists wherever ai_cost_summary does (09 created both)
DROP TRIGGER IF EXISTS trg_update_cost_summary ON ai_generations;
CREATE TRIGGER trg_update_cost_summary
  AFTER INSERT ON ai_generations
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_cost_summary();
