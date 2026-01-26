import { useState, useEffect } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Image,
  Music,
  FileText,
  Upload,
  Video,
  Trash2,
  RefreshCw,
  Bell,
  BellOff,
} from 'lucide-react';
import { useJobNotifications } from '../hooks/useJobNotifications';

const JOB_TYPE_ICONS = {
  image: Image,
  audio: Music,
  content: FileText,
  import: Upload,
  video: Video,
};

const JOB_TYPE_COLORS = {
  image: 'text-purple-400',
  audio: 'text-blue-400',
  content: 'text-green-400',
  import: 'text-yellow-400',
  video: 'text-pink-400',
};

export default function JobsTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem('jobNotifications') !== 'false'
  );

  // Enable notifications hook
  useJobNotifications(notificationsEnabled ? jobs : []);

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/jobs', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    // Auto-refresh every 5 seconds if enabled and there are active jobs
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchJobs();
      }, 5000);
    }

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const deleteJob = async (jobId) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        setJobs(jobs.filter(j => j.jobId !== jobId));
      }
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  const retryJob = async (jobId) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        fetchJobs();
      }
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-400" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-400" />;
      case 'active':
        return <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />;
      case 'queued':
        return <Clock className="w-5 h-5 text-yellow-400" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-900/20 border-green-500/30';
      case 'failed':
        return 'bg-red-900/20 border-red-500/30';
      case 'active':
        return 'bg-blue-900/20 border-blue-500/30';
      case 'queued':
        return 'bg-yellow-900/20 border-yellow-500/30';
      default:
        return 'bg-gray-900/20 border-gray-500/30';
    }
  };

  const activeJobs = jobs.filter(j => j.status === 'active' || j.status === 'queued');
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const failedJobs = jobs.filter(j => j.status === 'failed');

  const toggleNotifications = () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue);
    localStorage.setItem('jobNotifications', newValue.toString());

    if (newValue && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Background Jobs</h2>
          <p className="text-gray-400">
            Monitor AI generation tasks running in the background
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={toggleNotifications}
            className={`px-4 py-2 rounded-lg border-2 transition-colors flex items-center gap-2 ${
              notificationsEnabled
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                : 'bg-gray-700 border-gray-600 text-gray-400'
            }`}
            title={notificationsEnabled ? 'Notifications enabled' : 'Notifications disabled'}
          >
            {notificationsEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            Notifications
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-4 py-2 rounded-lg border-2 transition-colors ${
              autoRefresh
                ? 'bg-green-500/20 border-green-500/50 text-green-400'
                : 'bg-gray-700 border-gray-600 text-gray-400'
            }`}
          >
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </button>
          <button
            onClick={fetchJobs}
            className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-yellow-900/20 border-2 border-yellow-500/30 rounded-lg p-4">
          <div className="text-3xl font-bold text-yellow-400">{activeJobs.length}</div>
          <div className="text-gray-400">Active/Queued</div>
        </div>
        <div className="bg-green-900/20 border-2 border-green-500/30 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-400">{completedJobs.length}</div>
          <div className="text-gray-400">Completed</div>
        </div>
        <div className="bg-red-900/20 border-2 border-red-500/30 rounded-lg p-4">
          <div className="text-3xl font-bold text-red-400">{failedJobs.length}</div>
          <div className="text-gray-400">Failed</div>
        </div>
      </div>

      {/* Jobs list */}
      <div className="space-y-3">
        {jobs.length === 0 ? (
          <div className="bg-gray-800 border-2 border-gray-700 rounded-lg p-8 text-center">
            <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No background jobs yet</p>
            <p className="text-gray-500 text-sm mt-1">
              When you generate images, audio, or content, jobs will appear here
            </p>
          </div>
        ) : (
          jobs.map((job) => {
            const Icon = JOB_TYPE_ICONS[job.type] || FileText;
            const typeColor = JOB_TYPE_COLORS[job.type] || 'text-gray-400';

            return (
              <div
                key={job.jobId}
                className={`border-2 rounded-lg p-4 ${getStatusColor(job.status)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <Icon className={`w-6 h-6 ${typeColor} mt-1`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(job.status)}
                        <h3 className="text-white font-semibold">
                          {job.type.charAt(0).toUpperCase() + job.type.slice(1)} Generation
                        </h3>
                        <span className="text-xs text-gray-500">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {job.message && (
                        <p className="text-gray-400 text-sm mb-2">{job.message}</p>
                      )}

                      {/* Progress bar for active jobs */}
                      {(job.status === 'active' || job.status === 'queued') && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>Progress</span>
                            <span>{job.progress || 0}%</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${job.progress || 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Error message for failed jobs */}
                      {job.status === 'failed' && job.error && (
                        <div className="mt-2 p-2 bg-red-900/30 border border-red-500/30 rounded text-sm text-red-300">
                          {job.error}
                        </div>
                      )}

                      {/* Result info for completed jobs */}
                      {job.status === 'completed' && job.result && (
                        <div className="mt-2 text-xs text-green-400">
                          ✓ {job.result.filename || 'Completed successfully'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
                    {job.status === 'failed' && (
                      <button
                        onClick={() => retryJob(job.jobId)}
                        className="p-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors"
                        title="Retry"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    {(job.status === 'completed' || job.status === 'failed') && (
                      <button
                        onClick={() => deleteJob(job.jobId)}
                        className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
