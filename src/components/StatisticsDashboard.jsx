import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { ordnanceChartColors } from '../utils/chartPalette';
import { TrendingUp, Calendar, Clock, BookOpen, Target, Award } from 'lucide-react';

const COLORS = ordnanceChartColors(6);

export default function StatisticsDashboard({ bookId }) {
  const [stats, setStats] = useState({ daily: [], goals: {} });
  const [bookData, setBookData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('week'); // week, month, year

  useEffect(() => {
    loadData();
  }, [bookId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      // Load writing stats
      const statsResponse = await fetch('/api/users/stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData);
      }

      // Load book data if bookId provided
      if (bookId) {
        const bookResponse = await fetch(`/api/books/${bookId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include'
        });
        if (bookResponse.ok) {
          const book = await bookResponse.json();
          setBookData(book);
        }
      }
    } catch (error) {
      console.error('Load data error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredData = () => {
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate = new Date(now);
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
    }

    return stats.daily
      .filter(d => new Date(d.date) >= startDate)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(d => ({
        ...d,
        date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      }));
  };

  const getTotalWords = () => {
    return stats.daily.reduce((sum, d) => sum + (d.wordsWritten || 0), 0);
  };

  const getTotalTime = () => {
    const minutes = stats.daily.reduce((sum, d) => sum + (d.timeSpent || 0), 0);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return { hours, minutes: mins };
  };

  const getAverageWords = () => {
    if (stats.daily.length === 0) return 0;
    const daysWithWriting = stats.daily.filter(d => d.wordsWritten > 0).length;
    if (daysWithWriting === 0) return 0;
    return Math.round(getTotalWords() / daysWithWriting);
  };

  const getBestDay = () => {
    if (stats.daily.length === 0) return null;
    return stats.daily.reduce((best, current) => {
      return (current.wordsWritten || 0) > (best?.wordsWritten || 0) ? current : best;
    }, null);
  };

  const getChapterStats = () => {
    if (!bookData?.chapters) return [];

    const chapterData = bookData.chapters.map(ch => ({
      name: `Ch. ${ch.number}`,
      words: ch.wordCount || 0,
    }));

    return chapterData.slice(0, 10); // Show first 10 chapters
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  const chartData = getFilteredData();
  const totalWords = getTotalWords();
  const totalTime = getTotalTime();
  const avgWords = getAverageWords();
  const bestDay = getBestDay();
  const chapterStats = getChapterStats();

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="text-blue-600 dark:text-blue-400" size={24} />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Words</span>
          </div>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalWords.toLocaleString()}</p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-6 rounded-lg border border-purple-200 dark:border-purple-800">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="text-purple-600 dark:text-purple-400" size={24} />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Time Spent</span>
          </div>
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {totalTime.hours}h {totalTime.minutes}m
          </p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-6 rounded-lg border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="text-green-600 dark:text-green-400" size={24} />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Avg Words/Day</span>
          </div>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">{avgWords.toLocaleString()}</p>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-yellow-50 dark:from-orange-900/20 dark:to-yellow-900/20 p-6 rounded-lg border border-orange-200 dark:border-orange-800">
          <div className="flex items-center gap-3 mb-2">
            <Award className="text-orange-600 dark:text-orange-400" size={24} />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Best Day</span>
          </div>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
            {bestDay ? bestDay.wordsWritten.toLocaleString() : '0'}
          </p>
          {bestDay && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {new Date(bestDay.date).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setTimeRange('week')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            timeRange === 'week'
              ? 'bg-indigo-600 dark:bg-indigo-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Week
        </button>
        <button
          onClick={() => setTimeRange('month')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            timeRange === 'month'
              ? 'bg-indigo-600 dark:bg-indigo-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Month
        </button>
        <button
          onClick={() => setTimeRange('year')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            timeRange === 'year'
              ? 'bg-indigo-600 dark:bg-indigo-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Year
        </button>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Words Written Over Time */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Words Written</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="date" stroke="var(--dim2)" style={{ fontSize: '12px' }} />
              <YAxis stroke="var(--dim2)" style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg2)',
                  border: '1px solid var(--line2)',
                  borderRadius: '8px',
                  color: 'var(--ink)',
                }}
              />
              <Area type="monotone" dataKey="wordsWritten" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Time Spent Writing */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Time Spent (minutes)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="date" stroke="var(--dim2)" style={{ fontSize: '12px' }} />
              <YAxis stroke="var(--dim2)" style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg2)',
                  border: '1px solid var(--line2)',
                  borderRadius: '8px',
                  color: 'var(--ink)',
                }}
              />
              <Line type="monotone" dataKey="timeSpent" stroke={COLORS[0]} strokeWidth={2} dot={{ fill: COLORS[0] }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Chapter Word Counts */}
        {chapterStats.length > 0 && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Chapter Word Counts</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chapterStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="name" stroke="var(--dim2)" style={{ fontSize: '12px' }} />
                <YAxis stroke="var(--dim2)" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: 'var(--ink)',
                  }}
                />
                <Bar dataKey="words" fill={COLORS[2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
