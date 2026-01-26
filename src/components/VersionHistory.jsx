import React, { useState, useEffect } from 'react';
import { History, RotateCcw, Clock, FileText, X, Check, AlertTriangle } from 'lucide-react';

export default function VersionHistory({ bookId, chapterId, onRestore, onClose }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadVersions();
  }, [bookId, chapterId]);

  const loadVersions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/books/${bookId}/chapters/${chapterId}/versions`);
      if (response.ok) {
        const data = await response.json();
        setVersions(data.versions || []);
      }
    } catch (error) {
      console.error('Load versions error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (version) => {
    if (!confirm(`Are you sure you want to restore this version from ${new Date(version.timestamp).toLocaleString()}? Current content will be replaced.`)) {
      return;
    }

    try {
      setRestoring(true);
      const response = await fetch(`/api/books/${bookId}/chapters/${chapterId}/versions/${version.id}/restore`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        onRestore(data.chapter);
        onClose();
      } else {
        alert('Failed to restore version');
      }
    } catch (error) {
      console.error('Restore error:', error);
      alert('Failed to restore version');
    } finally {
      setRestoring(false);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return date.toLocaleString();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
              <History className="text-indigo-600 dark:text-indigo-300" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Version History</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {versions.length} version{versions.length !== 1 ? 's' : ''} saved
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-12">
              <History className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">No versions saved yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                Versions are automatically saved as you edit
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((version, index) => (
                <div
                  key={version.id}
                  className={`border-2 rounded-lg p-4 transition-all cursor-pointer ${
                    selectedVersion?.id === version.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                  }`}
                  onClick={() => setSelectedVersion(version)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <FileText className="text-indigo-600 dark:text-indigo-400" size={20} />
                        <div>
                          <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                            {version.title}
                            {index === 0 && (
                              <span className="ml-2 px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-full">
                                Latest
                              </span>
                            )}
                          </h3>
                          <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 mt-1">
                            <span className="flex items-center gap-1">
                              <Clock size={14} />
                              {formatDate(version.timestamp)}
                            </span>
                            <span>•</span>
                            <span>{version.wordCount} words</span>
                          </div>
                        </div>
                      </div>

                      {selectedVersion?.id === version.id && (
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                          <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
                            {version.content.substring(0, 200)}...
                          </p>
                        </div>
                      )}
                    </div>

                    {index > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(version);
                        }}
                        disabled={restoring}
                        className="px-4 py-2 bg-indigo-600 dark:bg-indigo-700 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RotateCcw size={16} />
                        {restoring ? 'Restoring...' : 'Restore'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
            <AlertTriangle className="flex-shrink-0 text-yellow-600 dark:text-yellow-500" size={18} />
            <p>
              <strong>Note:</strong> Versions are automatically saved as you write. We keep up to 50 versions per chapter.
              Restoring a version will replace your current content.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
