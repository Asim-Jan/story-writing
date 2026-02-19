import React, { useState, useEffect } from 'react';
import { Book, Mail, Lock, User, LogIn, UserPlus, BookOpen, Eye, EyeOff, Check, X } from 'lucide-react';
import { validatePassword, getPasswordStrength, getPasswordError } from '../utils/passwordValidation';

const AuthPage = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetForm, setShowResetForm] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordValidation, setPasswordValidation] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validate password strength on registration
    if (!isLogin) {
      const validation = validatePassword(formData.password);
      if (!validation.isValid) {
        setError(getPasswordError(validation));
        setLoading(false);
        return;
      }
    }

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Store token in localStorage
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Call success callback
      onAuthSuccess(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  // Validate password in real-time for registration
  useEffect(() => {
    if (!isLogin && formData.password) {
      setPasswordValidation(validatePassword(formData.password));
    } else {
      setPasswordValidation(null);
    }
  }, [formData.password, isLogin]);

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: formData.email })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setSuccess(data.message);

      // For development: auto-fill token if provided
      if (data.resetToken) {
        setResetToken(data.resetToken);
        setShowResetForm(true);
        setShowForgotPassword(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: resetToken,
          newPassword: formData.password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess('Password reset successfully! You can now log in.');
      setShowResetForm(false);
      setIsLogin(true);
      setFormData({ email: formData.email, password: '', name: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl shadow-lg mb-4">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Fiction Writing Studio</h1>
          <p className="text-gray-600">Your AI-powered storytelling companion</p>
        </div>

        {/* Auth Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {!showForgotPassword && !showResetForm && (
            <>
              <div className="mb-6">
                <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                  <button
                    onClick={() => {
                      setIsLogin(true);
                      setError('');
                      setSuccess('');
                    }}
                    className={`flex-1 py-2 px-4 rounded-md font-semibold transition-all ${
                      isLogin
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    <LogIn className="inline-block w-4 h-4 mr-2" />
                    Login
                  </button>
                  <button
                    onClick={() => {
                      setIsLogin(false);
                      setError('');
                      setSuccess('');
                    }}
                    className={`flex-1 py-2 px-4 rounded-md font-semibold transition-all ${
                      !isLogin
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    <UserPlus className="inline-block w-4 h-4 mr-2" />
                    Register
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <User className="inline-block w-4 h-4 mr-1" />
                  Full Name
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required={!isLogin}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <Mail className="inline-block w-4 h-4 mr-1" />
                Email Address
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="your@email.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <Lock className="inline-block w-4 h-4 mr-1" />
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              {/* Password Strength Indicator for Registration */}
              {!isLogin && formData.password && passwordValidation && (
                <div className="mt-3 space-y-2">
                  {/* Strength Bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          passwordValidation.strength === 100 ? 'bg-green-500' :
                          passwordValidation.strength >= 80 ? 'bg-green-400' :
                          passwordValidation.strength >= 60 ? 'bg-yellow-400' :
                          passwordValidation.strength >= 40 ? 'bg-orange-400' :
                          'bg-red-400'
                        }`}
                        style={{ width: `${passwordValidation.strength}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${
                      passwordValidation.strength === 100 ? 'text-green-600' :
                      passwordValidation.strength >= 80 ? 'text-green-500' :
                      passwordValidation.strength >= 60 ? 'text-yellow-500' :
                      passwordValidation.strength >= 40 ? 'text-orange-500' :
                      'text-red-500'
                    }`}>
                      {getPasswordStrength(passwordValidation.strength).label}
                    </span>
                  </div>

                  {/* Requirements Checklist */}
                  <div className="space-y-1 text-xs">
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.minLength ? 'text-green-600' : 'text-gray-500'}`}>
                      {passwordValidation.requirements.minLength ? <Check size={14} /> : <X size={14} />}
                      <span>At least 8 characters</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasUppercase ? 'text-green-600' : 'text-gray-500'}`}>
                      {passwordValidation.requirements.hasUppercase ? <Check size={14} /> : <X size={14} />}
                      <span>One uppercase letter</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasLowercase ? 'text-green-600' : 'text-gray-500'}`}>
                      {passwordValidation.requirements.hasLowercase ? <Check size={14} /> : <X size={14} />}
                      <span>One lowercase letter</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasNumber ? 'text-green-600' : 'text-gray-500'}`}>
                      {passwordValidation.requirements.hasNumber ? <Check size={14} /> : <X size={14} />}
                      <span>One number</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasSpecialChar ? 'text-green-600' : 'text-gray-500'}`}>
                      {passwordValidation.requirements.hasSpecialChar ? <Check size={14} /> : <X size={14} />}
                      <span>One special character (!@#$%^&*...)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 focus:ring-4 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Processing...
                </span>
              ) : (
                <>
                  {isLogin ? (
                    <>
                      <LogIn className="inline-block w-5 h-5 mr-2" />
                      Sign In
                    </>
                  ) : (
                    <>
                      <UserPlus className="inline-block w-5 h-5 mr-2" />
                      Create Account
                    </>
                  )}
                </>
              )}
            </button>

            {isLogin && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(true);
                    setError('');
                    setSuccess('');
                  }}
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </form>

          {isLogin && (
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">
                Don't have an account?{' '}
                <button
                  onClick={() => setIsLogin(false)}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Sign up free
                </button>
              </p>
            </div>
          )}

          {!isLogin && (
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{' '}
                <button
                  onClick={() => setIsLogin(true)}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Sign in
                </button>
              </p>
            </div>
          )}
          </>
          )}

          {/* Forgot Password Form */}
          {showForgotPassword && (
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Reset Password</h2>
              <p className="text-gray-600 mb-6">Enter your email to receive reset instructions</p>

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    <Mail className="inline-block w-4 h-4 mr-1" />
                    Email Address
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 focus:ring-4 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setError('');
                    setSuccess('');
                  }}
                  className="w-full text-sm text-gray-600 hover:text-gray-800"
                >
                  Back to login
                </button>
              </form>
            </div>
          )}

          {/* Reset Password Form */}
          {showResetForm && (
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Set New Password</h2>
              <p className="text-gray-600 mb-6">Enter your new password</p>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Reset Token
                  </label>
                  <input
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    required
                    placeholder="Enter reset token"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    <Lock className="inline-block w-4 h-4 mr-1" />
                    New Password
                  </label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    placeholder="••••••••"
                    minLength="6"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum 6 characters</p>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 focus:ring-4 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
                >
                  {loading ? 'Resetting...' : 'Reset Password'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowResetForm(false);
                    setShowForgotPassword(false);
                    setError('');
                    setSuccess('');
                  }}
                  className="w-full text-sm text-gray-600 hover:text-gray-800"
                >
                  Back to login
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div className="text-sm">
            <div className="text-2xl mb-1">✍️</div>
            <p className="text-gray-600">AI Writing Tools</p>
          </div>
          <div className="text-sm">
            <div className="text-2xl mb-1">🎨</div>
            <p className="text-gray-600">Visual Generation</p>
          </div>
          <div className="text-sm">
            <div className="text-2xl mb-1">🤝</div>
            <p className="text-gray-600">Collaboration</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
