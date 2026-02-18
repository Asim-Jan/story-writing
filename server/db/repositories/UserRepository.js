import { query, transaction } from '../postgres.js';

export class UserRepository {
  /**
   * Create a new user
   * @param {object} userData - User data (email, name, password_hash, tier, email_verified, email_verification_token, email_verification_token_expires)
   * @returns {Promise<object>} Created user
   */
  static async create(userData) {
    const {
      email,
      name,
      password_hash,
      tier = 'free',
      email_verified = false,
      email_verification_token = null,
      email_verification_token_expires = null
    } = userData;

    const result = await query(
      `INSERT INTO users (email, name, password_hash, tier, email_verified, email_verification_token, email_verification_token_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [email, name, password_hash, tier, email_verified, email_verification_token, email_verification_token_expires]
    );

    const user = result.rows[0];

    // Initialize quota for the user
    await query(
      `INSERT INTO quotas (user_id, max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.id,
        tier === 'free' ? 3 : tier === 'basic' ? 10 : 999999,
        tier === 'free' ? 50000 : tier === 'basic' ? 200000 : 999999999,
        tier === 'free' ? 30 : tier === 'basic' ? 100 : 999999,
        tier === 'free' ? 10 : tier === 'basic' ? 50 : 200,
        tier === 'free' ? 1 : tier === 'basic' ? 3 : 10
      ]
    );

    // Initialize user settings
    await query(
      `INSERT INTO user_settings (user_id, ai_config, preferences)
       VALUES ($1, $2, $3)`,
      [user.id, {}, {}]
    );

    return user;
  }

  /**
   * Find user by ID
   * @param {string} userId - User UUID
   * @returns {Promise<object|null>} User or null
   */
  static async findById(userId) {
    const result = await query(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find user by email
   * @param {string} email - User email
   * @returns {Promise<object|null>} User or null
   */
  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    );
    return result.rows[0] || null;
  }

  /**
   * Update user
   * @param {string} userId - User UUID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated user
   */
  static async update(userId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic update query
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at' && key !== 'updated_at') {
        fields.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(userId);

    const result = await query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${paramCount} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      throw new Error('User not found or already deleted');
    }

