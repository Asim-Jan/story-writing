import { getTierQuotas, hasFeature } from '../config/tierQuotas.js';
import pool from '../db/postgres.js';

/**
 * Get user's current quota usage and limits
 * @param {string} userId - User ID
 * @returns {Promise<object>} Quota data with limits and current usage
 */
export async function getUserQuotas(userId) {
  const result = await pool.query(
    `SELECT q.*, u.tier
     FROM quotas q
     JOIN users u ON u.id = q.user_id
     WHERE q.user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User quotas not found');
  }

  let data = result.rows[0];
  const tierLimits = getTierQuotas(data.tier);

  // Reset daily counter if it's a new day
  const lastReset = new Date(data.last_ai_reset);
  const now = new Date();
  const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    // Reset counter in database
    await pool.query(
      `UPDATE quotas
       SET ai_requests_today = 0, last_ai_reset = NOW()
       WHERE user_id = $1`,
      [userId]
    );
    // Update local data to reflect reset
    data.ai_requests_today = 0;
    data.last_ai_reset = now;
  }

  return {
    tier: data.tier,
    limits: {
      max_books: data.max_books,
      max_words: data.max_words,
      max_chapters: data.max_chapters,
      max_ai_requests_per_day: data.max_ai_requests_per_day,
      max_concurrent_jobs: data.max_concurrent_jobs,
      custom_quotas: data.custom_quotas || false
    },
    usage: {
      current_books: data.current_books,
      current_words: data.current_words,
      current_chapters: data.current_chapters,
      ai_requests_today: data.ai_requests_today,
      last_ai_reset: data.last_ai_reset
    },
    features: tierLimits.features
  };
}

/**
 * Check if user can create a new book
 * Middleware function
 */
export const checkBookQuota = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId);

    if (quotas.usage.current_books >= quotas.limits.max_books) {
      return res.status(403).json({
        error: 'Book limit reached',
        message: `Your ${quotas.tier} plan allows ${quotas.limits.max_books} books. Please upgrade or delete existing books.`,
        quotas: {
          limit: quotas.limits.max_books,
          current: quotas.usage.current_books
        }
      });
    }

    req.quotas = quotas;
    next();
  } catch (error) {
    console.error('Book quota check error:', error);
    res.status(500).json({ error: 'Failed to check quotas' });
  }
};

/**
 * Check if user can add more words
 * Middleware function
 */
export const checkWordQuota = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId);

    // Calculate word count from request body
    const newContent = req.body.content || req.body.chapters?.map(c => c.content).join(' ') || '';
    const wordCount = newContent.split(/\s+/).filter(w => w.length > 0).length;

    if (quotas.usage.current_words + wordCount > quotas.limits.max_words) {
      return res.status(403).json({
        error: 'Word limit reached',
        message: `Your ${quotas.tier} plan allows ${quotas.limits.max_words.toLocaleString()} words. Please upgrade to continue writing.`,
        quotas: {
          limit: quotas.limits.max_words,
          current: quotas.usage.current_words,
          attempted: wordCount
        }
      });
    }

    req.quotas = quotas;
    req.wordCount = wordCount;
    next();
  } catch (error) {
    console.error('Word quota check error:', error);
    res.status(500).json({ error: 'Failed to check quotas' });
  }
};

/**
 * Check if user can add more chapters
 * Middleware function
 */
export const checkChapterQuota = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId);

    // Check if adding chapters via array
    const chaptersToAdd = req.body.chapters?.length || 1;

    if (quotas.usage.current_chapters + chaptersToAdd > quotas.limits.max_chapters) {
      return res.status(403).json({
        error: 'Chapter limit reached',
        message: `Your ${quotas.tier} plan allows ${quotas.limits.max_chapters} chapters total. Please upgrade or remove chapters.`,
        quotas: {
          limit: quotas.limits.max_chapters,
          current: quotas.usage.current_chapters,
          attempted: chaptersToAdd
        }
      });
    }

    req.quotas = quotas;
    next();
  } catch (error) {
    console.error('Chapter quota check error:', error);
    res.status(500).json({ error: 'Failed to check quotas' });
  }
};

/**
 * Check AND RESERVE an AI request in one statement.
 *
 * The old pair (checkAIQuota reads, incrementAICounter writes after the work)
 * had a race (parallel requests all pass the check) and, worse, only
 * incremented on SOME routes — most AI routes counted nothing at all.
 *
 * consumeAIQuota: a single UPDATE ... WHERE usage < limit RETURNING reserves
 * the slot atomically. Routes that fail before doing AI work refund it with
 * refundAIQuota (res.on('finish') in the response hook below handles the
 * error paths without touching every handler).
 */
export const consumeAIQuota = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId); // handles daily reset

    const reserved = await pool.query(
      `UPDATE quotas
       SET ai_requests_today = ai_requests_today + 1, updated_at = NOW()
       WHERE user_id = $1 AND ai_requests_today < $2
       RETURNING ai_requests_today`,
      [userId, quotas.limits.max_ai_requests_per_day]
    );

    if (reserved.rowCount === 0) {
      const lastReset = new Date(quotas.usage.last_ai_reset);
      return res.status(429).json({
        error: 'Daily AI request limit reached',
        message: `Your ${quotas.tier} plan allows ${quotas.limits.max_ai_requests_per_day} AI requests per day. Please try again tomorrow or upgrade.`,
        quotas: {
          limit: quotas.limits.max_ai_requests_per_day,
          current: quotas.usage.ai_requests_today,
          reset_at: new Date(lastReset.getTime() + 24 * 60 * 60 * 1000).toISOString()
        }
      });
    }

    // Reserve taken. If the route errors out before producing anything (5xx)
    // or the client goes away, give the slot back — the user shouldn't pay
    // for a request that produced nothing. 2xx/4xx keep the slot (429-class
    // validation errors still consumed capacity).
    req.quotas = quotas;
    // 'close' fires for BOTH completed responses and client aborts; 'finish'
    // never fires on an abort, which made the refund branch dead. On an abort
    // statusCode is unset — treat that as a refund too.
    res.on('close', () => {
      const code = res.statusCode;
      const aborted = !res.writableEnded;
      if (aborted || code >= 500) {
        refundAIQuota(userId).catch(err =>
          console.error('AI quota refund failed:', err.message));
      }
    });
    next();
  } catch (error) {
    console.error('AI quota check error:', error);
    res.status(500).json({ error: 'Failed to check quotas' });
  }
};

// checkAIQuota stays exported for compatibility (read-only check, no reserve)
export const checkAIQuota = consumeAIQuota;

/**
 * Check if user can queue more jobs
 * Middleware function
 */
export const checkJobQuota = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId);

    // Count current running jobs
    const jobsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM jobs
       WHERE user_id = $1 AND status IN ('pending', 'processing')`,
      [userId]
    );

    const currentJobs = parseInt(jobsResult.rows[0].count);

    if (currentJobs >= quotas.limits.max_concurrent_jobs) {
      return res.status(429).json({
        error: 'Job queue limit reached',
        message: `Your ${quotas.tier} plan allows ${quotas.limits.max_concurrent_jobs} concurrent jobs. Please wait for current jobs to complete.`,
        quotas: {
          limit: quotas.limits.max_concurrent_jobs,
          current: currentJobs
        }
      });
    }

    req.quotas = quotas;
    next();
  } catch (error) {
    console.error('Job quota check error:', error);
    res.status(500).json({ error: 'Failed to check quotas' });
  }
};

