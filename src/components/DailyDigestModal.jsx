import { X, TrendingUp, AlertCircle } from 'lucide-react';

const DailyDigestModal = ({ quotas, onClose, onNavigateToProfile }) => {
  if (!quotas) return null;

  const { limits, usage, tier } = quotas;

  const getQuotaPercentage = (current, max) => {
    if (!max || max === 0) return 0;
    return Math.round((current / max) * 100);
  };

  const getQuotaColor = (percentage) => {
    if (percentage >= 100) return 'text-red-600';
    if (percentage >= 90) return 'text-orange-600';
    if (percentage >= 80) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getProgressColor = (percentage) => {
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 90) return 'bg-orange-500';
    if (percentage >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  const quotaItems = [
    { label: 'Books', current: usage.current_books, max: limits.max_books },
    { label: 'Words', current: usage.current_words, max: limits.max_words },
    { label: 'Chapters', current: usage.current_chapters, max: limits.max_chapters },
    { label: 'AI Requests Today', current: usage.ai_requests_today, max: limits.max_ai_requests_per_day }
  ];

  // Filter to show only items above 80%
  const highUsageItems = quotaItems.filter(item => getQuotaPercentage(item.current, item.max) >= 80);

  const handleDontShowAgain = () => {
    const today = new Date().toDateString();
    localStorage.setItem('last_digest_shown', today);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-full p-2"
          >
            <X size={24} />
          </button>
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp size={32} />
            <h2 className="text-2xl font-bold">Daily Usage Summary</h2>
          </div>
          <p className="text-purple-100">
            Here's an overview of your quota usage for today
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Tier Badge */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-800 px-4 py-2 rounded-full font-semibold">
              <span className="text-sm">Current Plan:</span>
              <span className="text-lg capitalize">{tier || 'Free'}</span>
            </div>
          </div>

          {/* High Usage Alert */}
          {highUsageItems.length > 0 && (
            <div className="mb-6 bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="font-semibold text-amber-900 mb-1">Action Recommended</h3>
                  <p className="text-sm text-amber-800">
                    {highUsageItems.length === 1 ? 'One quota is' : `${highUsageItems.length} quotas are`} approaching their limit.
                    Consider upgrading your plan to avoid interruptions.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Quota Summary */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Usage Overview</h3>

            {quotaItems.map((item, index) => {
              const percentage = getQuotaPercentage(item.current, item.max);
              const isHigh = percentage >= 80;

              return (
                <div
                  key={index}
                  className={`p-4 rounded-lg border-2 ${isHigh ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-700">{item.label}</span>
                    <span className={`text-lg font-bold ${getQuotaColor(percentage)}`}>
                      {formatNumber(item.current)} / {formatNumber(item.max)}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-gray-200 rounded-full h-3 mb-1">
                    <div
                      className={`h-3 rounded-full transition-all ${getProgressColor(percentage)}`}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className={`font-semibold ${getQuotaColor(percentage)}`}>
                      {percentage}% used
                    </span>
                    {isHigh && (
                      <span className="text-yellow-700 font-medium">
                        {percentage >= 100 ? 'Limit reached!' : 'Nearly full'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                onNavigateToProfile && onNavigateToProfile();
                onClose();
              }}
              className="flex-1 bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 transition-colors"
            >
              View Full Details
            </button>
            <button
              onClick={handleDontShowAgain}
              className="flex-1 bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Don't Show Again Today
            </button>
          </div>

          {/* Upgrade CTA for Free/Basic users */}
          {tier !== 'premium' && highUsageItems.length > 0 && (
            <div className="mt-6 p-4 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg border border-purple-200">
              <h4 className="font-semibold text-purple-900 mb-2">Need More?</h4>
              <p className="text-sm text-purple-800 mb-3">
                Upgrade to {tier === 'basic' ? 'Premium' : 'Basic or Premium'} for higher limits and exclusive features.
              </p>
              <button
                onClick={() => {
                  onNavigateToProfile && onNavigateToProfile();
                  onClose();
                }}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 transition-colors"
              >
                Explore Plans
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DailyDigestModal;
