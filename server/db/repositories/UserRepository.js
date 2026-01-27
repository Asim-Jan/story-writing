import { query, transaction } from '../postgres.js';

export class UserRepository {
  /**
   * Create a new user
   * @param {object} userData - User data (email, name, password_hash, tier)
   * @returns {Promise<object>} Created user
   */
  static async create(userData) {
    const { email, name, password_hash, tier = 'free' } = userData;

    const result = await query(
      `INSERT INTO users (email, name, password_hash, tier)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email, name, password_hash, tier]
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
    const result = await query(
      'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );
    return result.rowCount > 0;
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
}

export default UserRepository;
