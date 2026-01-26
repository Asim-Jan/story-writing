import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import AISuggestionBox from './AISuggestionBox';

const ImproveButton = ({ content, contentType, onImprove, context }) => {
  const [showImprover, setShowImprover] = useState(false);
  const [improvePrompt, setImprovePrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  const handleImprove = async () => {
    setGenerating(true);
    setSuggestion(null);

    try {
      const fullPrompt = `Original ${contentType}:\n${content}\n\nImprovement request: ${improvePrompt}`;

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'improve',
          prompt: fullPrompt,
          context: context
        })
      });

      if (!response.ok) {
        throw new Error('Failed to improve content');
      }

      const result = await response.json();
      setSuggestion(result);
    } catch (error) {
      console.error("Error improving content:", error);
      alert("Failed to improve content. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = () => {
    if (suggestion && onImprove) {
      onImprove(suggestion.improved);
    }
    setSuggestion(null);
    setShowImprover(false);
    setImprovePrompt('');
  };

  const handleReject = () => {
    setSuggestion(null);
  };

  const handleRegenerate = () => {
    handleImprove();
  };

  return (
    <div>
      {!showImprover ? (
        <button
          onClick={() => setShowImprover(true)}
          className="text-purple-600 hover:text-purple-800 flex items-center gap-1 text-sm font-medium"
          title="Improve with AI"
        >
          <Sparkles size={14} />
          Improve
        </button>
      ) : (
        <div className="mt-4 p-4 bg-purple-50 border-2 border-purple-200 rounded-lg">
          <div className="mb-3">
            <label className="block text-sm font-semibold text-purple-900 mb-2">
              How would you like to improve this?
            </label>
            <input
              type="text"
              value={improvePrompt}
              onChange={(e) => setImprovePrompt(e.target.value)}
              placeholder="E.g., 'Make it more dramatic' or 'Add more detail'"
              className="w-full p-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none text-sm"
              disabled={generating}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleImprove}
              disabled={generating || !improvePrompt.trim()}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1 text-sm disabled:opacity-50"
            >
              <Sparkles size={14} />
              {generating ? 'Improving...' : 'Improve'}
            </button>
            <button
              onClick={() => {
                setShowImprover(false);
                setImprovePrompt('');
                setSuggestion(null);
              }}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>

          {suggestion && (
            <div className="mt-4">
              <AISuggestionBox
                suggestion={suggestion}
                onAccept={handleAccept}
                onReject={handleReject}
                onRegenerate={handleRegenerate}
                loading={generating}
                title="Improved Version"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImproveButton;
