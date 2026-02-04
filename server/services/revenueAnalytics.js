import { getPool } from '../db/postgres.js';
import { getTierQuotas } from '../config/tierQuotas.js';

/**
 * Calculate Monthly Recurring Revenue (MRR)
 * @returns {Promise<object>} MRR data with total and breakdown by tier
 */
export async function calculateMRR() {
  const pool = getPool();

  // Get active subscriptions grouped by tier
  const result = await pool.query(`
    SELECT
      tier,
      COUNT(*) as count,
      CASE
        WHEN tier = 'basic' THEN COUNT(*) * 999
        WHEN tier = 'premium' THEN COUNT(*) * 1999
        ELSE 0
      END as mrr
    FROM subscriptions
    WHERE status = 'active'
    GROUP BY tier
  `);

  // Calculate total MRR
  const totalMRR = result.rows.reduce((sum, row) => sum + parseInt(row.mrr), 0);

  return {
    total_mrr: totalMRR,
    by_tier: result.rows.map(row => ({
      tier: row.tier,
      count: parseInt(row.count),
      mrr: parseInt(row.mrr)
    })),
    currency: 'usd'
  };
}

/**
 * Calculate churn rate for a given period
 * @param {string} period - 'monthly' or 'weekly'
 * @returns {Promise<object>} Churn rate data
 */
export async function calculateChurnRate(period = 'monthly') {
  const pool = getPool();
  const interval = period === 'monthly' ? '30 days' : '7 days';

  const result = await pool.query(`
    WITH period_stats AS (
      SELECT
        (SELECT COUNT(*) FROM subscriptions
         WHERE status = 'active'
         AND created_at <= NOW() - INTERVAL '${interval}') as active_start,
        (SELECT COUNT(*) FROM subscriptions
         WHERE status = 'canceled'
         AND canceled_at >= NOW() - INTERVAL '${interval}') as churned
    )
    SELECT
      active_start,
      churned,
      CASE
        WHEN active_start > 0 THEN (churned::float / active_start * 100)
        ELSE 0
      END as churn_rate
    FROM period_stats
  `);

  return {
    active_start: parseInt(result.rows[0].active_start) || 0,
    churned: parseInt(result.rows[0].churned) || 0,
    churn_rate: parseFloat(result.rows[0].churn_rate) || 0
  };
}

/**
 * Calculate Customer Lifetime Value (LTV)
 * @returns {Promise<object>} LTV data
 */
export async function calculateLTV() {
  const pool = getPool();

  // Get churn rate
  const churn = await calculateChurnRate('monthly');

  // Get MRR
  const mrr = await calculateMRR();

  // Get active subscriber count
  const result = await pool.query(`
    SELECT COUNT(DISTINCT user_id) as active_subscribers
    FROM subscriptions
    WHERE status = 'active'
  `);

  const activeSubscribers = parseInt(result.rows[0].active_subscribers) || 0;

  // Calculate average revenue per user
  const avgRevenuePerUser = activeSubscribers > 0
    ? mrr.total_mrr / activeSubscribers
    : 0;

  // Calculate LTV = ARPU / Churn Rate
  const ltv = churn.churn_rate > 0
    ? avgRevenuePerUser / (churn.churn_rate / 100)
    : 0;

  return {
    ltv: Math.round(ltv),
    avg_revenue_per_user: Math.round(avgRevenuePerUser),
    churn_rate: churn.churn_rate,
    active_subscribers: activeSubscribers
  };
}

/**
 * Get revenue time series data
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} granularity - 'day', 'week', or 'month'
 * @returns {Promise<Array>} Time series data
 */
export async function getRevenueTimeSeries(startDate, endDate, granularity = 'day') {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      DATE_TRUNC($1, created_at) as period,
      COUNT(*) as payment_count,
      SUM(amount) as revenue,
      COUNT(DISTINCT user_id) as unique_payers
    FROM payments
    WHERE status = 'succeeded'
      AND created_at >= $2
      AND created_at <= $3
    GROUP BY DATE_TRUNC($1, created_at)
    ORDER BY period ASC
  `, [granularity, startDate, endDate]);

  return result.rows.map(row => ({
    date: row.period,
    revenue: parseInt(row.revenue) || 0,
    payment_count: parseInt(row.payment_count) || 0,
    unique_payers: parseInt(row.unique_payers) || 0
  }));
}

/**
 * Get period statistics (new subscriptions, cancellations, upgrades, downgrades)
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<object>} Period statistics
 */
export async function getPeriodStats(startDate, endDate) {
  const pool = getPool();

  // New subscriptions in period
  const newSubsResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM subscriptions
    WHERE created_at >= $1 AND created_at <= $2
  `, [startDate, endDate]);

  // Cancellations in period
  const canceledResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM subscriptions
    WHERE canceled_at >= $1 AND canceled_at <= $2
  `, [startDate, endDate]);

  // Tier changes (upgrades/downgrades) - check audit log
  const upgradesResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM admin_audit_log
    WHERE action = 'tier_change'
      AND created_at >= $1 AND created_at <= $2
      AND changes->>'new_tier' = 'premium'
      AND changes->>'old_tier' = 'basic'
  `, [startDate, endDate]);

  const downgradesResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM admin_audit_log
    WHERE action = 'tier_change'
      AND created_at >= $1 AND created_at <= $2
      AND changes->>'new_tier' = 'basic'
      AND changes->>'old_tier' = 'premium'
  `, [startDate, endDate]);

  return {
    new_subscriptions: parseInt(newSubsResult.rows[0].count) || 0,
    canceled_subscriptions: parseInt(canceledResult.rows[0].count) || 0,
    upgrades: parseInt(upgradesResult.rows[0].count) || 0,
    downgrades: parseInt(downgradesResult.rows[0].count) || 0
  };
}
