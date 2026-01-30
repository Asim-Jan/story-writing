/**
 * Admin Authorization Middleware
 *
 * Provides role-based access control for admin-only routes
 */

/**
 * Middleware to require admin role
 * Must be used after authenticateToken middleware
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const requireAdmin = async (req, res, next) => {
  try {
    // Check if user is authenticated (should be done by authenticateToken middleware)
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'You must be logged in to access this resource.'
      });
    }

    // Check if user has admin role
    if (req.user.role !== 'admin') {
      // Log unauthorized access attempt
      console.warn(
        `⚠️  Unauthorized admin access attempt by user ${req.user.id} (${req.user.email})`
      );

      return res.status(403).json({
        error: 'Admin access required',
        message: 'You do not have permission to access this resource. Admin privileges are required.'
      });
    }

    // Check if admin account is active
    if (req.user.status !== 'active') {
      return res.status(403).json({
        error: 'Account suspended',
        message: 'Your admin account has been suspended.'
      });
    }

    // Admin is authorized, proceed
    next();
  } catch (error) {
    console.error('Error in requireAdmin middleware:', error);
    res.status(500).json({ error: 'Failed to verify admin access' });
  }
};

/**
 * Middleware to prevent users from modifying their own admin status
 * Used on user modification endpoints
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const preventSelfModification = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.body.userId;

    if (targetUserId === req.user.id || targetUserId === req.user.userId) {
      return res.status(403).json({
        error: 'Cannot modify own account',
        message: 'You cannot modify your own user account through admin endpoints for security reasons.'
      });
    }

    next();
  } catch (error) {
    console.error('Error in preventSelfModification middleware:', error);
    res.status(500).json({ error: 'Failed to validate request' });
  }
};

/**
 * Middleware to log admin actions
 * Captures IP address and user agent for audit trail
 *
 * @param {string} action - The action being performed
 * @returns {Function} Express middleware function
 */
export const logAdminAction = (action) => {
  return (req, res, next) => {
    // Store action info for later logging
    req.adminAction = {
      action,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    };
    next();
  };
};
