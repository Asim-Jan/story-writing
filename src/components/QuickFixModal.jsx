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
        return 'text-[var(--red)] bg-[var(--bg2)] border-[var(--red)]';
      case 'warning':
        return 'text-[var(--warn)] bg-[var(--bg2)] border-[var(--warn)]';
      case 'info':
        return 'text-[var(--blue)] bg-[var(--bg2)] border-[var(--line2)]';
      default:
        return 'text-[var(--dim)] bg-[var(--bg2)] border-[var(--line)]';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'timeline':
        return '⛁';   // timeline block
      case 'character':
        return '✍';    // persona
      case 'location':
        return '⌖';    // position
      case 'plot':
        return '▶';    // thread
      case 'style':
        return '✎';    // prose
      default:
        return '⚠';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="card max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
            <AlertCircle size={18} className="text-[var(--warn)]" />
            Apply Continuity Fix
          </h2>
          <button
            onClick={onCancel}
            className="iconb"
            title="Cancel"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
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
                  <span className={`pill uppercase ${getSeverityColor(issue.severity)}`}>
                    {issue.severity}
                  </span>
                  <span className="pill capitalize">
                    {issue.category}
                  </span>
                </div>
                <p className="text-sm mb-2">{issue.description}</p>
                {issue.location && (
                  <p className="text-xs opacity-75 font-medium">
                    Location: {issue.location}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Suggestion Editor */}
          <div className="mb-6">
            <label className="lbl block mb-1.5">
              Edit Suggestion Before Applying:
            </label>
            <textarea
              value={editedSuggestion}
              onChange={(e) => setEditedSuggestion(e.target.value)}
              className="w-full h-40 p-3 resize-none text-sm"
              placeholder="Enter your fix suggestion here..."
            />
            <p className="text-xs text-[var(--dim2)] mt-2">
              This suggestion will be applied to the relevant part of your story. You can edit it to better fit your narrative.
            </p>
          </div>

          {/* Application Strategy Info */}
          <div className="border border-[var(--line2)] bg-[var(--glass2)] p-4 mb-5">
            <p className="lbl mb-2 flex items-center gap-2">
              <CheckCircle size={16} />
              How This Will Be Applied:
            </p>
            <ul className="text-sm text-[var(--dim)] space-y-1">
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
