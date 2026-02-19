import { useState } from 'react';
import { Mail, AlertCircle, CheckCircle, X } from 'lucide-react';

const EmailVerificationBanner = ({ user, onResendEmail }) => {
  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState('');
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't show if verified or dismissed
  if (user?.emailVerified || isDismissed) return null;

  const handleResend = async () => {
    setIsResending(true);
    setMessage('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Verification email sent!' });
        if (onResendEmail) onResendEmail();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to send email' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to send verification email' });
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div className="flex items-start gap-3 flex-1">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Verify your email address
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Please check your inbox and click the verification link to unlock all features.
            </p>
            {message && (
              <div className={`mt-2 flex items-center gap-1 text-xs ${
                message.type === 'success' ? 'text-green-700' : 'text-red-700'
              }`}>
                {message.type === 'success' ? (
                  <CheckCircle className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                <span>{message.text}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          <button
            onClick={handleResend}
            disabled={isResending}
            className="flex-1 sm:flex-initial px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium"
          >
            <Mail className="w-4 h-4" />
            {isResending ? 'Sending...' : 'Resend Email'}
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="p-2 text-amber-600 hover:text-amber-800 transition-colors"
            title="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationBanner;
