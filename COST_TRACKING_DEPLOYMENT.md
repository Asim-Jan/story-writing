# AI Cost Tracking Deployment - v2.17.0

**Deployment Date:** 2026-02-06
**Version:** 2.17.0
**Status:** ✅ DEPLOYED TO PRODUCTION

---

## Summary

Deployed comprehensive AI token usage and cost tracking system with full admin analytics and user-facing dashboards.

## Database Migration ✅

**Migration Script:** `server/scripts/run-cost-tracking-migration.js`
**Migration File:** `server/db/migrations/add_ai_cost_tracking.sql`

### Tables Created:
- ✅ `ai_cost_summary` - Daily aggregated costs per user
- ✅ `ai_pricing` - Model pricing for cost calculation

### Columns Added to `ai_generations`:
- ✅ `prompt_tokens` - Input token count
- ✅ `completion_tokens` - Output token count
- ✅ `total_tokens` - Total tokens used
- ✅ `estimated_cost_usd` - Calculated cost

### Database Objects Created:
- ✅ PostgreSQL trigger: `trg_update_cost_summary`
- ✅ Function: `update_ai_cost_summary()`
- ✅ Function: `calculate_generation_cost()`
- ✅ View: `v_user_monthly_costs`
- ✅ View: `v_daily_system_costs`

### Pricing Data Loaded:
- ✅ gpt-4o-mini: $0.15/$0.60 per 1M tokens
- ✅ gpt-4o: $5.00/$15.00 per 1M tokens
- ✅ gpt-4-turbo: $10.00/$30.00 per 1M tokens
- ✅ gpt-3.5-turbo: $0.50/$1.50 per 1M tokens
- ✅ DALL-E models: $0.02-$0.08 per image
- ✅ TTS models: $15-$30 per 1M characters
- ✅ Whisper: $0.006 per minute

---

## Backend Changes ✅

**Deployed:** v2.17.0 Backend

### New Service:
- `server/services/costTracking.js` (422 lines)
  - `calculateTextCost()` - GPT model cost calculation
  - `calculateImageCost()` - DALL-E cost calculation
  - `calculateAudioCost()` - TTS/STT cost calculation
  - `getUserCostSummary()` - User cost history
  - `getUserMonthTotals()` - Current month totals
  - `getUserCostByTool()` - Breakdown by tool type
  - `getSystemCostAnalytics()` - System-wide analytics (admin)
  - `getTopUsersByCost()` - Top spenders (admin)
  - `getCostByModel()` - Model breakdown (admin)

### API Endpoints Added:

**Admin Endpoints:**
- `GET /api/admin/analytics/ai-costs` - System-wide cost analytics
  - Query params: `start_date`, `end_date`
  - Returns: daily stats, summary totals

- `GET /api/admin/analytics/top-users-by-cost` - Top users by spend
  - Query params: `days`, `limit`
  - Returns: top users with tier, cost, tokens, requests

- `GET /api/admin/analytics/cost-by-model` - Cost breakdown by model
  - Query params: `days`
  - Returns: model breakdown with request counts, tokens, costs

**User Endpoints:**
- `GET /api/users/ai-costs` - User's own cost history
  - Query params: `days`
  - Returns: daily history, month-to-date totals

- `GET /api/users/ai-costs/by-tool` - User's cost breakdown by tool
  - Query params: `days`
  - Returns: tool breakdown with usage counts, tokens, costs

### Modified Endpoints:
- ✅ `/api/generate` - Now extracts token usage from OpenAI responses and saves to database with costs
- ✅ `/api/generate-batch` - Now tracks tokens and costs for each variation

### Token Tracking Integration:
```javascript
// Extracts from OpenAI response:
const usage = completion.usage;
const { prompt_tokens, completion_tokens, total_tokens } = usage;

// Calculates cost:
const costData = await costTracking.calculateTextCost(model, prompt_tokens, completion_tokens);

// Saves to database:
INSERT INTO ai_generations (
  user_id, book_id, tool_type, prompt, result, model,
  prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd
) VALUES (...)
```

---

## Frontend Changes ✅

**Deployed:** v2.17.0 Frontend

### Admin Dashboard - New Tab: "AI Costs"

