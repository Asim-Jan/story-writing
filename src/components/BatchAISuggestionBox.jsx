import React from 'react';
import { Check, X, RefreshCw, Sparkles } from 'lucide-react';

const BatchAISuggestionBox = ({ suggestions, onAccept, onReject, onRegenerate, loading, title }) => {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border-2 border-purple-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Sparkles className="text-purple-600" size={24} />
          <h3 className="text-xl font-bold text-purple-900">{title}</h3>
        </div>
        <span className="px-3 py-1 bg-purple-600 text-white rounded-full text-sm font-semibold">
          {suggestions.length} items generated
        </span>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto">
        {suggestions.map((suggestion, index) => (
          <div key={index} className="bg-white rounded-lg p-4 border border-purple-200">
            <div className="mb-3">
              <h4 className="font-bold text-gray-800 text-lg mb-2">
                {suggestion.name || suggestion.title || `Item ${index + 1}`}
              </h4>

              <div className="space-y-2 text-sm text-gray-700">
                {Object.entries(suggestion).map(([key, value]) => {
                  if (key === 'name' || key === 'title' || !value) return null;

                  const displayKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');

                  return (
                    <div key={key}>
                      <span className="font-semibold text-gray-800">{displayKey}:</span>{' '}
                      <span className="text-gray-700">{value}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => onAccept(index)}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={16} />
                Accept
              </button>
              <button
                onClick={() => onReject(index)}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={16} />
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-4 pt-4 border-t border-purple-200">
        <button
          onClick={() => onAccept('all')}
          disabled={loading}
          className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
        >
          <Check size={18} />
          Accept All
        </button>
        <button
          onClick={() => onReject('all')}
          disabled={loading}
          className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
        >
          <X size={18} />
          Reject All
        </button>
        <button
          onClick={onRegenerate}
          disabled={loading}
          className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold ml-auto"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Regenerating...' : 'Regenerate All'}
        </button>
      </div>
    </div>
  );
};

export default BatchAISuggestionBox;
