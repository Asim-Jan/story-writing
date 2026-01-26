import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Calendar, Award, Settings, BarChart3, CheckCircle, Clock } from 'lucide-react';

export default function WritingGoals({ className = '' }) {
  const [stats, setStats] = useState({ daily: [], goals: {} });
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [goals, setGoals] = useState({
    dailyWordGoal: 500,
    weeklyWordGoal: 3500,
    monthlyWordGoal: 15000,
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await fetch('/api/users/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
        if (data.goals && Object.keys(data.goals).length > 0) {
          setGoals(data.goals);
        }
      }
    } catch (error) {
      console.error('Load stats error:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveGoals = async () => {
    try {
      const response = await fetch('/api/users/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goals),
      });

      if (response.ok) {
        setShowSettings(false);
        loadStats();
      }
    } catch (error) {
      console.error('Save goals error:', error);
    }
  };

  const getTodayStats = () => {
    const today = new Date().toISOString().split('T')[0];
    return stats.daily.find(d => d.date === today) || { wordsWritten: 0 };
  };

  const getWeekStats = () => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    return stats.daily
      .filter(d => {
        const date = new Date(d.date);
        return date >= weekAgo && date <= today;
      })
      .reduce((sum, d) => sum + (d.wordsWritten || 0), 0);
  };

  const getMonthStats = () => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    return stats.daily
      .filter(d => {
        const date = new Date(d.date);
        return date >= monthStart && date <= today;
      })
      .reduce((sum, d) => sum + (d.wordsWritten || 0), 0);
  };

  const getStreak = () => {
    if (stats.daily.length === 0) return 0;

    const sortedDays = [...stats.daily].sort((a, b) => new Date(b.date) - new Date(a.date));
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const day of sortedDays) {
      const dayDate = new Date(day.date);
      dayDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((currentDate - dayDate) / (1000 * 60 * 60 * 24));

      if (diffDays === streak && day.wordsWritten > 0) {
        streak++;
        currentDate = dayDate;
      } else if (diffDays > streak) {
        break;
      }
    }

    return streak;
  };

  const todayWords = getTodayStats().wordsWritten;
  const weekWords = getWeekStats();
  const monthWords = getMonthStats();
  const streak = getStreak();

  const dailyProgress = (todayWords / goals.dailyWordGoal) * 100;
  const weeklyProgress = (weekWords / goals.weeklyWordGoal) * 100;
  const monthlyProgress = (monthWords / goals.monthlyWordGoal) * 100;

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
            <Target className="text-green-600 dark:text-green-300" size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Writing Goals</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Track your progress</p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="Goal Settings"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-6 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Daily Word Goal
            </label>
            <input
              type="number"
              value={goals.dailyWordGoal}
              onChange={(e) => setGoals({ ...goals, dailyWordGoal: parseInt(e.target.value) || 0 })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              min="0"
              step="100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Weekly Word Goal
            </label>
            <input
              type="number"
              value={goals.weeklyWordGoal}
              onChange={(e) => setGoals({ ...goals, weeklyWordGoal: parseInt(e.target.value) || 0 })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              min="0"
              step="500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Monthly Word Goal
            </label>
            <input
              type="number"
              value={goals.monthlyWordGoal}
              onChange={(e) => setGoals({ ...goals, monthlyWordGoal: parseInt(e.target.value) || 0 })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              min="0"
              step="1000"
            />
          </div>
          <button
            onClick={saveGoals}
            className="w-full px-4 py-2 bg-indigo-600 dark:bg-indigo-700 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
          >
            Save Goals
          </button>
        </div>
      )}

      {/* Progress Bars */}
      <div className="p-6 space-y-6">
        {/* Daily Goal */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-gray-700 dark:text-gray-300">Today</span>
            </div>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
              {todayWords.toLocaleString()} / {goals.dailyWordGoal.toLocaleString()}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                dailyProgress >= 100 ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(dailyProgress, 100)}%` }}
            ></div>
          </div>
          {dailyProgress >= 100 && (
            <div className="flex items-center gap-1 mt-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle size={16} />
              <span>Goal achieved!</span>
            </div>
          )}
        </div>

        {/* Weekly Goal */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-purple-600 dark:text-purple-400" />
              <span className="font-semibold text-gray-700 dark:text-gray-300">This Week</span>
            </div>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
              {weekWords.toLocaleString()} / {goals.weeklyWordGoal.toLocaleString()}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                weeklyProgress >= 100 ? 'bg-green-500' : 'bg-purple-500'
              }`}
              style={{ width: `${Math.min(weeklyProgress, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Monthly Goal */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-orange-600 dark:text-orange-400" />
              <span className="font-semibold text-gray-700 dark:text-gray-300">This Month</span>
            </div>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
              {monthWords.toLocaleString()} / {goals.monthlyWordGoal.toLocaleString()}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                monthlyProgress >= 100 ? 'bg-green-500' : 'bg-orange-500'
              }`}
              style={{ width: `${Math.min(monthlyProgress, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Streak */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="text-yellow-600 dark:text-yellow-400" size={20} />
              <span className="font-semibold text-gray-700 dark:text-gray-300">Writing Streak</span>
            </div>
            <span className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {streak} {streak === 1 ? 'day' : 'days'}
            </span>
          </div>
          {streak > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Keep it up! You've written {streak} {streak === 1 ? 'day' : 'days'} in a row.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
