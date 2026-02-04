import { getPool } from '../db/postgres.js';

/**
 * Calculate Daily Active Users (DAU), Weekly Active Users (WAU), and Monthly Active Users (MAU)
 * @returns {Promise<Object>} DAU, WAU, MAU counts and ratios
 */
export async function calculateActiveUsers() {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '1 day' THEN user_id END) as dau,
      COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN user_id END) as wau,
      COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN user_id END) as mau
    FROM user_activity_log
  `);

  const dau = parseInt(result.rows[0].dau) || 0;
  const wau = parseInt(result.rows[0].wau) || 0;
  const mau = parseInt(result.rows[0].mau) || 0;

  // Calculate DAU/MAU ratio (stickiness metric)
  const dauMauRatio = mau > 0 ? ((dau / mau) * 100) : 0;

  return {
    dau,
    wau,
    mau,
    dau_mau_ratio: parseFloat(dauMauRatio.toFixed(2))
  };
}

/**
 * Calculate average sessions per user and average actions per session
 * @returns {Promise<Object>} Session metrics
 */
export async function calculateSessionMetrics() {
  const pool = getPool();

  // Calculate average actions per user in last 30 days
  const actionsResult = await pool.query(`
    SELECT
      COUNT(*) as total_actions,
      COUNT(DISTINCT user_id) as unique_users
    FROM user_activity_log
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `);

  const totalActions = parseInt(actionsResult.rows[0].total_actions) || 0;
  const uniqueUsers = parseInt(actionsResult.rows[0].unique_users) || 0;

  const avgActionsPerUser = uniqueUsers > 0 ? (totalActions / uniqueUsers) : 0;

  // Estimate sessions (group activities within 30 minutes as one session)
  const sessionsResult = await pool.query(`
    WITH sessions AS (
      SELECT
        user_id,
        created_at,
        LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) as prev_activity,
        CASE
          WHEN created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) > INTERVAL '30 minutes'
            OR LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) IS NULL
          THEN 1
          ELSE 0
        END as is_new_session
      FROM user_activity_log
      WHERE created_at >= NOW() - INTERVAL '30 days'
    )
    SELECT
      COUNT(*) FILTER (WHERE is_new_session = 1) as total_sessions,
      COUNT(DISTINCT user_id) as unique_users
    FROM sessions
  `);

  const totalSessions = parseInt(sessionsResult.rows[0].total_sessions) || 0;
  const sessionUsers = parseInt(sessionsResult.rows[0].unique_users) || 0;

  const avgSessionsPerUser = sessionUsers > 0 ? (totalSessions / sessionUsers) : 0;
  const avgActionsPerSession = totalSessions > 0 ? (totalActions / totalSessions) : 0;

  return {
    avg_sessions_per_user: parseFloat(avgSessionsPerUser.toFixed(2)),
    avg_actions_per_session: parseFloat(avgActionsPerSession.toFixed(2))
  };
}

/**
 * Get activity breakdown by type
 * @param {Date} startDate - Start date for analysis
 * @param {Date} endDate - End date for analysis
 * @returns {Promise<Array>} Activity breakdown by type
 */
export async function getActivityBreakdown(startDate, endDate) {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      activity_type,
      COUNT(*) as count,
      COUNT(DISTINCT user_id) as unique_users
    FROM user_activity_log
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY activity_type
    ORDER BY count DESC
    LIMIT 20
  `, [startDate, endDate]);

  return result.rows.map(row => ({
    activity_type: row.activity_type,
    count: parseInt(row.count),
    unique_users: parseInt(row.unique_users)
  }));
}

/**
 * Get activity time series data
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} granularity - 'day', 'week', or 'month'
 * @returns {Promise<Array>} Time series data
 */
export async function getActivityTimeSeries(startDate, endDate, granularity = 'day') {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      DATE_TRUNC($1, created_at) as period,
      COUNT(DISTINCT user_id) as active_users,
      COUNT(*) as total_actions
    FROM user_activity_log
    WHERE created_at >= $2 AND created_at <= $3
    GROUP BY DATE_TRUNC($1, created_at)
    ORDER BY period ASC
  `, [granularity, startDate, endDate]);

  return result.rows.map(row => ({
    date: row.period,
    active_users: parseInt(row.active_users),
    total_actions: parseInt(row.total_actions)
  }));
}

/**
 * Get new users in time period
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} granularity - 'day', 'week', or 'month'
 * @returns {Promise<Array>} New users time series
 */
export async function getNewUsersTimeSeries(startDate, endDate, granularity = 'day') {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      DATE_TRUNC($1, created_at) as period,
      COUNT(*) as new_users
    FROM users
    WHERE created_at >= $2 AND created_at <= $3
    GROUP BY DATE_TRUNC($1, created_at)
    ORDER BY period ASC
  `, [granularity, startDate, endDate]);

  return result.rows.map(row => ({
    date: row.period,
    new_users: parseInt(row.new_users)
  }));
}

/**
 * Get total user count
 * @returns {Promise<number>} Total users
 */
export async function getTotalUsers() {
  const pool = getPool();

  const result = await pool.query(`
    SELECT COUNT(*) as total FROM users
  `);

  return parseInt(result.rows[0].total) || 0;
}

/**
 * Get active users in last N days
 * @param {number} days - Number of days to look back
 * @returns {Promise<number>} Active user count
 */
export async function getActiveUsersInPeriod(days) {
  const pool = getPool();

  const result = await pool.query(`
    SELECT COUNT(DISTINCT user_id) as active
    FROM user_activity_log
    WHERE created_at >= NOW() - INTERVAL '${days} days'
  `);

  return parseInt(result.rows[0].active) || 0;
}
