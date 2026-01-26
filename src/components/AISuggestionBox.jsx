import React from 'react';
import { Sparkles, Check, X, RefreshCw } from 'lucide-react';

const AISuggestionBox = ({
  suggestion,
  onAccept,
  onReject,
  onRegenerate,
  loading,
  title = "AI Suggestion"
}) => {
  if (!suggestion && !loading) return null;

  return (
    <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-lg shadow-lg">
      <div className="flex items-center gap-3 mb-4">
        <Sparkles className="text-purple-600 animate-pulse" size={24} />
        <h4 className="font-bold text-purple-900 text-lg">{title}</h4>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <p className="text-purple-700">Generating with AI...</p>
        </div>
      ) : (
        <>
          <div className="bg-white p-4 rounded-lg border border-purple-200 mb-4">
            {typeof suggestion === 'object' ? (
              <div className="space-y-3">
                {Object.entries(suggestion).map(([key, value]) => {
                  if (!value || key === 'id') return null;
                  return (
                    <div key={key}>
                      <span className="font-semibold text-gray-700 capitalize">
                        {key.replace(/([A-Z])/g, ' $1').trim()}:
                      </span>
                      <p className="text-gray-800 mt-1">{value}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-800">{suggestion}</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onAccept}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 font-semibold shadow-md hover:shadow-lg"
            >
              <Check size={20} />
              Accept
            </button>
            <button
              onClick={onRegenerate}
              disabled={loading}
              className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 font-semibold shadow-md hover:shadow-lg disabled:opacity-50"
            >
              <RefreshCw size={20} />
              Regenerate
            </button>
            <button
              onClick={onReject}
              className="px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2 font-semibold shadow-md hover:shadow-lg"
            >
              <X size={20} />
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AISuggestionBox;
