# AI Token Cost Tracking Plan

## Overview
Implement comprehensive tracking of AI token usage and costs across all AI features to provide:
1. **Admin analytics** - Total costs, per-user costs, cost trends
2. **User transparency** - Show users their AI usage and associated costs
3. **Budget control** - Set per-user or per-tier spending limits
4. **Cost optimization** - Identify expensive operations for optimization

## Architecture

### 1. Database Schema Enhancement

**Modify existing `ai_generations` table:**
```sql
ALTER TABLE ai_generations
ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_cost_usd DECIMAL(10, 6) DEFAULT 0;

-- Update existing column
COMMENT ON COLUMN ai_generations.tokens_used IS 'DEPRECATED: Use total_tokens instead';
```

**Create new `ai_cost_summary` table for aggregated stats:**
```sql
CREATE TABLE ai_cost_summary (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

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

  UNIQUE(user_id, date)
);

CREATE INDEX idx_cost_summary_user_date ON ai_cost_summary(user_id, date DESC);
CREATE INDEX idx_cost_summary_date ON ai_cost_summary(date DESC);
```

**Create `ai_pricing` table for model costs:**
```sql
CREATE TABLE ai_pricing (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(100) NOT NULL UNIQUE,

  -- Pricing per 1M tokens (OpenAI standard)
  input_price_per_1m DECIMAL(10, 4) NOT NULL,
  output_price_per_1m DECIMAL(10, 4) NOT NULL,

  -- For image/audio models
  unit_price DECIMAL(10, 4),  -- e.g., $0.040 per image
  unit_type VARCHAR(50),      -- 'image', 'minute', etc.

  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert current OpenAI pricing (as of 2024)
INSERT INTO ai_pricing (model_name, input_price_per_1m, output_price_per_1m) VALUES
('gpt-4o-mini', 0.150, 0.600),            -- $0.150/$0.600 per 1M tokens
('gpt-4o', 5.00, 15.00),                  -- $5/$15 per 1M tokens
('gpt-4-turbo', 10.00, 30.00),            -- $10/$30 per 1M tokens
('gpt-3.5-turbo', 0.50, 1.50);            -- $0.50/$1.50 per 1M tokens

INSERT INTO ai_pricing (model_name, unit_price, unit_type, input_price_per_1m, output_price_per_1m) VALUES
('dall-e-3-hd', 0.080, 'image', 0, 0),    -- $0.080 per image (1024x1024 HD)
('dall-e-3-std', 0.040, 'image', 0, 0),   -- $0.040 per image (1024x1024 standard)
('tts-1', 15.00, '1M_chars', 0, 0),       -- $15.00 per 1M characters
('whisper-1', 0.006, 'minute', 0, 0);     -- $0.006 per minute
```

### 2. Backend Services

**Create `/server/services/costTracking.js`:**
```javascript
/**
 * Calculate cost for text generation (GPT models)
 */
export const calculateTextCost = (model, promptTokens, completionTokens) => {
  const pricing = getPricing(model);

  const inputCost = (promptTokens / 1_000_000) * pricing.input_price_per_1m;
  const outputCost = (completionTokens / 1_000_000) * pricing.output_price_per_1m;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    totalTokens: promptTokens + completionTokens
  };
};

/**
 * Calculate cost for image generation
 */
export const calculateImageCost = (model, count = 1) => {
  const pricing = getPricing(model);
  return pricing.unit_price * count;
};

/**
 * Save AI usage to database
 */
export const trackAIUsage = async (userId, data) => {
  const {
    model,
    promptTokens = 0,
    completionTokens = 0,
    totalTokens = 0,
    estimatedCost = 0,
    requestType = 'text' // text, image, audio
  } = data;

  // Update daily summary (upsert)
  await pool.query(`
    INSERT INTO ai_cost_summary
      (user_id, date, total_tokens, prompt_tokens, completion_tokens, total_cost_usd, ${requestType}_requests)
    VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, 1)
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      total_tokens = ai_cost_summary.total_tokens + $2,
      prompt_tokens = ai_cost_summary.prompt_tokens + $3,
      completion_tokens = ai_cost_summary.completion_tokens + $4,
      total_cost_usd = ai_cost_summary.total_cost_usd + $5,
      ${requestType}_requests = ai_cost_summary.${requestType}_requests + 1,
      updated_at = NOW()
  `, [userId, totalTokens, promptTokens, completionTokens, estimatedCost]);
};

/**
 * Get user's cost summary for date range
 */
export const getUserCostSummary = async (userId, startDate, endDate) => {
  const result = await pool.query(`
    SELECT
      SUM(total_tokens) as total_tokens,
      SUM(total_cost_usd) as total_cost,
      SUM(text_requests) as text_requests,
      SUM(image_requests) as image_requests,
      SUM(audio_requests) as audio_requests,
      date
    FROM ai_cost_summary
    WHERE user_id = $1
      AND date BETWEEN $2 AND $3
    GROUP BY date
    ORDER BY date DESC
  `, [userId, startDate, endDate]);

  return result.rows;
};
```

