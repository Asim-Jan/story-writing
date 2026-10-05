import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Zap, Activity, Calendar, RefreshCw } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const UserAICosts = () => {
  const [loading, setLoading] = useState(true);
  const [costData, setCoststData] = useState(null);
  const [toolBreakdown, setToolBreakdown] = useState([]);
  const [dateRange, setDateRange] = useState(30);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
  const token = localStorage.getItem('token');

  const fetchCosts = async () => {
    setLoading(true);
    try {
      const [costsRes, toolsRes] = await Promise.all([
        fetch(`${API_URL}/api/users/ai-costs?days=${dateRange}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/users/ai-costs/by-tool?days=${dateRange}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (costsRes.ok && toolsRes.ok) {
        const costs = await costsRes.json();
        const tools = await toolsRes.json();

        setCoststData(costs);
        setToolBreakdown(tools.toolBreakdown);
      }
    } catch (error) {
      console.error('Error fetching AI costs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCosts();
  }, [dateRange]);

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

  // Calculate projected monthly cost
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const projectedMonthlyCost = costData.monthToDate.monthCost * (daysInMonth / dayOfMonth);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold mb-2">Your AI Usage & Costs</h2>
            <p className="text-purple-100">Track your AI token usage and estimated costs</p>
          </div>
          <button
            onClick={fetchCosts}
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
            <h3 className="text-sm font-semibold text-gray-600 uppercase">This Month</h3>
            <DollarSign className="text-purple-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            ${costData.monthToDate.monthCost?.toFixed(4) || '0.0000'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {costData.monthToDate.monthRequests} requests
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Tokens Used</h3>
            <Activity className="text-blue-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            {(costData.monthToDate.monthTokens / 1000).toFixed(1)}k
          </p>
          <p className="text-sm text-gray-500 mt-1">This month</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-green-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Projected</h3>
            <TrendingUp className="text-green-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            ${projectedMonthlyCost.toFixed(4)}
          </p>
          <p className="text-sm text-gray-500 mt-1">Est. monthly total</p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-2 border-orange-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-600 uppercase">Avg/Request</h3>
            <Zap className="text-orange-600" size={24} />
          </div>
          <p className="text-3xl font-bold text-gray-800">
            ${costData.monthToDate.monthRequests > 0
              ? (costData.monthToDate.monthCost / costData.monthToDate.monthRequests).toFixed(4)
              : '0.0000'
            }
          </p>
          <p className="text-sm text-gray-500 mt-1">Per AI generation</p>
        </div>
      </div>

      {/* Cost Breakdown Info */}
      <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <DollarSign className="text-blue-600 mt-1" size={20} />
          <div>
            <h4 className="font-semibold text-blue-900 mb-1">Understanding AI Costs</h4>
            <p className="text-sm text-blue-800">
              These are <strong>estimated costs</strong> based on the platform's rate card for the tokens you consume.
              Actual costs may vary. Most operations use the SAI models (sai-chat / sai-chat-fast).
            </p>
          </div>
        </div>
      </div>

      {/* Daily Cost Trend */}
      <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-purple-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Calendar className="text-purple-600" size={24} />
          Daily Usage Trend
        </h3>
        {costData.dailyHistory.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={costData.dailyHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis yAxisId="left" label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: 'Tokens', angle: 90, position: 'insideRight' }} />
              <Tooltip
                labelFormatter={(date) => new Date(date).toLocaleDateString()}
                formatter={(value, name) => {
                  if (name === 'Cost') return `$${value.toFixed(4)}`;
                  if (name === 'Tokens') return `${value.toLocaleString()}`;
                  return value;
                }}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="totalCost" name="Cost" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="totalTokens" name="Tokens" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p>No usage data for this period</p>
          </div>
        )}
      </div>

      {/* Tool Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-green-200">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Activity className="text-green-600" size={24} />
            Usage by Tool
          </h3>

          {toolBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={toolBreakdown}
                    dataKey="totalCost"
                    nameKey="toolType"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ toolType, totalCost }) => `${toolType}: $${totalCost.toFixed(3)}`}
                  >
                    {toolBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `$${value.toFixed(4)}`} />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-4 space-y-2">
                {toolBreakdown.map((tool, index) => (
                  <div key={tool.toolType} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="font-semibold text-gray-800 capitalize">
                        {tool.toolType.replace(/-/g, ' ')}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-800">${tool.totalCost.toFixed(4)}</p>
                      <p className="text-xs text-gray-500">
                        {tool.usageCount} uses • {(tool.totalTokens / 1000).toFixed(1)}k tokens
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Zap className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p>No tool usage data</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-purple-200">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Cost Optimization Tips</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg">
              <Zap className="text-purple-600 mt-1 flex-shrink-0" size={20} />
              <div>
                <h4 className="font-semibold text-purple-900 mb-1">Use Templates</h4>
                <p className="text-sm text-purple-800">
                  Prompt templates help you get better results with fewer tokens by providing optimized prompts.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
              <Activity className="text-blue-600 mt-1 flex-shrink-0" size={20} />
              <div>
                <h4 className="font-semibold text-blue-900 mb-1">Be Specific</h4>
                <p className="text-sm text-blue-800">
                  Clear, specific prompts often need fewer tokens and produce better results than vague ones.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
              <TrendingUp className="text-green-600 mt-1 flex-shrink-0" size={20} />
              <div>
                <h4 className="font-semibold text-green-900 mb-1">Review History</h4>
                <p className="text-sm text-green-800">
                  Use the generation history feature to reuse previous results instead of re-generating.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg">
              <DollarSign className="text-orange-600 mt-1 flex-shrink-0" size={20} />
              <div>
                <h4 className="font-semibold text-orange-900 mb-1">Monitor Usage</h4>
                <p className="text-sm text-orange-800">
                  Check this page regularly to understand your usage patterns and optimize accordingly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserAICosts;
