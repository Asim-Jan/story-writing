import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Users, Cpu, BarChart3, Download, RefreshCw } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const AICostAnalytics = () => {
  const [loading, setLoading] = useState(true);
  const [costData, setCostData] = useState(null);
  const [topUsers, setTopUsers] = useState([]);
  const [modelBreakdown, setModelBreakdown] = useState([]);
  const [dateRange, setDateRange] = useState(30); // days
  const [topUsersLimit, setTopUsersLimit] = useState(20);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
  const token = localStorage.getItem('token');

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [costsRes, usersRes, modelsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/analytics/ai-costs?start_date=${startDate}&end_date=${endDate}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/admin/analytics/top-users-by-cost?days=${dateRange}&limit=${topUsersLimit}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/admin/analytics/cost-by-model?days=${dateRange}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (costsRes.ok && usersRes.ok && modelsRes.ok) {
        const costs = await costsRes.json();
        const users = await usersRes.json();
        const models = await modelsRes.json();

        setCostData(costs);
        setTopUsers(users.topUsers);
        setModelBreakdown(models.modelBreakdown);
      }
    } catch (error) {
      console.error('Error fetching AI cost analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange, topUsersLimit]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!costData) {
    return (
      <div className="text-center py-12">
        <DollarSign className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No cost data available</p>
      </div>
    );
  }

  const COLORS = ['#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444'];

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-3xl font-bold mb-2">AI Cost Analytics</h2>
            <p className="text-purple-100">Track and optimize AI token usage and costs</p>
          </div>
          <button
            onClick={fetchAnalytics}
            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-2"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>

        <div className="flex gap-4">
          <div>
            <label className="block text-sm text-purple-100 mb-1">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(parseInt(e.target.value))}
              className="px-4 py-2 bg-white/20 rounded-lg text-white outline-none focus:bg-white/30"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-purple-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Total Cost</h3>
            <DollarSign className="text-purple-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            ${costData.summary.totalCost?.toFixed(2) || '0.00'}
          </p>
          <p className="text-sm text-gray-500 mt-1">Last {dateRange} days</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Total Tokens</h3>
            <Cpu className="text-blue-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            {(costData.summary.totalTokens / 1_000_000).toFixed(2)}M
          </p>
          <p className="text-sm text-gray-500 mt-1">{costData.summary.totalTokens?.toLocaleString()} tokens</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-green-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Avg Daily Cost</h3>
            <TrendingUp className="text-green-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            ${costData.summary.avgDailyCost?.toFixed(2) || '0.00'}
          </p>
          <p className="text-sm text-gray-500 mt-1">Per day average</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-orange-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Total Requests</h3>
            <BarChart3 className="text-orange-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            {costData.summary.totalRequests?.toLocaleString() || '0'}
          </p>
          <p className="text-sm text-gray-500 mt-1">AI generations</p>
        </div>
      </div>

      {/* Daily Cost Trend Chart */}
      <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-purple-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp className="text-purple-600" size={24} />
          Daily Cost Trend
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={costData.daily_stats}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis yAxisId="left" label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: 'Requests', angle: 90, position: 'insideRight' }} />
            <Tooltip
              labelFormatter={(date) => new Date(date).toLocaleDateString()}
              formatter={(value, name) => {
                if (name === 'Daily Cost') return `$${value.toFixed(4)}`;
                return value;
              }}
            />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="dailyCost" name="Daily Cost" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
            <Line yAxisId="right" type="monotone" dataKey="dailyRequests" name="Requests" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Users by Cost */}
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Users className="text-blue-600" size={24} />
              Top Users by Cost
            </h3>
            <select
              value={topUsersLimit}
              onChange={(e) => setTopUsersLimit(parseInt(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded text-sm"
            >
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-2 px-2">User</th>
                  <th className="text-left py-2 px-2">Tier</th>
                  <th className="text-right py-2 px-2">Cost</th>
                  <th className="text-right py-2 px-2">Requests</th>
                </tr>
              </thead>
              <tbody>
                {topUsers.map((user, index) => (
                  <tr key={user.userId} className="border-b border-gray-100 hover:bg-purple-50">
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-gray-800">{user.username || 'Unknown'}</p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        user.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                        user.tier === 'basic' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {user.tier}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-gray-800">
                      ${user.totalCost.toFixed(4)}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-600">
                      {user.totalRequests}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Model Breakdown */}
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-green-200">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Cpu className="text-green-600" size={24} />
            Cost by Model
          </h3>

          {modelBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={modelBreakdown}
                    dataKey="totalCost"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ model, totalCost }) => `${model}: $${totalCost.toFixed(2)}`}
                  >
                    {modelBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `$${value.toFixed(4)}`} />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-4 space-y-2">
                {modelBreakdown.map((model, index) => (
                  <div key={model.model} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="font-semibold text-gray-800">{model.model}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-800">${model.totalCost.toFixed(4)}</p>
                      <p className="text-xs text-gray-500">
                        {model.requestCount} requests • {(model.totalTokens / 1000).toFixed(1)}k tokens
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Cpu className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p>No model data available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AICostAnalytics;
