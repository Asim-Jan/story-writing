import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { useState } from 'react';

const QuickFixModal = ({ issue, onApply, onCancel }) => {
  const [editedSuggestion, setEditedSuggestion] = useState(issue?.suggestion || '');
  const [applying, setApplying] = useState(false);

  if (!issue) return null;

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(editedSuggestion);
    } finally {
      setApplying(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'info':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'timeline':
        return '📅';
      case 'character':
        return '👤';
      case 'location':
        return '📍';
      case 'plot':
        return '📖';
      case 'style':
        return '✍️';
      default:
        return '📝';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 relative">
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-full p-2"
          >
            <X size={24} />
          </button>
          <div className="flex items-center gap-3 mb-2">
            <AlertCircle size={32} />
            <h2 className="text-2xl font-bold">Apply Continuity Fix</h2>
          </div>
          <p className="text-purple-100">
            Review and edit the suggested fix before applying it to your story
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Issue Summary */}
          <div className={`p-4 rounded-lg border-2 mb-6 ${getSeverityColor(issue.severity)}`}>
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl">{getCategoryIcon(issue.category)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-lg">{issue.title}</h3>
                  <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${getSeverityColor(issue.severity)}`}>
                    {issue.severity}
                  </span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium capitalize">
                    {issue.category}
                  </span>
                </div>
                <p className="text-sm mb-2">{issue.description}</p>
                {issue.location && (
                  <p className="text-xs opacity-75 font-medium">
                    📍 Location: {issue.location}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Suggestion Editor */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Edit Suggestion Before Applying:
            </label>
            <textarea
              value={editedSuggestion}
              onChange={(e) => setEditedSuggestion(e.target.value)}
              className="w-full h-40 p-4 border-2 border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none"
              placeholder="Enter your fix suggestion here..."
            />
            <p className="text-xs text-gray-500 mt-2">
              This suggestion will be applied to the relevant part of your story. You can edit it to better fit your narrative.
            </p>
          </div>

          {/* Application Strategy Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <CheckCircle size={16} />
              How This Will Be Applied:
            </h4>
            <ul className="text-sm text-blue-800 space-y-1">
              {issue.category === 'character' && (
                <li>• The suggestion will be added to the character's arc notes</li>
              )}
              {issue.category === 'plot' && (
                <li>• The suggestion will be added to the relevant plotline</li>
              )}
              {issue.location?.match(/Chapter \d+/) && (
                <li>• The suggestion will be appended to the chapter's summary</li>
              )}
              <li>• A note will be created in your Notes tab for future reference</li>
              <li>• You can manually integrate the suggestion into your content after reviewing</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleApply}
              disabled={applying || !editedSuggestion.trim()}
              className="flex-1 bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {applying ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Applying...
                </>
              ) : (
                <>
                  <CheckCircle size={20} />
                  Apply Fix
                </>
              )}
            </button>
            <button
              onClick={onCancel}
              disabled={applying}
              className="flex-1 bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickFixModal;
