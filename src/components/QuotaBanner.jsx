import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react';

const QuotaBanner = ({ onNavigateToProfile }) => {
  const [quotas, setQuotas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const API_URL = import.meta.env.VITE_API_URL;

  const fetchQuotas = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/users/quotas`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setQuotas(data);
        setError(null);
      } else {
        setError('Failed to load quotas');
      }
    } catch (err) {
      console.error('Error fetching quotas:', err);
      setError('Failed to load quotas');
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchQuotas();

    // Refresh every 30 seconds
    const interval = setInterval(fetchQuotas, 30000);

    // Listen for custom event to refresh quotas after save
    const handleQuotaRefresh = () => {
      fetchQuotas();
    };
    window.addEventListener('quotaRefresh', handleQuotaRefresh);

    return () => {
      clearInterval(interval);
      window.removeEventListener('quotaRefresh', handleQuotaRefresh);
    };
  }, [fetchQuotas]);

  const getQuotaColor = (current, max) => {
    if (!max) return 'text-gray-400';
    const percentage = (current / max) * 100;
    if (percentage < 80) return 'text-green-600';
    if (percentage < 100) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getQuotaBackground = (current, max) => {
    if (!max) return 'bg-gray-100';
    const percentage = (current / max) * 100;
    if (percentage < 80) return 'bg-green-50 border-green-200';
    if (percentage < 100) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  const getProgressColor = (current, max) => {
    if (!max) return 'bg-gray-300';
    const percentage = (current / max) * 100;
    if (percentage < 80) return 'bg-green-500';
    if (percentage < 100) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  if (loading || !quotas || isMinimized) return null;

  if (error) {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500" />
          <span className="text-red-700">{error}</span>
        </div>
        <button
          onClick={() => setIsMinimized(true)}
          className="text-red-500 hover:text-red-700"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const { limits, usage } = quotas;

  if (isCollapsed) {
    // Mobile collapsed view
    return (
      <div className={`border-b ${getQuotaBackground(usage.current_books, limits.max_books)} px-4 py-2`}>
        <button
          onClick={() => setIsCollapsed(false)}
          className="w-full flex items-center justify-between text-sm font-medium"
        >
          <span className={getQuotaColor(usage.current_books, limits.max_books)}>
            Usage: {usage.current_books}/{limits.max_books} books
          </span>
          <ChevronDown size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className={`border-b ${getQuotaBackground(usage.current_books, limits.max_books)} px-4 py-3`}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">
            Your Usage
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateToProfile && onNavigateToProfile()}
              className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
            >
              View Details
            </button>
            <button
              onClick={() => setIsCollapsed(true)}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={() => setIsMinimized(true)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Quota Cards - Grid Layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Books */}
          <div className="bg-white rounded-lg p-3 shadow-sm border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">Books</span>
              <span className={`text-sm font-bold ${getQuotaColor(usage.current_books, limits.max_books)}`}>
                {usage.current_books}/{formatNumber(limits.max_books)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getProgressColor(usage.current_books, limits.max_books)}`}
                style={{ width: `${Math.min((usage.current_books / limits.max_books) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Words */}
          <div className="bg-white rounded-lg p-3 shadow-sm border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">Words</span>
              <span className={`text-sm font-bold ${getQuotaColor(usage.current_words, limits.max_words)}`}>
                {formatNumber(usage.current_words)}/{formatNumber(limits.max_words)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getProgressColor(usage.current_words, limits.max_words)}`}
                style={{ width: `${Math.min((usage.current_words / limits.max_words) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Chapters */}
          <div className="bg-white rounded-lg p-3 shadow-sm border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">Chapters</span>
              <span className={`text-sm font-bold ${getQuotaColor(usage.current_chapters, limits.max_chapters)}`}>
                {usage.current_chapters}/{formatNumber(limits.max_chapters)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getProgressColor(usage.current_chapters, limits.max_chapters)}`}
                style={{ width: `${Math.min((usage.current_chapters / limits.max_chapters) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* AI Requests */}
          <div className="bg-white rounded-lg p-3 shadow-sm border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">AI Requests Today</span>
              <span className={`text-sm font-bold ${getQuotaColor(usage.ai_requests_today, limits.max_ai_requests_per_day)}`}>
                {usage.ai_requests_today}/{limits.max_ai_requests_per_day}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getProgressColor(usage.ai_requests_today, limits.max_ai_requests_per_day)}`}
                style={{ width: `${Math.min((usage.ai_requests_today / limits.max_ai_requests_per_day) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuotaBanner;
