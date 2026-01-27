import { query } from '../postgres.js';

export class JobRepository {
  /**
   * Create a new job
   * @param {object} jobData - Job data
   * @returns {Promise<object>} Created job
   */
  static async create(jobData) {
    const {
      user_id,
      book_id = null,
      job_type,
      status = 'pending',
      input_data = {},
      metadata = {}
    } = jobData;

    const result = await query(
      `INSERT INTO jobs (user_id, book_id, job_type, status, input_data, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, book_id, job_type, status, JSON.stringify(input_data), JSON.stringify(metadata)]
    );

    return result.rows[0];
  }

  /**
   * Find job by ID
   * @param {string} jobId - Job UUID
   * @returns {Promise<object|null>} Job or null
   */
  static async findById(jobId) {
    const result = await query(
      'SELECT * FROM jobs WHERE id = $1',
      [jobId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find all jobs for a user
   * @param {string} userId - User UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Jobs
   */
  static async findByUser(userId, options = {}) {
    const { limit = 50, offset = 0, status = null, job_type = null } = options;

    let whereClause = 'WHERE user_id = $1';
    const params = [userId];
    let paramCount = 2;

    if (status) {
      whereClause += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (job_type) {
      whereClause += ` AND job_type = $${paramCount}`;
      params.push(job_type);
      paramCount++;
    }

    params.push(limit, offset);

    const result = await query(
      `SELECT * FROM jobs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      params
    );

    return result.rows;
  }

  /**
   * Find all jobs for a book
   * @param {string} bookId - Book UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Jobs
   */
  static async findByBook(bookId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    const result = await query(
      `SELECT * FROM jobs
       WHERE book_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [bookId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Update job status and progress
   * @param {string} jobId - Job UUID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated job
   */
  static async update(jobId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['status', 'progress', 'result_data', 'error_message'];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        if (key === 'result_data' && updates[key]) {
          fields.push(`${key} = $${paramCount}`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = $${paramCount}`);
          values.push(updates[key]);
        }
        paramCount++;
      }
    });

    // Auto-set timestamps based on status
    if (updates.status === 'processing' && !fields.includes('started_at')) {
      fields.push(`started_at = NOW()`);
    }

    if (['completed', 'failed', 'cancelled'].includes(updates.status) && !fields.includes('completed_at')) {
      fields.push(`completed_at = NOW()`);
    }

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(jobId);

    const result = await query(
      `UPDATE jobs SET ${fields.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      throw new Error('Job not found');
    }

    return result.rows[0];
  }

  /**
   * Start job (set status to processing)
   * @param {string} jobId - Job UUID
   * @returns {Promise<object>} Updated job
   */
  static async start(jobId) {
    const result = await query(
      `UPDATE jobs
       SET status = 'processing', started_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [jobId]
    );

    if (result.rowCount === 0) {
      throw new Error('Job not found or already started');
    }

    return result.rows[0];
  }

  /**
   * Complete job successfully
   * @param {string} jobId - Job UUID
   * @param {object} resultData - Result data
   * @returns {Promise<object>} Updated job
   */
  static async complete(jobId, resultData = {}) {
    const result = await query(
      `UPDATE jobs
       SET status = 'completed', progress = 100, result_data = $1, completed_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(resultData), jobId]
    );

    if (result.rowCount === 0) {
      throw new Error('Job not found');
    }

    return result.rows[0];
  }

  /**
   * Fail job with error
   * @param {string} jobId - Job UUID
   * @param {string} errorMessage - Error message
   * @returns {Promise<object>} Updated job
   */
  static async fail(jobId, errorMessage) {
    const result = await query(
      `UPDATE jobs
       SET status = 'failed', error_message = $1, completed_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [errorMessage, jobId]
    );

    if (result.rowCount === 0) {
      throw new Error('Job not found');
    }

    return result.rows[0];
  }

  /**
   * Cancel job
   * @param {string} jobId - Job UUID
   * @returns {Promise<object>} Updated job
   */
  static async cancel(jobId) {
    const result = await query(
      `UPDATE jobs
       SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'processing')
       RETURNING *`,
      [jobId]
    );

    if (result.rowCount === 0) {
      throw new Error('Job not found or already completed');
    }

    return result.rows[0];
  }

  /**
   * Get pending jobs for a user (respecting concurrency limits)
   * @param {string} userId - User UUID
   * @param {number} limit - Max concurrent jobs
   * @returns {Promise<Array>} Pending jobs that can be started
   */
  static async getPendingJobs(userId, limit = 1) {
    const result = await query(
      `SELECT * FROM jobs
       WHERE user_id = $1
       AND status = 'pending'
       AND (
         SELECT COUNT(*) FROM jobs
         WHERE user_id = $1 AND status = 'processing'
       ) < $2
       ORDER BY created_at ASC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows;
  }

  /**
   * Get running job count for user
   * @param {string} userId - User UUID
   * @returns {Promise<number>} Count of running jobs
   */
  static async getRunningCount(userId) {
    const result = await query(
      `SELECT COUNT(*) as count FROM jobs
       WHERE user_id = $1 AND status = 'processing'`,
      [userId]
    );

    return parseInt(result.rows[0].count);
  }

  /**
   * Clean up old completed jobs (older than 30 days)
   * @returns {Promise<number>} Number of jobs deleted
   */
  static async cleanupOldJobs() {
    const result = await query(
      `DELETE FROM jobs
       WHERE status IN ('completed', 'failed', 'cancelled')
       AND completed_at < NOW() - INTERVAL '30 days'`
    );

    return result.rowCount;
  }

  /**
   * Get job statistics for a user
   * @param {string} userId - User UUID
   * @returns {Promise<object>} Job statistics
   */
  static async getStats(userId) {
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) as total
       FROM jobs
       WHERE user_id = $1`,
      [userId]
    );

    return result.rows[0];
  }
}

export default JobRepository;
