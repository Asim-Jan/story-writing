import { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, Loader, Mail, ArrowRight } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const EmailVerificationPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // 'verifying', 'success', 'error'
  const [message, setMessage] = useState('');
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid verification link. No token provided.');
      return;
    }

    verifyEmail();
  }, [token]);

  const verifyEmail = async () => {
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token })
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setMessage(data.message || 'Your email has been verified successfully!');

        // Update user in localStorage if exists
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          user.emailVerified = true;
          localStorage.setItem('user', JSON.stringify(user));
        }

        // Redirect to app after 3 seconds
        setTimeout(() => {
          navigate('/');
        }, 3000);
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to verify email. The link may be expired or invalid.');
      }
    } catch (error) {
      setStatus('error');
      setMessage('An error occurred while verifying your email. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Status Icon */}
          <div className="flex justify-center mb-6">
            {status === 'verifying' && (
              <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center">
                <Loader className="w-10 h-10 text-indigo-600 animate-spin" />
              </div>
            )}
            {status === 'success' && (
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
            )}
            {status === 'error' && (
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-10 h-10 text-red-600" />
              </div>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">
            {status === 'verifying' && 'Verifying Your Email'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </h1>

          {/* Message */}
          <p className="text-center text-gray-600 mb-6">
            {status === 'verifying' && 'Please wait while we verify your email address...'}
            {status === 'success' && message}
            {status === 'error' && message}
          </p>

          {/* Actions */}
          {status === 'success' && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <p className="text-sm text-green-700 mb-2">
                  You now have full access to all features!
                </p>
                <p className="text-xs text-green-600">
                  Redirecting you to the app in 3 seconds...
                </p>
              </div>
              <button
                onClick={() => navigate('/')}
                className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                Go to App Now
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700 mb-2">
                  What you can do:
                </p>
                <ul className="text-xs text-red-600 space-y-1 list-disc list-inside">
                  <li>Check if the link has expired (links are valid for 24 hours)</li>
                  <li>Request a new verification email from your profile</li>
                  <li>Contact support if the problem persists</li>
                </ul>
              </div>
              <button
                onClick={() => navigate('/')}
                className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                Go to App
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Fiction Writing Studio
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Your AI-powered storytelling companion
          </p>
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationPage;
