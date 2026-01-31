import React, { useState, useEffect } from 'react';
import {
  Users, Shield, Activity, BookOpen, TrendingUp,
  Search, ChevronDown, CheckCircle, XCircle,
  AlertCircle, ArrowLeft, FileText
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

const AdminDashboard = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loginHistory, setLoginHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSuccess, setFilterSuccess] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchStats();
    if (activeTab === 'users') {
      fetchUsers();
    } else if (activeTab === 'audit') {
      fetchAuditLogs();
    } else if (activeTab === 'security') {
      fetchLoginHistory();
    }
  }, [activeTab, currentPage, filterTier, filterStatus, filterSuccess, searchTerm]);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: currentPage,
        limit: 20,
        ...(filterTier && { tier: filterTier }),
        ...(filterStatus && { status: filterStatus }),
        ...(searchTerm && { search: searchTerm })
      });

      const response = await fetch(`${API_URL}/api/admin/users?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setTotalPages(data.pagination.pages);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: currentPage,
        limit: 50
      });

      const response = await fetch(`${API_URL}/api/admin/audit-log?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setAuditLogs(data.logs);
        setTotalPages(data.pagination.pages);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    }
  };

  const fetchLoginHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: currentPage,
        limit: 50
      });

      if (searchTerm) params.append('email', searchTerm);
      if (filterSuccess) params.append('success', filterSuccess);

      const response = await fetch(`${API_URL}/api/admin/login-history?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setLoginHistory(data.loginHistory);
        setTotalPages(data.pagination.pages);
      }
    } catch (error) {
      console.error('Error fetching login history:', error);
    }
  };

  const handleTierChange = async (userId, newTier) => {
    if (!confirm(`Change user tier to ${newTier}?`)) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/admin/users/${userId}/tier`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ tier: newTier })
      });

      if (response.ok) {
        alert('Tier updated successfully');
        fetchUsers();
        fetchStats(); // Refresh stats
      } else {
        const error = await response.json();
        alert(`Failed to update tier: ${error.message || error.error}`);
      }
    } catch (error) {
      console.error('Error updating tier:', error);
      alert('Error updating tier');
    }
  };

  const handleStatusChange = async (userId, newStatus) => {
    const reason = prompt(`Enter reason for changing status to ${newStatus}:`);
    if (!reason) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus, reason })
      });

      if (response.ok) {
        alert('Status updated successfully');
        fetchUsers();
        fetchStats(); // Refresh stats
      } else {
        const error = await response.json();
        alert(`Failed to update status: ${error.message || error.error}`);
      }
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Error updating status');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-purple-600 mx-auto mb-4 animate-pulse" />
          <p className="text-xl text-gray-700">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-purple-600 hover:text-purple-800 mb-4 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Books
          </button>
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-10 h-10 text-purple-600" />
            <h1 className="text-4xl font-bold text-gray-900">Admin Dashboard</h1>
          </div>
          <p className="text-gray-600">System administration and user management</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-6">
            <button
              onClick={() => { setActiveTab('overview'); setCurrentPage(1); }}
              className={`pb-4 px-2 font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Activity className="w-5 h-5 inline mr-2" />
              Overview
            </button>
            <button
              onClick={() => { setActiveTab('users'); setCurrentPage(1); }}
              className={`pb-4 px-2 font-medium transition-colors ${
                activeTab === 'users'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Users className="w-5 h-5 inline mr-2" />
              Users
            </button>
            <button
              onClick={() => { setActiveTab('audit'); setCurrentPage(1); }}
              className={`pb-4 px-2 font-medium transition-colors ${
                activeTab === 'audit'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <FileText className="w-5 h-5 inline mr-2" />
              Audit Log
            </button>
            <button
              onClick={() => { setActiveTab('security'); setCurrentPage(1); setSearchTerm(''); setFilterSuccess(''); }}
              className={`pb-4 px-2 font-medium transition-colors ${
                activeTab === 'security'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Shield className="w-5 h-5 inline mr-2" />
              Security
            </button>
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Total Users"
              value={stats.total_users}
              icon={Users}
              color="blue"
            />
            <StatCard
              title="Total Books"
              value={stats.total_books}
              icon={BookOpen}
              color="green"
            />
            <StatCard
              title="Total Words"
              value={stats.total_words?.toLocaleString() || 0}
              icon={TrendingUp}
              color="purple"
            />
            <StatCard
              title="Jobs (24h)"
              value={stats.jobs_last_24h}
              icon={Activity}
              color="orange"
            />

            {/* Tier breakdown */}
            <div className="bg-white p-6 rounded-lg shadow col-span-2">
              <h3 className="text-lg font-semibold mb-4">Users by Tier</h3>
              <div className="space-y-3">
                <TierBar label="Free" count={stats.free_users} total={stats.total_users} color="gray" />
                <TierBar label="Basic" count={stats.basic_users} total={stats.total_users} color="blue" />
                <TierBar label="Premium" count={stats.premium_users} total={stats.total_users} color="purple" />
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow col-span-2">
              <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">New users (7 days)</span>
                  <span className="font-semibold">{stats.new_users_last_week}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Suspended users</span>
                  <span className="font-semibold text-orange-600">{stats.suspended_users}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total chapters</span>
                  <span className="font-semibold">{stats.total_chapters}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg shadow">
            {/* Filters */}
            <div className="p-4 border-b flex gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Search by email or name..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
              <select
                value={filterTier}
                onChange={(e) => { setFilterTier(e.target.value); setCurrentPage(1); }}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
              >
                <option value="">All Tiers</option>
                <option value="free">Free</option>
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="banned">Banned</option>
              </select>
            </div>

            {/* Users table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Books</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={user.tier}
                          onChange={(e) => handleTierChange(user.id, e.target.value)}
                          className="px-3 py-1 border rounded text-sm focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="free">Free</option>
                          <option value="basic">Basic</option>
                          <option value="premium">Premium</option>
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={user.status || 'active'} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {user.book_count || 0}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {user.status !== 'suspended' && (
                            <button
                              onClick={() => handleStatusChange(user.id, 'suspended')}
                              className="text-orange-600 hover:text-orange-800"
                              title="Suspend user"
                            >
                              <AlertCircle size={18} />
                            </button>
                          )}
                          {user.status === 'suspended' && (
                            <button
                              onClick={() => handleStatusChange(user.id, 'active')}
                              className="text-green-600 hover:text-green-800"
                              title="Activate user"
                            >
                              <CheckCircle size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t flex justify-between items-center">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold">Admin Action Log</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="font-medium">{log.admin_name}</div>
                        <div className="text-gray-500">{log.admin_email}</div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {log.target_user_name && (
                          <div>
                            <div className="font-medium">{log.target_user_name}</div>
                            <div className="text-gray-500">{log.target_user_email}</div>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <pre className="text-xs">{JSON.stringify(log.changes, null, 2)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t flex justify-between items-center">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Security Tab */}
        {activeTab === 'security' && (
          <div>
            {/* Filters */}
            <div className="mb-6 flex gap-4">
              <input
                type="text"
                placeholder="Search by email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <select
                value={filterSuccess}
                onChange={(e) => setFilterSuccess(e.target.value)}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">All Attempts</option>
                <option value="true">Success Only</option>
                <option value="false">Failed Only</option>
              </select>
              <button
                onClick={() => { setSearchTerm(''); setFilterSuccess(''); setCurrentPage(1); }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Clear Filters
              </button>
            </div>

            {/* Login History Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User Agent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Failure Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loginHistory.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(entry.login_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.user_name || <span className="text-gray-400 italic">Unknown</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {entry.ip_address || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={entry.user_agent}>
                        {entry.user_agent || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {entry.success ? (
                          <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                            Success
                          </span>
                        ) : (
                          <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                            Failed
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {entry.failure_reason ? (
                          <span className="text-red-600">
                            {entry.failure_reason.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {loginHistory.length === 0 && (
                <div className="text-center py-12">
                  <Shield className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No login history</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {searchTerm || filterSuccess ? 'Try adjusting your filters' : 'Login attempts will appear here'}
                  </p>
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="mt-6 flex justify-between items-center">
              <p className="text-sm text-gray-700">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border rounded disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper components
const StatCard = ({ title, value, icon: Icon, color }) => {
  const colors = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500'
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${colors[color]} bg-opacity-10`}>
          <Icon className={`w-6 h-6 text-${color}-500`} />
        </div>
      </div>
      <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
      <p className="text-sm text-gray-600">{title}</p>
    </div>
  );
};

const TierBar = ({ label, count, total, color }) => {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  const colors = {
    gray: 'bg-gray-500',
    blue: 'bg-blue-500',
    purple: 'bg-purple-500'
  };

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold">{count}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`${colors[color]} h-2 rounded-full`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const styles = {
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-orange-100 text-orange-800',
    banned: 'bg-red-100 text-red-800'
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.active}`}>
      {status || 'active'}
    </span>
  );
};

export default AdminDashboard;