**Component:** `src/components/AICostAnalytics.jsx` (321 lines)

**Features:**
- 📊 **Summary Cards:**
  - Total Cost (last N days)
  - Total Tokens (in millions)
  - Average Daily Cost
  - Total Requests

- 📈 **Daily Cost Trend Chart:**
  - Line chart with dual Y-axis (cost + requests)
  - Date range selector: 7/14/30/60/90 days
  - Interactive tooltips with formatted values

- 👥 **Top Users by Cost:**
  - Sortable table with user info
  - Tier badges (free/basic/premium)
  - Total cost, tokens, and request counts
  - Limit selector: top 10/20/50

- 🖥️ **Model Breakdown:**
  - Pie chart showing cost distribution
  - Detailed list with request counts
  - Token usage per model
  - Color-coded visualization

- 🔄 **Refresh Button:** Manual data updates

**Access:** Admin Dashboard → AI Costs tab

---

### User Profile - New Tab: "AI Costs"

**Component:** `src/components/UserAICosts.jsx` (344 lines)

**Features:**
- 💰 **Personal Summary Cards:**
  - This Month: Total cost + request count
  - Tokens Used: Month-to-date token usage
  - Projected: Estimated monthly total
  - Avg/Request: Average cost per generation

- 📅 **Daily Usage Trend:**
  - Line chart with cost + tokens
  - Date range selector: 7/14/30/60/90 days
  - Shows usage patterns over time

- 🎯 **Usage by Tool:**
  - Pie chart showing cost distribution by AI tool
  - Detailed breakdown: usage count, tokens, avg cost
  - Tool names: dialogue, plot-analysis, character-arc, etc.

- 💡 **Cost Optimization Tips:**
  - Use Templates - Get better results with fewer tokens
  - Be Specific - Clear prompts need fewer tokens
  - Review History - Reuse previous results
  - Monitor Usage - Track patterns and optimize

- ℹ️ **Understanding AI Costs:**
  - Educational panel explaining cost estimates
  - Current pricing information
  - Transparency about OpenAI model usage

**Access:** Profile Page → AI Costs tab

---

## Verification Steps

### Test Admin Dashboard:
1. ✅ Go to Admin Dashboard
2. ✅ Click "AI Costs" tab
3. ✅ Verify summary cards display correctly
4. ✅ Check daily cost trend chart loads
5. ✅ Verify top users table shows data
6. ✅ Check model breakdown pie chart
7. ✅ Test date range selector
8. ✅ Test refresh button

### Test User Profile:
1. ✅ Go to Profile Page
2. ✅ Click "AI Costs" tab
3. ✅ Verify personal summary cards
4. ✅ Check daily usage chart loads
5. ✅ Verify tool breakdown displays
6. ✅ Test date range selector
7. ✅ Verify projected costs calculate correctly

### Test Token Tracking:
1. ✅ Generate AI content (any tool)
2. ✅ Verify generation appears in history
3. ✅ Check database: `SELECT * FROM ai_generations ORDER BY created_at DESC LIMIT 1;`
4. ✅ Verify tokens and cost are populated
5. ✅ Check daily summary updated: `SELECT * FROM ai_cost_summary WHERE user_id = '...' AND date = CURRENT_DATE;`

---

## Rollback Plan

If issues occur:

### 1. Revert Application
```bash
# Deploy previous version
echo "y" | ./deploy.sh all patch  # Will deploy 2.16.4
```

### 2. Database (Optional)
Tables can remain - they won't interfere with old code.

If needed to remove:
```sql
-- Drop tables
DROP TABLE IF EXISTS ai_cost_summary CASCADE;
DROP TABLE IF EXISTS ai_pricing CASCADE;

-- Remove columns from ai_generations
ALTER TABLE ai_generations
DROP COLUMN IF EXISTS prompt_tokens,
DROP COLUMN IF EXISTS completion_tokens,
DROP COLUMN IF EXISTS total_tokens,
DROP COLUMN IF EXISTS estimated_cost_usd;

-- Drop functions
DROP FUNCTION IF EXISTS update_ai_cost_summary();
DROP FUNCTION IF EXISTS calculate_generation_cost(VARCHAR, INTEGER, INTEGER);

-- Drop views
DROP VIEW IF EXISTS v_user_monthly_costs;
DROP VIEW IF EXISTS v_daily_system_costs;
```

