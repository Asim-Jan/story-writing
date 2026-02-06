import { useState, useEffect } from 'react';

const THRESHOLDS = [80, 90, 95, 100];
const WARNING_STORAGE_KEY = 'quota_warnings_shown';

/**
 * Custom hook to monitor quota usage and trigger warnings at specific thresholds
 * Uses localStorage to prevent duplicate warnings within 24 hours
 * @param {Object} quotas - Quota data from API { limits, usage }
 * @returns {Object} - { warnings: Array, markWarningShown: Function }
 */
export const useQuotaWarnings = (quotas) => {
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    if (!quotas || !quotas.limits || !quotas.usage) return;

    const checkQuotas = () => {
      const newWarnings = [];
      const warningsShown = getWarningsShown();
      const now = Date.now();

      // Check each quota type
      const quotaTypes = [
        { type: 'books', current: quotas.usage.current_books, max: quotas.limits.max_books, label: 'Books' },
        { type: 'words', current: quotas.usage.current_words, max: quotas.limits.max_words, label: 'Words' },
        { type: 'chapters', current: quotas.usage.current_chapters, max: quotas.limits.max_chapters, label: 'Chapters' },
        { type: 'ai_requests', current: quotas.usage.ai_requests_today, max: quotas.limits.max_ai_requests_per_day, label: 'AI Requests' }
      ];

      quotaTypes.forEach(({ type, current, max, label }) => {
        if (!max || max === 0) return;

        const percentage = Math.round((current / max) * 100);

        // Check each threshold
        THRESHOLDS.forEach(threshold => {
          if (percentage >= threshold) {
            const warningKey = `${type}_${threshold}`;
            const lastShown = warningsShown[warningKey];

            // Show warning if never shown or shown more than 24 hours ago
            if (!lastShown || now - lastShown > 24 * 60 * 60 * 1000) {
              newWarnings.push({
                id: warningKey,
                type,
                quota: label,
                current,
                max,
                percentage,
                threshold
              });
            }
          }
        });
      });

      // Show only the most severe warning per quota type
      const uniqueWarnings = {};
      newWarnings.forEach(warning => {
        if (!uniqueWarnings[warning.type] || warning.threshold > uniqueWarnings[warning.type].threshold) {
          uniqueWarnings[warning.type] = warning;
        }
      });

      setWarnings(Object.values(uniqueWarnings));
    };

    checkQuotas();
  }, [quotas]);

  const markWarningShown = (warningId) => {
    const warningsShown = getWarningsShown();
    warningsShown[warningId] = Date.now();
    localStorage.setItem(WARNING_STORAGE_KEY, JSON.stringify(warningsShown));
  };

  return { warnings, markWarningShown };
};

/**
 * Get warnings that have been shown from localStorage
 * Automatically cleans up warnings older than 30 days
 */
const getWarningsShown = () => {
  try {
    const stored = localStorage.getItem(WARNING_STORAGE_KEY);
    if (!stored) return {};

    const warnings = JSON.parse(stored);
    const now = Date.now();
    const cleaned = {};

    // Keep only warnings from last 30 days
    Object.entries(warnings).forEach(([key, timestamp]) => {
      if (now - timestamp < 30 * 24 * 60 * 60 * 1000) {
        cleaned[key] = timestamp;
      }
    });

    // Save cleaned version
    if (Object.keys(cleaned).length !== Object.keys(warnings).length) {
      localStorage.setItem(WARNING_STORAGE_KEY, JSON.stringify(cleaned));
    }

    return cleaned;
  } catch (error) {
    console.error('Error reading quota warnings from localStorage:', error);
    return {};
  }
};

/**
 * Check if user should see daily digest
 * Shows digest once per day if any quota is above 80%
 */
export const shouldShowDailyDigest = (quotas) => {
  if (!quotas || !quotas.limits || !quotas.usage) return false;

  try {
    const lastShown = localStorage.getItem('last_digest_shown');
    const today = new Date().toDateString();

    // Already shown today
    if (lastShown === today) return false;

    // Check if any quota is above 80%
    const quotaTypes = [
      { current: quotas.usage.current_books, max: quotas.limits.max_books },
      { current: quotas.usage.current_words, max: quotas.limits.max_words },
      { current: quotas.usage.current_chapters, max: quotas.limits.max_chapters },
      { current: quotas.usage.ai_requests_today, max: quotas.limits.max_ai_requests_per_day }
    ];

    const hasHighUsage = quotaTypes.some(({ current, max }) => {
      if (!max || max === 0) return false;
      return (current / max) >= 0.8;
    });

    return hasHighUsage;
  } catch (error) {
    console.error('Error checking daily digest:', error);
    return false;
  }
};

/**
 * Mark daily digest as shown for today
 */
export const markDailyDigestShown = () => {
  const today = new Date().toDateString();
  localStorage.setItem('last_digest_shown', today);
};
