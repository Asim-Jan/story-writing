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
    <div className="min-h-screen bg-[var(--bg)] grat flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <svg viewBox="0 0 44 44" aria-hidden="true" className="w-11 h-11 mx-auto mb-4">
            <circle cx="22" cy="22" r="14" fill="none" stroke="var(--blue)" strokeWidth="1.5"/>
            <path d="M22 1v7M22 36v7M1 22h7M36 22h7" stroke="var(--blue)" strokeWidth="1.5"/>
            <rect x="19.5" y="19.5" width="5" height="5" fill="var(--red)"/>
          </svg>
          <h1 className="text-3xl font-bold text-[var(--ink)] mb-1">Fiction Writing Studio</h1>
          <p className="lbl">Your AI-powered storytelling companion</p>
        </div>

        {/* Auth Form */}
        <div className="card p-7">
          {!showForgotPassword && !showResetForm && (
            <>
              <div className="mb-6">
                <div className="tabs mb-6">
                  <button
                    onClick={() => {
                      setIsLogin(true);
                      setError('');
                      setSuccess('');
                    }}
                    className={`flex-1 py-2 px-4 font-semibold transition-colors ${
                      isLogin ? 'on text-[var(--ink)]' : 'text-[var(--dim)] hover:text-[var(--ink)]'
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
                    className={`flex-1 py-2 px-4 font-semibold transition-colors ${
                      !isLogin ? 'on text-[var(--ink)]' : 'text-[var(--dim)] hover:text-[var(--ink)]'
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
                <label className="lbl block mb-1.5">
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
                  className="w-full px-4 py-2.5 text-sm"
                />
              </div>
            )}

            <div>
              <label className="lbl block mb-1.5">
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
                className="w-full px-4 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="lbl block mb-1.5">
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
                  className="w-full px-4 py-2.5 pr-11 text-sm"
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
                    <div className="flex-1 h-1.5 bg-[var(--glass2)] border border-[var(--line)]">
                      <div
                        className={`h-full ${
                          passwordValidation.strength === 100 ? 'bg-[var(--ok)]' :
                          passwordValidation.strength >= 60 ? 'bg-[var(--ok)]' :
                          passwordValidation.strength >= 40 ? 'bg-[var(--warn)]' :
                          'bg-[var(--red)]'
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
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.minLength ? 'text-[var(--ok)]' : 'text-[var(--dim2)]'}`}>
                      {passwordValidation.requirements.minLength ? <Check size={14} /> : <X size={14} />}
                      <span>At least 8 characters</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasUppercase ? 'text-[var(--ok)]' : 'text-[var(--dim2)]'}`}>
                      {passwordValidation.requirements.hasUppercase ? <Check size={14} /> : <X size={14} />}
                      <span>One uppercase letter</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasLowercase ? 'text-[var(--ok)]' : 'text-[var(--dim2)]'}`}>
                      {passwordValidation.requirements.hasLowercase ? <Check size={14} /> : <X size={14} />}
                      <span>One lowercase letter</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasNumber ? 'text-[var(--ok)]' : 'text-[var(--dim2)]'}`}>
                      {passwordValidation.requirements.hasNumber ? <Check size={14} /> : <X size={14} />}
                      <span>One number</span>
                    </div>
                    <div className={`flex items-center gap-1 ${passwordValidation.requirements.hasSpecialChar ? 'text-[var(--ok)]' : 'text-[var(--dim2)]'}`}>
                      {passwordValidation.requirements.hasSpecialChar ? <Check size={14} /> : <X size={14} />}
                      <span>One special character (!@#$%^&*...)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="border border-[var(--red)] text-[var(--red)] px-4 py-2.5 rounded-[3px] text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="border border-[var(--ok)] text-[var(--ok)] px-4 py-2.5 rounded-[3px] text-sm">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn pri w-full py-2.5 justify-center"
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
                  className="text-sm text-[var(--blue)] hover:underline font-semibold"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </form>

          {isLogin && (
            <div className="mt-4 text-center">
              <p className="text-sm text-[var(--dim)]">
                Don't have an account?{' '}
                <button
                  onClick={() => setIsLogin(false)}
                  className="text-[var(--blue)] hover:underline font-semibold"
                >
                  Sign up free
                </button>
              </p>
            </div>
          )}

          {!isLogin && (
            <div className="mt-4 text-center">
              <p className="text-sm text-[var(--dim)]">
                Already have an account?{' '}
                <button
                  onClick={() => setIsLogin(true)}
                  className="text-[var(--blue)] hover:underline font-semibold"
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
              <h2 className="text-xl font-bold text-[var(--ink)] mb-2">Reset Password</h2>
              <p className="text-sm text-[var(--dim)] mb-5">Enter your email to receive reset instructions</p>

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="lbl block mb-1.5">
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
                    className="w-full px-4 py-2.5 text-sm"
                  />
                </div>

                {error && (
                  <div className="border border-[var(--red)] text-[var(--red)] px-4 py-2.5 rounded-[3px] text-sm">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="border border-[var(--ok)] text-[var(--ok)] px-4 py-2.5 rounded-[3px] text-sm">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn pri w-full py-2.5 justify-center"
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
                  className="w-full text-sm text-[var(--dim)] hover:text-[var(--ink)]"
                >
                  Back to login
                </button>
              </form>
            </div>
          )}

          {/* Reset Password Form */}
          {showResetForm && (
            <div>
              <h2 className="text-xl font-bold text-[var(--ink)] mb-2">Set New Password</h2>
              <p className="text-sm text-[var(--dim)] mb-5">Enter your new password</p>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="lbl block mb-1.5">
                    Reset Token
                  </label>
                  <input
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    required
                    placeholder="Enter reset token"
                    className="w-full px-4 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label className="lbl block mb-1.5">
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
                    className="w-full px-4 py-2.5 text-sm"
                  />
                  <p className="text-xs text-[var(--dim2)] mt-1 mono">Minimum 6 characters</p>
                </div>

                {error && (
                  <div className="border border-[var(--red)] text-[var(--red)] px-4 py-2.5 rounded-[3px] text-sm">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="border border-[var(--ok)] text-[var(--ok)] px-4 py-2.5 rounded-[3px] text-sm">
                    {success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn pri w-full py-2.5 justify-center"
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
                  className="w-full text-sm text-[var(--dim)] hover:text-[var(--ink)]"
                >
                  Back to login
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-lg mb-1 text-[var(--blue)]">✎</div>
            <p className="lbl">AI Writing Tools</p>
          </div>
          <div>
            <div className="text-lg mb-1 text-[var(--blue)]">✳</div>
            <p className="lbl">Visual Generation</p>
          </div>
          <div>
            <div className="text-lg mb-1 text-[var(--blue)]">⌘</div>
            <p className="lbl">Collaboration</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
