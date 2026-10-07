import React, { useState, useEffect } from 'react';
import { User, Key, Bell, Palette, Save, ArrowLeft, Mail, Calendar, Shield, Zap, AlertCircle, Lock, LogOut, TrendingUp, Database, Cpu, Image, FileText, DollarSign, Target } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import UserAICosts from './UserAICosts';
import WritingGoals from './WritingGoals';
import StatisticsDashboard from './StatisticsDashboard';
import { normalizeVoiceSpec, voiceKey, specFromKey, vibeVoiceLabel, languageOf } from '../utils/voices';

const API_URL = import.meta.env.VITE_API_URL || 'https://story-writing.com';

const ProfilePage = ({ onBack }) => {
  const { user: authUser, logout } = useAuth();
  const portalLinked = !!authUser?.portalLinked;
  const [alsoSignOutPortal, setAlsoSignOutPortal] = useState(false);
  const [activeTab, setActiveTab] = useState('account');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // User data
  const [userData, setUserData] = useState({
    name: '',
    email: '',
    createdAt: ''
  });


  // Preferences
  // The AI model is not a per-user choice: Admin > AI Models & Costs sets the
  // Writer and Assistant models for everyone. defaultVoice is a voice spec
  // (see utils/voices); new audiobooks start with it.
  const [voiceLists, setVoiceLists] = useState({ vibevoice: [], qwen: [], custom: [] });
  const [preferences, setPreferences] = useState({
    defaultVoice: null,
    autoSave: true,
    enableNotifications: true,
    theme: 'light'
  });

  // Password change
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Quotas
  const [quotas, setQuotas] = useState(null);

  // Subscription
  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);

  useEffect(() => {
    fetchUserData();
    fetchSettings();
    fetchQuotas();
    fetchSubscription();
  }, []);

  const fetchUserData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setUserData({
          name: data.user.name || '',
          email: data.user.email || '',
          createdAt: data.user.createdAt || ''
        });
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/users/settings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        // Load preferences if they exist in the response
        if (data.preferences) {
          setPreferences(prev => ({ ...prev, ...data.preferences }));
        }
      }
      const voices = await fetch(`${API_URL}/api/audiobook/voices`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (voices) setVoiceLists({ vibevoice: voices.vibevoice || [], qwen: voices.qwen || [], custom: voices.custom || [] });
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotas = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/users/quotas`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setQuotas(data);
      }
    } catch (error) {
      console.error('Error fetching quotas:', error);
    }
  };

  const fetchSubscription = async () => {
    try {
      setLoadingSubscription(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/subscriptions/my`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setSubscription(data);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoadingSubscription(false);
    }
  };

  const handleCheckout = async (tier) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/subscriptions/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ tier })
      });

      if (response.ok) {
        const data = await response.json();
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to start checkout' });
      }
    } catch (error) {
      console.error('Error starting checkout:', error);
      setMessage({ type: 'error', text: 'Failed to start checkout' });
    }
  };

  const handleCancelSubscription = async () => {
    if (!window.confirm('Are you sure you want to cancel your subscription? It will remain active until the end of your billing period.')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/subscriptions/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Subscription canceled. It will remain active until the end of your billing period.' });
        fetchSubscription(); // Refresh subscription data
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to cancel subscription' });
      }
    } catch (error) {
      console.error('Error canceling subscription:', error);
      setMessage({ type: 'error', text: 'Failed to cancel subscription' });
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/users/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ preferences })
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings' });
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setSaving(true);
    setMessage(null);

    // Validate passwords
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'All password fields are required' });
      setSaving(false);
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      setSaving(false);
      return;
    }

    if (passwordData.newPassword.length < 8) {
      setMessage({ type: 'error', text: 'New password must be at least 8 characters long' });
      setSaving(false);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword
        })
      });

      if (response.ok) {
        // the server reissues this session's token (other sessions die);
        // adopt it or the next authenticated call 401s
        const data = await response.json().catch(() => ({}));
        if (data.token) {
          localStorage.setItem('token', data.token);
        }
        setMessage({ type: 'success', text: 'Password changed successfully!' });
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }
    } catch (error) {
      console.error('Error changing password:', error);
      setMessage({ type: 'error', text: 'Failed to change password' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('Are you sure you want to logout?')) {
      await logout({ everywhere: portalLinked && alsoSignOutPortal });
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="text-center">
          <User className="w-16 h-16 text-purple-600 mx-auto mb-4 animate-pulse" />
          <p className="text-xl text-gray-700">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-purple-600 hover:text-purple-800 mb-4 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Books
          </button>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Profile & Settings</h1>
          <p className="text-gray-600">Manage your account and preferences</p>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-4">
              <nav className="space-y-2">
                <button
                  onClick={() => setActiveTab('account')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeTab === 'account'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-purple-50'
                  }`}
                >
                  <User className="w-5 h-5" />
                  Account
                </button>
                <button
                  onClick={() => setActiveTab('preferences')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeTab === 'preferences'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-purple-50'
                  }`}
                >
                  <Palette className="w-5 h-5" />
                  Preferences
                </button>
                <button
                  onClick={() => setActiveTab('security')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeTab === 'security'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-purple-50'
                  }`}
                >
                  <Lock className="w-5 h-5" />
                  Security
                </button>
                <button
                  onClick={() => setActiveTab('quotas')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeTab === 'quotas'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-purple-50'
                  }`}
                >
                  <TrendingUp className="w-5 h-5" />
                  Usage & Limits
                </button>
                <button
                  onClick={() => setActiveTab('ai-costs')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeTab === 'ai-costs'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-purple-50'
                  }`}
                >
                  <DollarSign className="w-5 h-5" />
                  AI Costs
                </button>
                <button
                  onClick={() => setActiveTab('writing-goals')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeTab === 'writing-goals'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-purple-50'
                  }`}
                >
                  <Target className="w-5 h-5" />
                  Writing Goals
                </button>
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-xl shadow-lg p-8">
              {/* Account Tab */}
              {activeTab === 'account' && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <User className="w-6 h-6" />
                    Account Information
                  </h2>

                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <User className="w-4 h-4" />
                          Name
                        </label>
                        <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                          {userData.name || 'N/A'}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <Mail className="w-4 h-4" />
                          Email
                        </label>
                        <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                          {userData.email || 'N/A'}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Member Since
                        </label>
                        <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900">
                          {formatDate(userData.createdAt)}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          Account Status
                        </label>
                        <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-700 font-medium">
                          Active
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* API Keys Tab — retired with the SAI migration */}
              {activeTab === 'api-keys' && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <Key className="w-6 h-6" />
                    API Keys
                  </h2>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <div className="flex gap-3">
                      <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-blue-800">
                        <p className="font-semibold mb-1">No API keys needed</p>
                        <p>
                          All AI features run on the platform's own models, included with your plan.
                          Usage is metered against your plan's quota on the Usage & Limits tab.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Preferences Tab */}
              {activeTab === 'preferences' && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <Palette className="w-6 h-6" />
                    Preferences
                  </h2>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default audiobook voice
                      </label>
                      <select
                        value={voiceKey(preferences.defaultVoice)}
                        onChange={(e) => setPreferences({ ...preferences, defaultVoice: specFromKey(e.target.value) })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        data-testid="default-voice-select"
                      >
                        {/* the saved voice, even before the lists load (or if it was deleted) */}
                        {![...voiceLists.vibevoice.map(v => `vibevoice:${v.id}`), ...voiceLists.qwen.map(v => `qwen:${v.id}`), ...voiceLists.custom.map(v => `custom:${v.id}`)]
                          .includes(voiceKey(preferences.defaultVoice)) && (
                          <option value={voiceKey(preferences.defaultVoice)}>
                            {normalizeVoiceSpec(preferences.defaultVoice).customVoiceId ? 'My voice' : vibeVoiceLabel(normalizeVoiceSpec(preferences.defaultVoice).voice)}
                          </option>
                        )}
                        {[...new Set(voiceLists.vibevoice.map(v => languageOf(v.id, v.language)))].map(lang => (
                          <optgroup key={lang} label={`VibeVoice: ${lang}`}>
                            {voiceLists.vibevoice.filter(v => languageOf(v.id, v.language) === lang)
                              .map(v => <option key={v.id} value={`vibevoice:${v.id}`}>{vibeVoiceLabel(v.id, v.language)}</option>)}
                          </optgroup>
                        ))}
                        {voiceLists.qwen.length > 0 && (
                          <optgroup label="Qwen voices">
                            {voiceLists.qwen.map(v => <option key={v.id} value={`qwen:${v.id}`}>{v.name || v.id}{v.language ? ` (${v.language})` : ''}</option>)}
                          </optgroup>
                        )}
                        {voiceLists.custom.length > 0 && (
                          <optgroup label="My voices">
                            {voiceLists.custom.map(v => <option key={v.id} value={`custom:${v.id}`}>{v.name}</option>)}
                          </optgroup>
                        )}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">New audiobooks start with this voice; each book can still pick its own.</p>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5 text-purple-600" />
                        <div>
                          <p className="font-medium text-gray-900">Auto-save</p>
                          <p className="text-sm text-gray-600">Automatically save changes</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.autoSave}
                          onChange={(e) => setPreferences({ ...preferences, autoSave: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Bell className="w-5 h-5 text-purple-600" />
                        <div>
                          <p className="font-medium text-gray-900">Notifications</p>
                          <p className="text-sm text-gray-600">Enable system notifications</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.enableNotifications}
                          onChange={(e) => setPreferences({ ...preferences, enableNotifications: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                      </label>
                    </div>

                    <div className="flex justify-end pt-4 border-t">
                      <button
                        onClick={handleSavePreferences}
                        disabled={saving}
                        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save className="w-5 h-5" />
                        {saving ? 'Saving...' : 'Save Preferences'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Security Tab */}
              {activeTab === 'security' && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <Lock className="w-6 h-6" />
                    Security
                  </h2>

                  <div className="space-y-8">
                    {/* Change Password Section (portal-linked accounts sign in through SAI Cloud) */}
                    {portalLinked ? (
                      <div className="border-b pb-8">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Sign-in</h3>
                        <p className="text-sm text-gray-600">You sign in with SAI Cloud, so your password is managed there.</p>
                      </div>
                    ) : (
                    <div className="border-b pb-8">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h3>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Current Password
                          </label>
                          <input
                            type="password"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                            placeholder="Enter current password"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            New Password
                          </label>
                          <input
                            type="password"
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                            placeholder="Enter new password (min. 8 characters)"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Confirm New Password
                          </label>
                          <input
                            type="password"
                            value={passwordData.confirmPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                            placeholder="Confirm new password"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>

                        <div className="flex justify-end pt-4">
                          <button
                            onClick={handleChangePassword}
                            disabled={saving}
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Lock className="w-5 h-5" />
                            {saving ? 'Changing Password...' : 'Change Password'}
                          </button>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Logout Section */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Management</h3>

                      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">Logout from Account</h4>
                            <p className="text-sm text-gray-600 mb-4">
                              This will end your current session and you'll need to login again.
                            </p>
                          </div>
                        </div>

                        {portalLinked && (
                          <label className="flex items-center gap-2 text-sm text-gray-700 mb-4">
                            <input type="checkbox" checked={alsoSignOutPortal} onChange={(e) => setAlsoSignOutPortal(e.target.checked)} />
                            Also sign out of SAI Cloud
                          </label>
                        )}
                        <button
                          onClick={handleLogout}
                          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2"
                        >
                          <LogOut className="w-5 h-5" />
                          Logout
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quotas Tab */}
              {activeTab === 'quotas' && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <TrendingUp className="w-6 h-6" />
                    Usage & Limits
                  </h2>

                  {quotas ? (
                    <div className="space-y-6">
                      {/* Subscription Management */}
                      {subscription && subscription.has_subscription && subscription.subscription ? (
                        <div className="bg-white border border-gray-200 rounded-lg p-6">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Subscription</h3>

                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm text-gray-600">Plan</p>
                                <p className="text-lg font-semibold capitalize">{subscription.subscription.tier}</p>
                              </div>
                              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                                subscription.subscription.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {subscription.subscription.status}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-sm text-gray-600">Billing Period</p>
                                <p className="text-sm font-medium">
                                  {new Date(subscription.subscription.current_period_start).toLocaleDateString()} - {new Date(subscription.subscription.current_period_end).toLocaleDateString()}
                                </p>
                              </div>
                              {subscription.subscription.cancel_at_period_end && (
                                <div className="col-span-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                  <p className="text-sm text-yellow-800">
                                    Your subscription will be canceled on {new Date(subscription.subscription.current_period_end).toLocaleDateString()}
                                  </p>
                                </div>
                              )}
                            </div>

                            {subscription.subscription.status === 'active' && !subscription.subscription.cancel_at_period_end && (
                              <div className="pt-4 border-t">
                                <button
                                  onClick={handleCancelSubscription}
                                  className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors text-sm font-medium"
                                >
                                  Cancel Subscription
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : !loadingSubscription && (
                        <div className="card p-5">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upgrade Your Plan</h3>
                          <p className="text-sm text-gray-600 mb-6">
                            Choose a plan that fits your writing needs and unlock more features.
                          </p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Basic Plan */}
                            <div className="bg-white rounded-lg p-6 border-2 border-gray-200 hover:border-purple-400 transition-colors">
                              <div className="mb-4">
                                <h4 className="text-xl font-bold text-gray-900">Basic</h4>
                                <div className="mt-2">
                                  <span className="text-3xl font-bold">$9.99</span>
                                  <span className="text-gray-600">/month</span>
                                </div>
                              </div>

                              <ul className="space-y-2 mb-6">
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>10 books</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>100,000 words</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>100 chapters per book</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>100 AI requests/day</span>
                                </li>
                              </ul>

                              <button
                                onClick={() => handleCheckout('basic')}
                                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
                              >
                                Subscribe to Basic
                              </button>
                            </div>

                            {/* Premium Plan */}
                            <div className="bg-white rounded-lg p-6 border-2 border-purple-400 hover:border-purple-600 transition-colors relative">
                              <div className="absolute -top-3 right-4 bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-medium">
                                Popular
                              </div>

                              <div className="mb-4">
                                <h4 className="text-xl font-bold text-gray-900">Premium</h4>
                                <div className="mt-2">
                                  <span className="text-3xl font-bold">$19.99</span>
                                  <span className="text-gray-600">/month</span>
                                </div>
                              </div>

                              <ul className="space-y-2 mb-6">
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>Unlimited books</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>Unlimited words</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>Unlimited chapters</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>Unlimited AI requests</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span>Priority support</span>
                                </li>
                              </ul>

                              <button
                                onClick={() => handleCheckout('premium')}
                                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
                              >
                                Subscribe to Premium
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Tier Badge */}
                      <div className="card p-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-1">
                              Current Plan: <span className="capitalize text-purple-600">{quotas.tier}</span>
                            </h3>
                            <p className="text-sm text-gray-600">
                              {quotas.tier === 'free' && 'Perfect for getting started'}
                              {quotas.tier === 'basic' && 'Great for active writers'}
                              {quotas.tier === 'premium' && 'Unlimited creative power'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Usage Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Books */}
                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <FileText className="w-5 h-5 text-blue-600" />
                            <h4 className="font-semibold text-gray-900">Books</h4>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Used</span>
                              <span className="font-medium">{quotas.usage.current_books} / {quotas.limitsDisplay.books}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${Math.min((quotas.usage.current_books / quotas.limits.max_books) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* Words */}
                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <Database className="w-5 h-5 text-green-600" />
                            <h4 className="font-semibold text-gray-900">Words</h4>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Used</span>
                              <span className="font-medium">{quotas.usage.current_words.toLocaleString()} / {quotas.limitsDisplay.words}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-green-600 h-2 rounded-full transition-all"
                                style={{ width: `${Math.min((quotas.usage.current_words / quotas.limits.max_words) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* Chapters */}
                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <FileText className="w-5 h-5 text-purple-600" />
                            <h4 className="font-semibold text-gray-900">Chapters</h4>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Used</span>
                              <span className="font-medium">{quotas.usage.current_chapters} / {quotas.limitsDisplay.chapters}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-purple-600 h-2 rounded-full transition-all"
                                style={{ width: `${Math.min((quotas.usage.current_chapters / quotas.limits.max_chapters) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* AI Requests */}
                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <Cpu className="w-5 h-5 text-orange-600" />
                            <h4 className="font-semibold text-gray-900">AI Requests (Today)</h4>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Used</span>
                              <span className="font-medium">{quotas.usage.ai_requests_today} / {quotas.limitsDisplay.aiRequests}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-orange-600 h-2 rounded-full transition-all"
                                style={{ width: `${Math.min((quotas.usage.ai_requests_today / quotas.limits.max_ai_requests_per_day) * 100, 100)}%` }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-500">Resets daily</p>
                          </div>
                        </div>
                      </div>

                      {/* Features */}
                      <div className="bg-white border border-gray-200 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Features</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {Object.entries(quotas.features).map(([feature, enabled]) => (
                            <div key={feature} className="flex items-center gap-2">
                              {enabled ? (
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                              )}
                              <span className={`text-sm ${enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                                {feature.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <TrendingUp className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">Loading quota information...</p>
                    </div>
                  )}
                </div>
              )}

              {/* AI Costs Tab */}
              {activeTab === 'ai-costs' && (
                <div>
                  <UserAICosts />
                </div>
              )}

              {/* Writing Goals Tab */}
              {activeTab === 'writing-goals' && (
                <div className="space-y-6">
                  <WritingGoals />
                  <StatisticsDashboard />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
