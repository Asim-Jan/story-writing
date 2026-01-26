import React, { useState } from 'react';
import { Search, Replace, X, ChevronDown, ChevronUp } from 'lucide-react';

export default function FindReplace({ text, onReplace, onClose }) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches] = useState([]);
  const [currentMatch, setCurrentMatch] = useState(0);

  const findMatches = () => {
    if (!findText) {
      setMatches([]);
      return;
    }

    let flags = 'g';
    if (!caseSensitive) flags += 'i';

    let pattern = findText;
    if (wholeWord) {
      pattern = `\\b${findText}\\b`;
    }

    const regex = new RegExp(pattern, flags);
    const found = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      found.push({
        index: match.index,
        text: match[0],
      });
    }

    setMatches(found);
    setCurrentMatch(0);
  };

  const handleFind = () => {
    findMatches();
  };

  const handleReplace = () => {
    if (matches.length === 0) return;

    const match = matches[currentMatch];
    const before = text.substring(0, match.index);
    const after = text.substring(match.index + match.text.length);
    const newText = before + replaceText + after;

    onReplace(newText);

    // Recalculate matches after replacement
    setTimeout(() => {
      findMatches();
    }, 100);
  };

  const handleReplaceAll = () => {
    if (!findText || matches.length === 0) return;

    let flags = 'g';
    if (!caseSensitive) flags += 'i';

    let pattern = findText;
    if (wholeWord) {
      pattern = `\\b${findText}\\b`;
    }

    const regex = new RegExp(pattern, flags);
    const newText = text.replace(regex, replaceText);

    onReplace(newText);
    setMatches([]);
    setCurrentMatch(0);
  };

  const nextMatch = () => {
    if (matches.length === 0) return;
    setCurrentMatch((prev) => (prev + 1) % matches.length);
  };

  const previousMatch = () => {
    if (matches.length === 0) return;
    setCurrentMatch((prev) => (prev - 1 + matches.length) % matches.length);
  };

  return (
    <div className="bg-white dark:bg-gray-800 border-2 border-indigo-200 dark:border-indigo-800 rounded-lg shadow-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Search className="text-indigo-600 dark:text-indigo-400" size={20} />
          <h3 className="font-bold text-gray-800 dark:text-gray-100">Find & Replace</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-3">
        {/* Find Input */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFind()}
              placeholder="Find..."
              className="w-full p-2 pr-20 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-400 outline-none"
            />
            {matches.length > 0 && (
              <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm text-gray-600 dark:text-gray-400">
                {currentMatch + 1} / {matches.length}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={previousMatch}
              disabled={matches.length === 0}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Previous match"
            >
              <ChevronUp size={18} />
            </button>
            <button
              onClick={nextMatch}
              disabled={matches.length === 0}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Next match"
            >
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        {/* Replace Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with..."
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-400 outline-none"
          />
        </div>

        {/* Options */}
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-gray-700 dark:text-gray-300">Case sensitive</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-gray-700 dark:text-gray-300">Whole word</span>
          </label>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleFind}
            className="flex-1 px-4 py-2 bg-indigo-600 dark:bg-indigo-700 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors flex items-center justify-center gap-2"
          >
            <Search size={16} />
            Find
          </button>
          <button
            onClick={handleReplace}
            disabled={matches.length === 0}
            className="flex-1 px-4 py-2 bg-green-600 dark:bg-green-700 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Replace size={16} />
            Replace
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={matches.length === 0}
            className="flex-1 px-4 py-2 bg-orange-600 dark:bg-orange-700 text-white rounded-lg hover:bg-orange-700 dark:hover:bg-orange-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Replace All
          </button>
        </div>

        {matches.length > 0 && (
          <div className="text-sm text-green-600 dark:text-green-400 font-medium">
            Found {matches.length} match{matches.length !== 1 ? 'es' : ''}
          </div>
        )}

        {findText && matches.length === 0 && (
          <div className="text-sm text-red-600 dark:text-red-400 font-medium">
            No matches found
          </div>
        )}
      </div>
    </div>
  );
}
