import React, { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { AlertCircle, CheckCircle, Lightbulb } from 'lucide-react';

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Grammar check API call
async function checkGrammar(text) {
  try {
    const response = await fetch('/api/grammar-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, language: 'en-US' }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('Grammar check rate limit reached');
        return { suggestions: [], rateLimited: true };
      }
      throw new Error('Grammar check failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Grammar check error:', error);
    return { suggestions: [], error: true };
  }
}

// Suggestion Popup Component
function SuggestionPopup({ suggestion, onApply, onDismiss, position }) {
  const getIconAndColor = (type) => {
    switch (type) {
      case 'misspelling':
        return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-300' };
      case 'grammar':
        return { icon: Lightbulb, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-300' };
      case 'style':
        return { icon: Lightbulb, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-300' };
      default:
        return { icon: AlertCircle, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-300' };
    }
  };

  const { icon: Icon, color, bg, border } = getIconAndColor(suggestion.type);

  return (
    <div
      className={`absolute z-50 w-80 ${bg} border-2 ${border} rounded-lg shadow-xl p-4`}
      style={{
        top: position.top + 'px',
        left: position.left + 'px',
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <Icon className={`${color} flex-shrink-0 mt-0.5`} size={20} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">{suggestion.shortMessage}</p>
          {suggestion.message !== suggestion.shortMessage && (
            <p className="text-xs text-gray-600 mt-1">{suggestion.message}</p>
          )}
        </div>
      </div>

      {suggestion.replacements && suggestion.replacements.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Suggestions:</p>
          <div className="flex flex-wrap gap-2">
            {suggestion.replacements.map((replacement, idx) => (
              <button
                key={idx}
                onClick={() => onApply(replacement)}
                className="px-3 py-1 bg-white border border-gray-300 rounded-md text-sm hover:bg-indigo-50 hover:border-indigo-400 transition-colors"
              >
                {replacement}
              </button>
            ))}
          </div>
        </div>
      )}

      {suggestion.rule.description && (
        <div className="mb-3 pt-2 border-t border-gray-200">
          <p className="text-xs text-gray-600">
            <span className="font-semibold">Rule:</span> {suggestion.rule.description}
          </p>
        </div>
      )}

      <button
        onClick={onDismiss}
        className="w-full px-3 py-1.5 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300 transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}

// Grammar Checker Status Component
function GrammarStatus({ checking, errorCount, suggestions, onToggle, enabled }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-l border-gray-300">
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          enabled
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        title={enabled ? 'Grammar check enabled' : 'Grammar check disabled'}
      >
        {checking ? (
          <>
            <div className="animate-spin rounded-full h-3 w-3 border-2 border-green-600 border-t-transparent"></div>
            <span>Checking...</span>
          </>
        ) : (
          <>
            {enabled ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{enabled ? 'Grammar: On' : 'Grammar: Off'}</span>
            {enabled && errorCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-xs">
                {errorCount}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}

// Main Grammar Checker Plugin
export function GrammarCheckerPlugin({ enabled, onToggle }) {
  const [editor] = useLexicalComposerContext();
  const [checking, setChecking] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });

  // Debounced grammar check
  const debouncedCheck = useCallback(
    debounce(async (text) => {
      if (!enabled || !text || text.length < 10) {
        setSuggestions([]);
        return;
      }

      setChecking(true);
      const result = await checkGrammar(text);
      setSuggestions(result.suggestions || []);
      setChecking(false);
    }, 2000), // Check 2 seconds after user stops typing
    [enabled]
  );

  // Listen for editor changes
  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      return;
    }

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const text = root.getTextContent();
        debouncedCheck(text);
      });
    });
  }, [editor, enabled, debouncedCheck]);

  const handleApplySuggestion = (replacement) => {
    if (!activeSuggestion) return;

    editor.update(() => {
      const root = $getRoot();
      const text = root.getTextContent();

      // Replace the text at the error position
      const before = text.substring(0, activeSuggestion.offset);
      const after = text.substring(activeSuggestion.offset + activeSuggestion.length);
      const newText = before + replacement + after;

      // Update editor content (simplified - in production, preserve formatting)
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode(newText);
      paragraph.append(textNode);
      root.append(paragraph);
    });

    setActiveSuggestion(null);

    // Recheck grammar after applying suggestion
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const text = root.getTextContent();
      debouncedCheck(text);
    });
  };

  const handleDismiss = () => {
    setActiveSuggestion(null);
  };

  // Render underlines for grammar errors (simplified)
  useEffect(() => {
    if (!enabled || suggestions.length === 0) return;

    // In a production app, you'd add decorators to the editor
    // to highlight errors inline. This is a simplified version.
    console.log('Grammar suggestions:', suggestions);
  }, [suggestions, enabled]);

  return (
    <>
      <GrammarStatus
        checking={checking}
        errorCount={suggestions.length}
        suggestions={suggestions}
        onToggle={onToggle}
        enabled={enabled}
      />
      {activeSuggestion && (
        <SuggestionPopup
          suggestion={activeSuggestion}
          onApply={handleApplySuggestion}
          onDismiss={handleDismiss}
          position={popupPosition}
        />
      )}
    </>
  );
}

export default GrammarCheckerPlugin;

// Helper function to import in RichTextEditor
export { GrammarStatus };
