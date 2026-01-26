import React from 'react';
import { Sparkles } from 'lucide-react';

const AIHelper = ({
  show,
  type,
  prompt,
  setPrompt,
  onGenerate,
  onCancel,
  generating,
  title,
  placeholder
}) => {
  if (!show) return null;

  return (
    <div className="mb-6 p-4 bg-purple-50 border-2 border-purple-200 rounded-lg">
      <div className="flex items-start gap-3 mb-3">
        <Sparkles className="text-purple-600 mt-1" size={20} />
        <div className="flex-1">
          <h4 className="font-bold text-purple-900 mb-2">{title}</h4>
          <p className="text-sm text-purple-700 mb-3">
            Describe what you want and AI will help generate detailed information that fits your story.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            className="w-full p-3 border border-purple-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-purple-400 outline-none"
            disabled={generating}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey && prompt.trim()) {
                onGenerate();
              }
            }}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={onGenerate}
              disabled={generating || !prompt.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles size={16} />
              {generating ? 'Generating...' : `Generate ${type}`}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-purple-600 mt-2">Tip: Press Ctrl+Enter to generate</p>
        </div>
      </div>
    </div>
  );
};

export default AIHelper;
