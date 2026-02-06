/**
 * AI Cost Tracking Service
 * Handles token usage tracking and cost calculations for AI operations
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Pricing cache to avoid repeated database lookups
 */
let pricingCache = {};
let pricingCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Load pricing data from database
 */
async function loadPricing() {
  const now = Date.now();

  // Return cached data if still valid
  if (pricingCacheTime && (now - pricingCacheTime) < CACHE_TTL) {
    return pricingCache;
  }

  try {
    const result = await pool.query(`
      SELECT
        model_name,
        input_price_per_1m,
        output_price_per_1m,
        unit_price,
        unit_type
      FROM ai_pricing
      WHERE is_active = TRUE
    `);

    pricingCache = {};
    result.rows.forEach(row => {
      pricingCache[row.model_name] = {
        inputPrice: parseFloat(row.input_price_per_1m),
        outputPrice: parseFloat(row.output_price_per_1m),
        unitPrice: row.unit_price ? parseFloat(row.unit_price) : null,
        unitType: row.unit_type
      };
    });

    pricingCacheTime = now;
    return pricingCache;
  } catch (error) {
    console.error('Error loading pricing data:', error);
    return pricingCache; // Return stale cache if DB fails
  }
}

/**
 * Get pricing for a specific model
 */
async function getPricing(modelName) {
  const pricing = await loadPricing();
  return pricing[modelName] || pricing['gpt-4o-mini']; // Fallback to default
}

/**
 * Calculate cost for text generation (GPT models)
 * @param {string} model - Model name (e.g., 'gpt-4o-mini')
 * @param {number} promptTokens - Number of input tokens
 * @param {number} completionTokens - Number of output tokens
 * @returns {Object} Cost breakdown
 */
export async function calculateTextCost(model, promptTokens, completionTokens) {
  const pricing = await getPricing(model);

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPrice;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPrice;

  return {
    inputCost: parseFloat(inputCost.toFixed(6)),
    outputCost: parseFloat(outputCost.toFixed(6)),
    totalCost: parseFloat((inputCost + outputCost).toFixed(6)),
    totalTokens: promptTokens + completionTokens,
    model
  };
}

/**
 * Calculate cost for image generation (DALL-E)
 * @param {string} model - Model name (e.g., 'dall-e-3', 'dall-e-3-hd')
 * @param {number} count - Number of images generated
 * @returns {Object} Cost information
 */
export async function calculateImageCost(model, count = 1) {
  const pricing = await getPricing(model);

  return {
    totalCost: parseFloat((pricing.unitPrice * count).toFixed(6)),
    unitCost: pricing.unitPrice,
    count,
    model
  };
}

/**
 * Calculate cost for audio generation (TTS)
 * @param {string} model - Model name (e.g., 'tts-1', 'tts-1-hd')
 * @param {number} characterCount - Number of characters
 * @returns {Object} Cost information
 */
export async function calculateAudioCost(model, characterCount) {
  const pricing = await getPricing(model);

  // TTS pricing is per 1M characters
  const cost = (characterCount / 1_000_000) * pricing.unitPrice;

  return {
    totalCost: parseFloat(cost.toFixed(6)),
    characterCount,
    model
  };
}

/**
 * Track AI usage - saves to daily summary table
 * Note: Individual generations are saved separately in ai_generations table
 * This function is for additional tracking if needed
 *
 * @param {string} userId - User UUID
 * @param {Object} data - Usage data
 */
export async function trackAIUsage(userId, data) {
  const {
    model,
    promptTokens = 0,
    completionTokens = 0,
    totalTokens = 0,
    estimatedCost = 0,
    requestType = 'text' // text, image, audio
  } = data;

  try {
    const requestField = `${requestType}_requests`;

    await pool.query(`
      INSERT INTO ai_cost_summary
        (user_id, date, total_tokens, prompt_tokens, completion_tokens, total_cost_usd, ${requestField})
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, 1)
      ON CONFLICT (user_id, date)
      DO UPDATE SET
        total_tokens = ai_cost_summary.total_tokens + $2,
        prompt_tokens = ai_cost_summary.prompt_tokens + $3,
        completion_tokens = ai_cost_summary.completion_tokens + $4,
        total_cost_usd = ai_cost_summary.total_cost_usd + $5,
        ${requestField} = ai_cost_summary.${requestField} + 1,
        updated_at = NOW()
    `, [userId, totalTokens, promptTokens, completionTokens, estimatedCost]);
  } catch (error) {
    console.error('Error tracking AI usage:', error);
    // Don't throw - tracking failures shouldn't break the main flow
  }
}

/**
 * Get user's cost summary for date range
 * @param {string} userId - User UUID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Array} Daily cost summaries
 */
export async function getUserCostSummary(userId, startDate, endDate) {
  try {
    const result = await pool.query(`
      SELECT
        date,
        total_tokens,
        prompt_tokens,
        completion_tokens,
        total_cost_usd,
        text_requests,
        image_requests,
        audio_requests,
        (text_requests + image_requests + audio_requests) as total_requests
      FROM ai_cost_summary
      WHERE user_id = $1
        AND date BETWEEN $2 AND $3
      ORDER BY date DESC
    `, [userId, startDate, endDate]);

    return result.rows.map(row => ({
      date: row.date,
      totalTokens: parseInt(row.total_tokens) || 0,
      promptTokens: parseInt(row.prompt_tokens) || 0,
      completionTokens: parseInt(row.completion_tokens) || 0,
      totalCost: parseFloat(row.total_cost_usd) || 0,
      textRequests: parseInt(row.text_requests) || 0,
      imageRequests: parseInt(row.image_requests) || 0,
      audioRequests: parseInt(row.audio_requests) || 0,
      totalRequests: parseInt(row.total_requests) || 0
    }));
  } catch (error) {
    console.error('Error getting user cost summary:', error);
    return [];
  }
}