    return result.rows[0];
  }

  /**
   * Soft delete user
   * @param {string} userId - User UUID
   * @returns {Promise<boolean>} Success
   */
  static async delete(userId) {
    // Anonymize email so it can be reused, then soft-delete
    const result = await query(
      `UPDATE users
       SET deleted_at = NOW(),
           email = 'deleted_' || id || '@deleted.invalid'
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    return result.rowCount > 0;
  }

  /**
   * Set email verification token
   * @param {string} userId - User UUID
   * @param {string} token - Verification token
   * @param {Date} expiresAt - Token expiration time
   * @returns {Promise<boolean>} Success
   */
  static async setVerificationToken(userId, token, expiresAt) {
    const result = await query(
      `UPDATE users
       SET email_verification_token = $1,
           email_verification_token_expires = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [token, expiresAt, userId]
    );
    return result.rowCount > 0;
  }

  /**
   * Verify email with token
   * @param {string} token - Verification token
   * @returns {Promise<object|null>} Verified user or null if invalid/expired
   */
  static async verifyEmail(token) {
    const result = await query(
      `UPDATE users
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_token_expires = NULL,
           updated_at = NOW()
       WHERE email_verification_token = $1
         AND email_verification_token_expires > NOW()
         AND email_verified = false
       RETURNING *`,
      [token]
    );
    return result.rows[0] || null;
  }

  /**
   * Find user by verification token
   * @param {string} token - Verification token
   * @returns {Promise<object|null>} User or null
   */
  static async findByVerificationToken(token) {
    const result = await query(
      `SELECT * FROM users
       WHERE email_verification_token = $1
         AND email_verification_token_expires > NOW()`,
      [token]
    );
    return result.rows[0] || null;
  }

  /**
   * Log email verification action
   * @param {object} logData - Log data (user_id, email, action, token, ip_address, user_agent)
   * @returns {Promise<void>}
   */
  static async logVerificationAction(logData) {
    const { user_id, email, action, token, ip_address, user_agent } = logData;
    await query(
      `INSERT INTO email_verification_log (user_id, email, action, token, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, email, action, token, ip_address, user_agent]
    );
  }

  /**
   * Get user with settings and quotas
   * @param {string} userId - User UUID
   * @returns {Promise<object|null>} User with settings and quotas
   */
  static async findByIdWithSettings(userId) {
    const result = await query(
      `SELECT
        u.*,
        us.ai_config,
        us.preferences,
        q.max_books,
        q.max_words,
        q.max_chapters,
        q.max_ai_requests_per_day,
        q.max_concurrent_jobs,
        q.current_books,
        q.current_words,
        q.current_chapters,
        q.ai_requests_today
       FROM users u
       LEFT JOIN user_settings us ON u.id = us.user_id
       LEFT JOIN quotas q ON u.id = q.user_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update user settings
   * @param {string} userId - User UUID
   * @param {object} settings - Settings to update (ai_config and/or preferences)
   * @returns {Promise<object>} Updated settings
   */
  static async updateSettings(userId, settings) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (settings.ai_config !== undefined) {
      fields.push(`ai_config = $${paramCount}`);
      values.push(JSON.stringify(settings.ai_config));
      paramCount++;
    }

    if (settings.preferences !== undefined) {
      fields.push(`preferences = $${paramCount}`);
      values.push(JSON.stringify(settings.preferences));
      paramCount++;
    }

    if (fields.length === 0) {
      throw new Error('No settings to update');
    }

    values.push(userId);

    const result = await query(
      `UPDATE user_settings SET ${fields.join(', ')}
       WHERE user_id = $${paramCount}
       RETURNING *`,
      values
    );

    return result.rows[0];
  }

  /**
   * Get user quota
   * @param {string} userId - User UUID
   * @returns {Promise<object|null>} Quota information
   */
  static async getQuota(userId) {
    const result = await query(
      'SELECT * FROM quotas WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update quota usage
   * @param {string} userId - User UUID
   * @param {object} usage - Usage updates
   * @returns {Promise<object>} Updated quota
   */
  static async updateQuotaUsage(userId, usage) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (usage.current_books !== undefined) {
      fields.push(`current_books = $${paramCount}`);
      values.push(usage.current_books);
      paramCount++;
    }

    if (usage.current_words !== undefined) {
      fields.push(`current_words = $${paramCount}`);
      values.push(usage.current_words);
      paramCount++;
    }

    if (usage.current_chapters !== undefined) {
      fields.push(`current_chapters = $${paramCount}`);
      values.push(usage.current_chapters);
      paramCount++;
    }

    if (usage.ai_requests_today !== undefined) {
      fields.push(`ai_requests_today = $${paramCount}`);
      values.push(usage.ai_requests_today);
      paramCount++;
    }

    if (fields.length === 0) {
      throw new Error('No usage fields to update');
    }

    values.push(userId);

    const result = await query(
      `UPDATE quotas SET ${fields.join(', ')}
       WHERE user_id = $${paramCount}
       RETURNING *`,
      values
    );

    return result.rows[0];
  }

  /**
   * Reset daily AI request counter (called by scheduler)
   * @returns {Promise<number>} Number of users reset
   */
  static async resetDailyAIRequests() {
    const result = await query(
      `UPDATE quotas
       SET ai_requests_today = 0, last_ai_reset = NOW()
       WHERE last_ai_reset < NOW() - INTERVAL '1 day'`
    );
    return result.rowCount;
  }

  // ============ ADMIN METHODS ============

  /**
   * Find all users with pagination and filters (admin only)
   * @param {object} options - Query options (limit, offset, tier, status, search)
   * @returns {Promise<{users: Array, total: number}>} Users and total count
   */
  static async findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      tier = null,
      status = null,
      search = null
    } = options;

    const conditions = ['deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (tier) {
      conditions.push(`tier = $${paramCount}`);
      params.push(tier);
      paramCount++;
    }

    if (status) {
      conditions.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    if (search) {
      conditions.push(`(email ILIKE $${paramCount} OR name ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM users WHERE ${conditions.join(' AND ')}`,
      params
    );

    // Get paginated users with quota info
    const usersResult = await query(
      `SELECT
        u.*,
        q.current_books,
        q.current_words,
        q.current_chapters,
        q.ai_requests_today,
        q.max_books,
        q.max_words,
        q.max_chapters,
        q.max_ai_requests_per_day,
        (SELECT COUNT(*) FROM books WHERE owner_id = u.id AND deleted_at IS NULL) as book_count
       FROM users u
       LEFT JOIN quotas q ON u.id = q.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, limit, offset]
    );

    return {
      users: usersResult.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }

  /**
   * Update user tier and quotas (admin only)
   * @param {string} userId - User UUID
   * @param {string} newTier - New tier (free, basic, premium)
   * @param {string} adminId - Admin user ID performing the action
   * @returns {Promise<object>} Updated user
   */
  static async updateTier(userId, newTier, adminId) {
    const result = await query(
      'SELECT update_user_tier($1, $2, $3)',
      [userId, newTier, adminId]
    );

    // Return updated user
    return await this.findByIdWithSettings(userId);
  }

  /**
   * Update user status (admin only)
   * @param {string} userId - User UUID
   * @param {string} status - New status (active, suspended, banned)
   * @param {string} adminId - Admin user ID
   * @param {string} reason - Reason for status change
   * @returns {Promise<object>} Updated user
   */
  static async updateStatus(userId, status, adminId, reason = null) {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const result = await query(
      `UPDATE users SET status = $1 WHERE id = $2 RETURNING *`,
      [status, userId]
    );

    // Log the action
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, changes)
       VALUES ($1, $2, $3, $4)`,
      [
        adminId,
        'status_change',
        userId,
        JSON.stringify({ old_status: user.status || 'active', new_status: status, reason })
      ]
    );

    return result.rows[0];
  }

  /**
   * Get system statistics for admin dashboard
   * @returns {Promise<object>} System stats
   */
  static async getSystemStats() {
    const result = await query('SELECT * FROM system_stats');
    return result.rows[0];
  }

  /**
   * Get audit log entries (admin only)
   * @param {object} options - Query options (limit, offset, adminId, targetUserId)
   * @returns {Promise<{logs: Array, total: number}>} Audit logs
   */
  static async getAuditLog(options = {}) {
    const {
      limit = 100,
      offset = 0,
      adminId = null,
      targetUserId = null
    } = options;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (adminId) {
      conditions.push(`admin_id = $${paramCount}`);
      params.push(adminId);
      paramCount++;
    }

    if (targetUserId) {
      conditions.push(`target_user_id = $${paramCount}`);
      params.push(targetUserId);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM admin_audit_log ${whereClause}`,
      params
    );

    // Get logs with user details
    const logsResult = await query(
      `SELECT
        al.*,
        au.name as admin_name,
        au.email as admin_email,
        tu.name as target_user_name,
        tu.email as target_user_email
       FROM admin_audit_log al
       LEFT JOIN users au ON al.admin_id = au.id
       LEFT JOIN users tu ON al.target_user_id = tu.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, limit, offset]
    );

    return {
      logs: logsResult.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }
}

export default UserRepository;