### 3. API Endpoint Updates

**Modify `/api/generate` endpoint:**
```javascript
// After OpenAI API call
const completion = await userOpenai.chat.completions.create({...});

// Extract token usage from OpenAI response
const usage = completion.usage;
const { prompt_tokens, completion_tokens, total_tokens } = usage;

// Calculate cost
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const { totalCost } = calculateTextCost(model, prompt_tokens, completion_tokens);

// Save to database with cost data
await pool.query(`
  INSERT INTO ai_generations
  (user_id, book_id, tool_type, prompt, result, model,
   prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`, [
  req.user.userId,
  context?.bookId || null,
  type,
  prompt,
  JSON.stringify(generatedData),
  model,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  totalCost
]);

// Track in daily summary
await trackAIUsage(req.user.userId, {
  model,
  promptTokens: prompt_tokens,
  completionTokens: completion_tokens,
  totalTokens: total_tokens,
  estimatedCost: totalCost,
  requestType: 'text'
});
```

### 4. Admin Dashboard Endpoints

**Add to `/server/index.js`:**
```javascript
// Get system-wide cost analytics
app.get('/api/admin/cost-analytics', authenticateToken, requireAdmin, async (req, res) => {
  const { startDate, endDate = new Date().toISOString().split('T')[0] } = req.query;

  const result = await pool.query(`
    SELECT
      date,
      SUM(total_cost_usd) as daily_cost,
      SUM(total_tokens) as daily_tokens,
      SUM(text_requests + image_requests + audio_requests) as daily_requests,
      COUNT(DISTINCT user_id) as active_users
    FROM ai_cost_summary
    WHERE date BETWEEN $1 AND $2
    GROUP BY date
    ORDER BY date DESC
  `, [startDate || '2024-01-01', endDate]);

  res.json({
    dailyStats: result.rows,
    totalCost: result.rows.reduce((sum, row) => sum + parseFloat(row.daily_cost), 0),
    totalTokens: result.rows.reduce((sum, row) => sum + parseInt(row.daily_tokens), 0)
  });
});

// Get top users by cost
app.get('/api/admin/top-users-by-cost', authenticateToken, requireAdmin, async (req, res) => {
  const { days = 30, limit = 20 } = req.query;

  const result = await pool.query(`
    SELECT
      u.id,
      u.email,
      u.username,
      u.tier,
      SUM(acs.total_cost_usd) as total_cost,
      SUM(acs.total_tokens) as total_tokens,
      SUM(acs.text_requests + acs.image_requests + acs.audio_requests) as total_requests
    FROM ai_cost_summary acs
    JOIN users u ON acs.user_id = u.id
    WHERE acs.date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
    GROUP BY u.id, u.email, u.username, u.tier
    ORDER BY total_cost DESC
    LIMIT $1
  `, [parseInt(limit)]);

  res.json({ topUsers: result.rows });
});

// Get cost breakdown by model
app.get('/api/admin/cost-by-model', authenticateToken, requireAdmin, async (req, res) => {
  const { days = 30 } = req.query;

  const result = await pool.query(`
    SELECT
      model,
      COUNT(*) as request_count,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_cost_usd) as total_cost,
      AVG(total_tokens) as avg_tokens_per_request
    FROM ai_generations
    WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
    GROUP BY model
    ORDER BY total_cost DESC
  `);

  res.json({ modelBreakdown: result.rows });
});
```

### 5. User-Facing Endpoints

