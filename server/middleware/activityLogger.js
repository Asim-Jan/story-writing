import { getPool } from '../db/postgres.js';

/**
 * Middleware to log user activities
 * Records successful API calls to user_activity_log table
 *
 * @param {string} activityType - Type of activity (e.g., 'book_created', 'chapter_updated')
 * @returns {Function} Express middleware function
 */
export const logActivity = (activityType) => {
  return async (req, res, next) => {
    // Store original json function
    const originalJson = res.json.bind(res);

    // Override res.json to log after successful response
    res.json = function(data) {
      // Only log if response was successful (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Log asynchronously (don't block response)
        setImmediate(async () => {
          try {
            const pool = getPool();
            const userId = req.user?.userId;

            if (!userId) {
              // Skip logging if no authenticated user
              return;
            }

            // Extract relevant details from request
            const details = {
              method: req.method,
              path: req.path,
              query: req.query,
              // Don't log sensitive data (passwords, API keys, etc.)
              body: sanitizeBody(req.body)
            };

            // Get IP address
            const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
              || req.headers['x-real-ip']
              || req.connection?.remoteAddress
              || req.socket?.remoteAddress;

            // Get user agent
            const userAgent = req.headers['user-agent'] || 'Unknown';

            // Insert activity log
            await pool.query(
              `INSERT INTO user_activity_log
               (user_id, activity_type, details, ip_address, user_agent, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [userId, activityType, JSON.stringify(details), ipAddress, userAgent]
            );
          } catch (error) {
            // Don't throw errors - logging failures shouldn't break the API
            console.error('Activity logging error:', error);
          }
        });
      }

      // Call original json function
      return originalJson(data);
    };

    next();
  };
};

/**
 * Sanitize request body to remove sensitive data
 * @param {Object} body - Request body
 * @returns {Object} Sanitized body
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const sanitized = { ...body };

  // Remove sensitive fields
  const sensitiveFields = [
    'password',
    'newPassword',
    'oldPassword',
    'apiKey',
    'openaiApiKey',
    'geminiApiKey',
    'token',
    'accessToken',
    'refreshToken',
    'secret',
    'secretKey'
  ];

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
}