---

## Performance Considerations

### Database:
- ✅ Indexes on `ai_cost_summary(user_id, date)` for fast lookups
- ✅ Indexes on `ai_generations` for history queries
- ✅ Views for common aggregations (monthly costs, daily system costs)
- ✅ Automatic trigger updates (no manual sync needed)

### API:
- ✅ Efficient queries with proper WHERE clauses
- ✅ Pagination support (limit/offset)
- ✅ Date range filtering
- ✅ Cached pricing data (1 hour TTL)

### Frontend:
- ✅ Lazy loading of components
- ✅ Date range limits to prevent excessive data
- ✅ Responsive charts with proper sizing
- ✅ Manual refresh (not auto-polling)

---

## Cost Calculation Formula

### Text Generation (GPT Models):
```javascript
inputCost = (prompt_tokens / 1,000,000) × input_price_per_1m
outputCost = (completion_tokens / 1,000,000) × output_price_per_1m
totalCost = inputCost + outputCost
```

**Example (gpt-4o-mini):**
- Prompt: 500 tokens
- Completion: 300 tokens
- Input cost: (500 / 1,000,000) × $0.15 = $0.000075
- Output cost: (300 / 1,000,000) × $0.60 = $0.000180
- Total cost: $0.000255

### Image Generation:
```javascript
totalCost = unit_price × count
```

**Example (DALL-E 3):**
- Images: 1
- Cost: $0.040 × 1 = $0.040

---

## Monitoring

### Key Metrics to Watch:

1. **System-wide costs**
   - Daily cost trends
   - Monthly totals
   - Top spenders

2. **User behavior**
   - Average cost per user
   - Request patterns
   - Tool usage distribution

3. **Model usage**
   - Which models are used most
   - Cost efficiency by model
   - Token consumption rates

### Alerts to Set Up (Future):
- Daily cost exceeds threshold
- Individual user exceeds budget
- Unusual spike in requests
- Model cost anomalies

---

## Next Steps (Optional Enhancements)

### Tier-Based Cost Limits:
- Set monthly cost caps per tier
- Automatic throttling at limits
- Email notifications

### Cost Forecasting:
- Predict monthly costs based on trends
- Alert users approaching limits
- Suggest optimization strategies

### Advanced Analytics:
- Cost per feature analysis
- ROI calculations
- Usage heatmaps
- Comparative analysis (user vs average)

### Optimization Tools:
- Prompt length analyzer
- Model recommendation engine
- Batch operation scheduler
- Caching suggestions

---

## Documentation

- ✅ `COST_TRACKING_PLAN.md` - Comprehensive planning document
- ✅ `server/db/migrations/add_ai_cost_tracking.sql` - Migration with comments
- ✅ `server/services/costTracking.js` - Inline documentation
- ✅ This deployment guide

---

## Success Criteria ✅

- [x] Database migration runs successfully
- [x] All new tables and columns created
- [x] Pricing data loaded correctly
- [x] Token tracking works on all AI endpoints
- [x] Admin dashboard displays cost analytics
- [x] User profile shows personal costs
- [x] Charts render correctly
- [x] Data refreshes properly
- [x] No performance degradation
- [x] No errors in production logs

---

## Deployment Timeline

- **13:00** - Database migration completed
- **13:05** - Backend v2.17.0 deployed
- **13:10** - Frontend v2.17.0 deployed
- **13:15** - ECS rollout in progress
- **13:20** - Deployment complete ✅

---

## Contact

For issues or questions:
- Check production logs: `aws logs tail /ecs/story-writing-backend --follow`
- Monitor ECS deployment: `aws ecs describe-services --cluster story-writing-cluster-sai --services story-writing-backend story-writing-frontend`
- Database queries: Connect to RDS PostgreSQL

---

**Deployment completed successfully! 🎉**

All AI generations from this point forward will automatically track tokens and costs.
Users can now see their AI usage and costs in their profile.
Admins can monitor system-wide costs and optimize accordingly.