```javascript
// Get user's own cost history
app.get('/api/users/ai-costs', authenticateToken, async (req, res) => {
  const { days = 30 } = req.query;

  const summary = await getUserCostSummary(
    req.user.userId,
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    new Date().toISOString().split('T')[0]
  );

  // Get current month totals
  const monthStart = new Date();
  monthStart.setDate(1);

  const monthSummary = await pool.query(`
    SELECT
      SUM(total_cost_usd) as month_total,
      SUM(total_tokens) as month_tokens,
      SUM(text_requests + image_requests + audio_requests) as month_requests
    FROM ai_cost_summary
    WHERE user_id = $1 AND date >= $2
  `, [req.user.userId, monthStart.toISOString().split('T')[0]]);

  res.json({
    dailyHistory: summary,
    monthToDate: monthSummary.rows[0]
  });
});

// Get detailed breakdown by tool type
app.get('/api/users/ai-costs/by-tool', authenticateToken, async (req, res) => {
  const { days = 30 } = req.query;

  const result = await pool.query(`
    SELECT
      tool_type,
      COUNT(*) as usage_count,
      SUM(total_tokens) as total_tokens,
      SUM(estimated_cost_usd) as total_cost,
      AVG(estimated_cost_usd) as avg_cost_per_use
    FROM ai_generations
    WHERE user_id = $1
      AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
    GROUP BY tool_type
    ORDER BY total_cost DESC
  `, [req.user.userId]);

  res.json({ toolBreakdown: result.rows });
});
```

### 6. Frontend Components

**Create `/src/components/CostAnalyticsDashboard.jsx` (Admin):**
- System-wide cost trends (daily chart)
- Top users by cost
- Cost breakdown by model
- Export to CSV

**Create `/src/components/UserCostBreakdown.jsx` (ProfilePage):**
- Month-to-date costs
- Daily cost chart (last 30 days)
- Breakdown by tool type
- Estimated monthly projection

**Enhance `/src/components/ProfilePage.jsx`:**
```jsx
// Add new tab: "AI Usage & Costs"
<Tab>
  <UserCostBreakdown />
</Tab>
```

### 7. Cost Display UX

**In QuotaBanner:**
```jsx
<div className="quota-banner">
  <span>2/3 books | 12.5k/50k words | 3/10 AI requests</span>
  <span className="cost-badge" title="Estimated AI costs this month">
    ~$0.12 this month
  </span>
</div>
```

**In AI Tools Result:**
```jsx
<div className="ai-result-footer">
  <span className="token-usage">
    Tokens: {totalTokens.toLocaleString()} (~${cost.toFixed(4)})
  </span>
</div>
```

### 8. Migration Strategy

1. Create migration file: `add_ai_cost_tracking.sql`
2. Run migration on production
3. Backfill existing `ai_generations` with estimated costs (if needed)
4. Update all AI endpoints to track costs
5. Deploy admin dashboard
6. Deploy user-facing cost view

## Pricing Reference (OpenAI as of 2024)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| gpt-4o-mini | $0.150 | $0.600 |
| gpt-4o | $5.00 | $15.00 |
| gpt-4-turbo | $10.00 | $30.00 |
| DALL-E 3 (HD) | - | $0.080/image |
| DALL-E 3 (std) | - | $0.040/image |
| TTS-1 | - | $15.00/1M chars |
| Whisper | - | $0.006/minute |

## Cost Optimization Opportunities

1. **Prompt optimization** - Reduce prompt tokens by removing unnecessary context
2. **Model selection** - Use gpt-4o-mini where possible ($0.15 vs $5 for gpt-4o)
3. **Caching** - Cache common generations (character templates, etc.)
4. **Batch operations** - Combine multiple requests where possible
5. **User limits** - Set monthly cost caps per tier

## Tier-Based Cost Limits (Suggested)

| Tier | Monthly AI Cost Cap | Alerts |
|------|---------------------|--------|
| Free | $0.50 | 80%, 100% |
| Basic (£9.99) | $2.00 | 80%, 100% |
| Premium (£19.99) | $5.00 | 90%, 100% |

## Implementation Phases

### Phase 1: Core Tracking (1-2 days)
- Database migration
- Update `/api/generate` to track tokens & costs
- Update `/api/generate-batch`
- Service layer (costTracking.js)

### Phase 2: Admin Analytics (1 day)
- Admin cost endpoints
- Cost analytics dashboard
- Export functionality

### Phase 3: User Transparency (1 day)
- User cost endpoints
- ProfilePage cost breakdown
- QuotaBanner cost display

### Phase 4: Budget Controls (Future)
- Set per-user cost limits
- Automatic throttling at limits
- Email notifications

## Success Metrics

- Track 100% of AI API calls with accurate token counts
- Display costs to admins within 1 second
- Show users their monthly costs
- Identify top 10% of users by cost
- Enable cost-based decision making for feature development
