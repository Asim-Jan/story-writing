import { useState } from 'react';
import { Mail, AlertCircle, CheckCircle, X } from 'lucide-react';

// ORDNANCE: a system notice is a hairline-ruled strip on the ground —
// small-caps label, ink text, one primary action. Not a tonal amber block.
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
    <div className="bg-[var(--bg2)] border-b border-[var(--line)] px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div className="flex items-start gap-3 flex-1">
          <AlertCircle className="w-4 h-4 text-[var(--warn)] flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="lbl text-[var(--ink)]">
              Verify your email address
            </p>
            <p className="text-xs text-[var(--dim)] mt-0.5">
              Please check your inbox and click the verification link to unlock all features.
            </p>
            {message && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${
                message.type === 'success' ? 'text-[var(--ok)]' : 'text-[var(--red)]'
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
            className="btn sm flex-1 sm:flex-initial"
          >
            <Mail className="w-4 h-4" />
            {isResending ? 'Sending…' : 'Resend Email'}
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="p-1.5 text-[var(--dim)] hover:text-[var(--ink)] transition-colors"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationBanner;