/**
 * Check if user has access to a specific feature
 * @param {string} featureName - Feature to check
 * @returns {function} Middleware function
 */
export const requireFeature = (featureName) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.userId || req.user.id;
      const quotas = await getUserQuotas(userId);

      if (!hasFeature(quotas.tier, featureName)) {
        return res.status(403).json({
          error: 'Feature not available',
          message: `This feature requires a higher tier plan. Your current tier: ${quotas.tier}`,
          tier: quotas.tier,
          feature: featureName
        });
      }

      req.quotas = quotas;
      next();
    } catch (error) {
      console.error('Feature check error:', error);
      res.status(500).json({ error: 'Failed to check feature access' });
    }
  };
};

/**
 * Increment AI request counter
 * Call this after successful AI request
 */
export async function refundAIQuota(userId) {
  await pool.query(
    `UPDATE quotas
     SET ai_requests_today = GREATEST(ai_requests_today - 1, 0), updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

export async function incrementAICounter(userId) {
  await pool.query(
    `UPDATE quotas
     SET ai_requests_today = ai_requests_today + 1, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Update book/chapter/word counts
 * Call this after book create/update/delete
 */
export async function updateQuotaUsage(userId) {
  await pool.query(
    `UPDATE quotas q
     SET
       current_books = (SELECT COUNT(*) FROM books WHERE owner_id = $1 AND deleted_at IS NULL),
       current_chapters = (SELECT COUNT(*) FROM chapters c JOIN books b ON b.id = c.book_id WHERE b.owner_id = $1 AND b.deleted_at IS NULL),
       current_words = (
         SELECT COALESCE(SUM(array_length(string_to_array(c.content, ' '), 1)), 0)
         FROM chapters c
         JOIN books b ON b.id = c.book_id
         WHERE b.owner_id = $1 AND b.deleted_at IS NULL
       ),
       updated_at = NOW()
     WHERE q.user_id = $1`,
    [userId]
  );
}
