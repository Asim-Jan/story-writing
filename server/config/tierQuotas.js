// Tier-based quota configuration
// Defines limits for free, basic, and premium tiers

export const TIER_QUOTAS = {
  free: {
    max_books: 3,
    max_words: 50000, // 50k words total across all books
    max_chapters: 30, // 30 chapters total across all books
    max_ai_requests_per_day: 10,
    max_concurrent_jobs: 1,
    max_storage_mb: 50, // 50 MB for media files
    features: {
      ai_generation: true,
      media_generation: false, // No images/audio/video
      export_epub: true,
      export_pdf: false,
      export_cbz: false,
      export_rpg: false,
      continuity_check: false,
      collaboration: false,
      version_history: false,
      priority_processing: false
    }
  },

  basic: {
    max_books: 10,
    max_words: 250000, // 250k words
    max_chapters: 100, // 100 chapters total
    max_ai_requests_per_day: 50,
    max_concurrent_jobs: 3,
    max_storage_mb: 500, // 500 MB
    features: {
      ai_generation: true,
      media_generation: true, // Images, audio, video allowed
      export_epub: true,
      export_pdf: true,
      export_cbz: true,
      export_rpg: true,
      continuity_check: true,
      collaboration: false, // Not yet in basic
      version_history: true,
      priority_processing: false
    }
  },

  premium: {
    max_books: 999999, // Unlimited
    max_words: 999999999, // Unlimited
    max_chapters: 999999, // Unlimited
    max_ai_requests_per_day: 200,
    max_concurrent_jobs: 10,
    max_storage_mb: 5000, // 5 GB
    features: {
      ai_generation: true,
      media_generation: true,
      export_epub: true,
      export_pdf: true,
      export_cbz: true,
      export_rpg: true,
      continuity_check: true,
      collaboration: true, // Future feature
      version_history: true,
      priority_processing: true
    }
  }
};

/**
 * Get quota configuration for a specific tier
 * @param {string} tier - User tier (free, basic, premium)
 * @returns {object} Quota configuration
 */
export function getTierQuotas(tier) {
  const normalizedTier = (tier || 'free').toLowerCase();
  return TIER_QUOTAS[normalizedTier] || TIER_QUOTAS.free;
}

/**
 * Check if a feature is available for a specific tier
 * @param {string} tier - User tier
 * @param {string} feature - Feature name
 * @returns {boolean} True if feature is available
 */
export function hasFeature(tier, feature) {
  if (unlockedFeatures().includes(feature)) return true;
  const quotas = getTierQuotas(tier);
  return quotas.features[feature] === true;
}

/**
 * Features every user gets regardless of plan, while the paywall is off.
 * FEATURE_UNLOCK_TIER=basic unlocks the basic plan's features for everyone;
 * quotas (books, words, AI requests per day) still follow the user's real tier.
 * Unset (the default) means no unlock.
 * @returns {string[]} Unlocked feature names
 */
export function unlockedFeatures() {
  const unlockTier = (process.env.FEATURE_UNLOCK_TIER || '').trim().toLowerCase();
  if (!Object.hasOwn(TIER_QUOTAS, unlockTier)) return [];
  return Object.keys(TIER_QUOTAS[unlockTier].features)
    .filter((feature) => TIER_QUOTAS[unlockTier].features[feature] === true);
}

/**
 * Get user-friendly tier limits for display
 * @param {string} tier - User tier
 * @returns {object} Human-readable limits
 */
export function getTierLimitsDisplay(tier) {
  const quotas = getTierQuotas(tier);

  return {
    books: quotas.max_books >= 999999 ? 'Unlimited' : quotas.max_books,
    words: quotas.max_words >= 999999 ? 'Unlimited' : `${(quotas.max_words / 1000).toFixed(0)}k`,
    chapters: quotas.max_chapters >= 999999 ? 'Unlimited' : quotas.max_chapters,
    aiRequests: `${quotas.max_ai_requests_per_day}/day`,
    concurrentJobs: quotas.max_concurrent_jobs,
    storage: quotas.max_storage_mb >= 1000 ? `${(quotas.max_storage_mb / 1000).toFixed(1)}GB` : `${quotas.max_storage_mb}MB`
  };
}
