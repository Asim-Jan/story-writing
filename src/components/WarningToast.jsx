import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const WarningToast = ({ warning, onDismiss, onNavigate }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (warning) {
      setIsVisible(true);
      setProgress(100);

      // Auto-dismiss after 8 seconds
      const dismissTimer = setTimeout(() => {
        handleDismiss();
      }, 8000);

      // Progress bar animation
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev <= 0) {
            clearInterval(progressInterval);
            return 0;
          }
          return prev - (100 / 80); // 8000ms / 100ms intervals
        });
      }, 100);

      return () => {
        clearTimeout(dismissTimer);
        clearInterval(progressInterval);
      };
    }
  }, [warning]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      onDismiss();
    }, 300); // Wait for fade-out animation
  };

  const handleClick = () => {
    if (onNavigate) {
      onNavigate();
    }
    handleDismiss();
  };

  if (!warning) return null;

  const { type, quota, current, max, percentage } = warning;

  const getColorClasses = () => {
    if (percentage >= 100) {
      return {
        bg: 'bg-red-50',
        border: 'border-red-300',
        text: 'text-red-800',
        icon: 'text-red-500',
        button: 'text-red-500 hover:text-red-700',
        progress: 'bg-red-500'
      };
    } else if (percentage >= 95) {
      return {
        bg: 'bg-orange-50',
        border: 'border-orange-300',
        text: 'text-orange-800',
        icon: 'text-orange-500',
        button: 'text-orange-500 hover:text-orange-700',
        progress: 'bg-orange-500'
      };
    } else if (percentage >= 90) {
      return {
        bg: 'bg-yellow-50',
        border: 'border-yellow-300',
        text: 'text-yellow-800',
        icon: 'text-yellow-500',
        button: 'text-yellow-500 hover:text-yellow-700',
        progress: 'bg-yellow-500'
      };
    }
    return {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      icon: 'text-amber-500',
      button: 'text-amber-500 hover:text-amber-700',
      progress: 'bg-amber-500'
    };
  };

  const colors = getColorClasses();

  const getTitle = () => {
    if (percentage >= 100) return `${quota} Quota Exceeded!`;
    if (percentage >= 95) return `${quota} Quota Almost Full`;
    if (percentage >= 90) return `${quota} Quota Warning`;
    return `${quota} Quota Notice`;
  };

  const getMessage = () => {
    if (percentage >= 100) {
      return `You've reached your limit of ${max} ${quota.toLowerCase()}. Upgrade your plan to continue.`;
    }
    return `You're at ${percentage}% of your ${quota.toLowerCase()} quota (${current}/${max}). Consider upgrading to avoid interruptions.`;
  };

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
      style={{ maxWidth: '400px' }}
    >
      <div
        className={`${colors.bg} border-2 ${colors.border} rounded-lg shadow-lg overflow-hidden cursor-pointer`}
        onClick={handleClick}
      >
        {/* Progress bar */}
        <div className="h-1 bg-gray-200">
          <div
            className={`h-full ${colors.progress} transition-all duration-100 ease-linear`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className={`${colors.icon} flex-shrink-0 mt-0.5`} size={20} />

            <div className="flex-1 min-w-0">
              <h4 className={`font-semibold ${colors.text} mb-1`}>
                {getTitle()}
              </h4>
              <p className={`text-sm ${colors.text}`}>
                {getMessage()}
              </p>
              {onNavigate && (
                <button
                  className={`text-sm font-medium ${colors.button} underline mt-2`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClick();
                  }}
                >
                  View Details
                </button>
              )}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDismiss();
              }}
              className={`${colors.button} flex-shrink-0`}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WarningToast;