/**
 * Get user's current month totals
 * @param {string} userId - User UUID
 * @returns {Object} Month-to-date totals
 */
export async function getUserMonthTotals(userId) {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const result = await pool.query(`
      SELECT
        SUM(total_tokens) as month_tokens,
        SUM(total_cost_usd) as month_cost,
        SUM(text_requests + image_requests + audio_requests) as month_requests
      FROM ai_cost_summary
      WHERE user_id = $1 AND date >= $2
    `, [userId, monthStart.toISOString().split('T')[0]]);

    const row = result.rows[0];
    return {
      monthTokens: parseInt(row.month_tokens) || 0,
      monthCost: parseFloat(row.month_cost) || 0,
      monthRequests: parseInt(row.month_requests) || 0
    };
  } catch (error) {
    console.error('Error getting user month totals:', error);
    return { monthTokens: 0, monthCost: 0, monthRequests: 0 };
  }
}

/**
 * Get breakdown by tool type for a user
 * @param {string} userId - User UUID
 * @param {number} days - Number of days to look back
 * @returns {Array} Tool breakdown
 */
export async function getUserCostByTool(userId, days = 30) {
  try {
    const result = await pool.query(`
      SELECT
        tool_type,
        COUNT(*) as usage_count,
        SUM(total_tokens) as total_tokens,
        SUM(estimated_cost_usd) as total_cost,
        AVG(estimated_cost_usd) as avg_cost_per_use,
        AVG(total_tokens) as avg_tokens_per_use
      FROM ai_generations
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY tool_type
      ORDER BY total_cost DESC
    `, [userId]);

    return result.rows.map(row => ({
      toolType: row.tool_type,
      usageCount: parseInt(row.usage_count),
      totalTokens: parseInt(row.total_tokens) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      avgCostPerUse: parseFloat(row.avg_cost_per_use) || 0,
      avgTokensPerUse: parseInt(row.avg_tokens_per_use) || 0
    }));
  } catch (error) {
    console.error('Error getting user cost by tool:', error);
    return [];
  }
}

/**
 * Get system-wide cost analytics (admin only)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object} System-wide stats
 */
export async function getSystemCostAnalytics(startDate, endDate) {
  try {
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
    `, [startDate, endDate]);

    const totals = {
      totalCost: 0,
      totalTokens: 0,
      totalRequests: 0,
      uniqueUsers: new Set()
    };

    const dailyStats = result.rows.map(row => {
      const cost = parseFloat(row.daily_cost) || 0;
      const tokens = parseInt(row.daily_tokens) || 0;
      const requests = parseInt(row.daily_requests) || 0;

      totals.totalCost += cost;
      totals.totalTokens += tokens;
      totals.totalRequests += requests;

      return {
        date: row.date,
        dailyCost: cost,
        dailyTokens: tokens,
        dailyRequests: requests,
        activeUsers: parseInt(row.active_users) || 0
      };
    });

    return {
      dailyStats,
      summary: {
        totalCost: parseFloat(totals.totalCost.toFixed(2)),
        totalTokens: totals.totalTokens,
        totalRequests: totals.totalRequests,
        avgDailyCost: dailyStats.length > 0 ? parseFloat((totals.totalCost / dailyStats.length).toFixed(2)) : 0
      }
    };
  } catch (error) {
    console.error('Error getting system cost analytics:', error);
    return { dailyStats: [], summary: {} };
  }
}

/**
 * Get top users by cost (admin only)
 * @param {number} days - Number of days to look back
 * @param {number} limit - Number of top users to return
 * @returns {Array} Top users
 */
export async function getTopUsersByCost(days = 30, limit = 20) {
  try {
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

    return result.rows.map(row => ({
      userId: row.id,
      email: row.email,
      username: row.username,
      tier: row.tier,
      totalCost: parseFloat(row.total_cost) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      totalRequests: parseInt(row.total_requests) || 0
    }));
  } catch (error) {
    console.error('Error getting top users by cost:', error);
    return [];
  }
}

/**
 * Get cost breakdown by model (admin only)
 * @param {number} days - Number of days to look back
 * @returns {Array} Model breakdown
 */
export async function getCostByModel(days = 30) {
  try {
    const result = await pool.query(`
      SELECT
        model,
        COUNT(*) as request_count,
        SUM(total_tokens) as total_tokens,
        SUM(estimated_cost_usd) as total_cost,
        AVG(total_tokens) as avg_tokens_per_request,
        AVG(estimated_cost_usd) as avg_cost_per_request
      FROM ai_generations
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY model
      ORDER BY total_cost DESC
    `);

    return result.rows.map(row => ({
      model: row.model,
      requestCount: parseInt(row.request_count),
      totalTokens: parseInt(row.total_tokens) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      avgTokensPerRequest: parseInt(row.avg_tokens_per_request) || 0,
      avgCostPerRequest: parseFloat(row.avg_cost_per_request) || 0
    }));
  } catch (error) {
    console.error('Error getting cost by model:', error);
    return [];
  }
}

/**
 * Invalidate pricing cache (call after updating pricing in database)
 */
export function invalidatePricingCache() {
  pricingCache = {};
  pricingCacheTime = 0;
}
