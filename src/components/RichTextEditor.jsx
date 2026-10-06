import React, { useEffect, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table';
import {
  $getRoot,
  $insertNodes,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
  $getSelection,
  $isRangeSelection,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Quote,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Type,
} from 'lucide-react';
import { GrammarCheckerPlugin } from './GrammarCheckerPlugin';
import ReadabilityStats from './ReadabilityStats';
import ThemeToggle from './ThemeToggle';

// Toolbar Component
function ToolbarPlugin({ focusMode, setFocusMode, showStats, setShowStats }) {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');

  const formatBold = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
  };

  const formatItalic = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
  };

  const formatUnderline = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
  };

  const formatHeading = (headingSize) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode('h' + headingSize));
      }
    });
  };

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const formatBulletList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  };

  const formatNumberedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
  };

  return (
    <div className="flex items-center justify-between gap-2 p-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Text Formatting */}
        <div className="flex gap-1 border-r border-gray-300 dark:border-gray-600 pr-2">
          <button
            onClick={formatBold}
            className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${isBold ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}
            title="Bold (Ctrl+B)"
          >
            <Bold size={18} />
          </button>
          <button
            onClick={formatItalic}
            className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${isItalic ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}
            title="Italic (Ctrl+I)"
          >
            <Italic size={18} />
          </button>
          <button
            onClick={formatUnderline}
            className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${isUnderline ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon size={18} />
          </button>
        </div>

        {/* Headings */}
        <div className="flex gap-1 border-r border-gray-300 pr-2">
          <select
            onChange={(e) => {
              if (e.target.value === 'paragraph') {
                formatParagraph();
              } else {
                formatHeading(e.target.value);
              }
            }}
            value={blockType}
            className="p-1 px-2 rounded border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
          >
            <option value="paragraph">Paragraph</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
        </div>

        {/* Lists */}
        <div className="flex gap-1 border-r border-gray-300 pr-2">
          <button
            onClick={formatBulletList}
            className="p-2 rounded hover:bg-gray-200 transition-colors text-gray-700"
            title="Bullet List"
          >
            <List size={18} />
          </button>
          <button
            onClick={formatNumberedList}
            className="p-2 rounded hover:bg-gray-200 transition-colors text-gray-700"
            title="Numbered List"
          >
            <ListOrdered size={18} />
          </button>
        </div>

        {/* Quote */}
        <div className="flex gap-1 border-r border-gray-300 pr-2">
          <button
            onClick={formatQuote}
            className="p-2 rounded hover:bg-gray-200 transition-colors text-gray-700"
            title="Quote"
          >
            <Quote size={18} />
          </button>
        </div>
      </div>

      {/* View Options */}
      <div className="flex gap-1">
        <ThemeToggle />
        <button
          onClick={() => setShowStats(!showStats)}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${showStats ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}
          title={showStats ? 'Hide Stats' : 'Show Stats'}
        >
          {showStats ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
        <button
          onClick={() => setFocusMode(!focusMode)}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${focusMode ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}
          title={focusMode ? 'Exit Focus Mode' : 'Focus Mode'}
        >
          {focusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
    </div>
  );
}

// Word Counter Plugin
function WordCounterPlugin({ onStatsChange }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const text = root.getTextContent();

        const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        const characters = text.length;
        const charactersNoSpaces = text.replace(/\s/g, '').length;
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0).length;

        onStatsChange({
          words,
          characters,
          charactersNoSpaces,
          paragraphs,
        });
      });
    });
  }, [editor, onStatsChange]);

  return null;
}

// Load Initial Content Plugin — parses the stored markdown representation and
// reloads when the content changes EXTERNALLY (AI Improve/inline edits write a
// new chapter body). Reloading must not fight the user's typing: only reload
// when the serialized editor state differs from the incoming content.
function LoadContentPlugin({ initialContent, emittedRef }) {
  const [editor] = useLexicalComposerContext();
  const lastLoadedRef = useRef(null);

  useEffect(() => {
    // '' is a real value: New Chapter resets the form to an empty body, and
    // skipping it left the previous chapter's text in the editor, where typing
    // copied it into the new chapter. Only null/undefined mean "nothing yet".
    if (initialContent === null || initialContent === undefined) return;
    if (lastLoadedRef.current === initialContent) return;
    // Our own onChange echoing back through the parent's state. By the time it
    // arrives the user may have typed more, so comparing it with the editor's
    // CURRENT text would see a difference and reload older text over newer
    // (the cursor jumped to the start and typed text was scrambled).
    if (emittedRef?.current === initialContent) {
      lastLoadedRef.current = initialContent;
      return;
    }

    editor.update(() => {
      const root = $getRoot();
      // Skip the reload if the editor already holds exactly this content
      // (self-echo from our own onChange).
      const current = root.getTextContent();
      lastLoadedRef.current = initialContent;
      if (current === initialContent) return;

      root.clear();
      if (initialContent === '') {
        root.append($createParagraphNode());
        return;
      }
      // plain-text load: paragraphs from blank-line splits (markdown parsing
      // dropped — see the note in handleChange)
      const paragraphs = initialContent.split(/\n\n+/);
      const nodes = paragraphs.map(paraText => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(paraText);
        paragraph.append(textNode);
        return paragraph;
      });
      root.append(...nodes);
    });
  }, [editor, initialContent]);

  return null;
}

// Stats Display Component
function StatsDisplay({ stats, showStats, text, showReadability }) {
  if (!showStats) return null;

  return (
    <div className="border-t border-gray-200">
      <div className="flex items-center justify-end gap-4 px-4 py-2 bg-gray-50 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Type size={14} />
          <span className="font-semibold">{stats.words.toLocaleString()}</span> words
        </div>
        <div className="border-l border-gray-300 pl-4">
          <span className="font-semibold">{stats.characters.toLocaleString()}</span> characters
        </div>
        <div className="border-l border-gray-300 pl-4">
          <span className="font-semibold">{stats.paragraphs}</span> paragraphs
        </div>
      </div>
      {showReadability && stats.words > 50 && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <ReadabilityStats text={text} compact={true} />
        </div>
      )}
    </div>
  );
}

// Main Editor Component
export default function RichTextEditor({
  value = '',
  onChange,
  placeholder = 'Start writing your chapter...',
  autoFocus = false,
  className = '',
}) {
  const [focusMode, setFocusMode] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [showReadability, setShowReadability] = useState(true);
  const [grammarEnabled, setGrammarEnabled] = useState(true);
  const [currentText, setCurrentText] = useState(value);
  // the last text this editor emitted, so LoadContentPlugin can tell our own
  // echo from an external change
  const emittedRef = useRef(null);
  const [stats, setStats] = useState({
    words: 0,
    characters: 0,
    charactersNoSpaces: 0,
    paragraphs: 0,
  });

  const initialConfig = {
    namespace: 'FictionEditor',
    theme: {
      root: 'editor-root',
      paragraph: 'editor-paragraph',
      text: {
        bold: 'editor-text-bold',
        italic: 'editor-text-italic',
        underline: 'editor-text-underline',
      },
      heading: {
        h1: 'editor-heading-h1',
        h2: 'editor-heading-h2',
        h3: 'editor-heading-h3',
      },
      list: {
        ul: 'editor-list-ul',
        ol: 'editor-list-ol',
        listitem: 'editor-listitem',
      },
      quote: 'editor-quote',
    },
    onError: (error) => {
      console.error('Lexical Error:', error);
    },
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
      CodeHighlightNode,
      TableNode,
      TableCellNode,
      TableRowNode,
    ],
  };

  const handleChange = (editorState) => {
    editorState.read(() => {
      const root = $getRoot();
      // Chapters are stored as PLAIN TEXT. Markdown storage was tried and
      // dropped: Lexical 0.37's serializer escapes prose ('2*3' -> '2\*3'),
      // and the exporters printed raw ** and #. The markdown shortcut plugin
      // went with it: it turned typed **bold** into formatting that plain-text
      // storage then threw away (and the asterisks with it).
      const text = root.getTextContent();
      emittedRef.current = text;
      setCurrentText(text);
      onChange(text);
    });
  };

  return (
    <div className={`${focusMode ? 'fixed inset-0 z-50 bg-white dark:bg-gray-900' : ''} ${className}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative flex flex-col border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <ToolbarPlugin
              focusMode={focusMode}
              setFocusMode={setFocusMode}
              showStats={showStats}
              setShowStats={setShowStats}
            />
            <GrammarCheckerPlugin
              enabled={grammarEnabled}
              onToggle={() => setGrammarEnabled(!grammarEnabled)}
            />
          </div>

          <div className={`relative flex-1 overflow-auto bg-white dark:bg-gray-900 ${focusMode ? 'h-screen' : ''}`}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className={`
                    editor-input outline-none p-6
                    ${focusMode ? 'max-w-4xl mx-auto min-h-screen' : 'min-h-[400px]'}
                    font-serif text-lg leading-relaxed text-gray-800 dark:text-gray-200
                  `}
                />
              }
              placeholder={
                <div className="editor-placeholder absolute top-6 left-6 text-gray-400 dark:text-gray-500 pointer-events-none font-serif text-lg">
                  {placeholder}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            {autoFocus && <AutoFocusPlugin />}
            <ListPlugin />
            <LinkPlugin />
            <OnChangePlugin onChange={handleChange} />
            <WordCounterPlugin onStatsChange={setStats} />
            <LoadContentPlugin initialContent={value} emittedRef={emittedRef} />
          </div>

          <StatsDisplay stats={stats} showStats={showStats} text={currentText} showReadability={showReadability} />
        </div>
      </LexicalComposer>

      <style jsx>{`
        .editor-root {
          position: relative;
        }

        .editor-paragraph {
          margin: 0 0 1em 0;
        }

        .editor-text-bold {
          font-weight: bold;
        }

        .editor-text-italic {
          font-style: italic;
        }

        .editor-text-underline {
          text-decoration: underline;
        }

        .editor-heading-h1 {
          font-size: 2em;
          font-weight: bold;
          margin: 0.67em 0;
        }

        .editor-heading-h2 {
          font-size: 1.5em;
          font-weight: bold;
          margin: 0.75em 0;
        }

        .editor-heading-h3 {
          font-size: 1.17em;
          font-weight: bold;
          margin: 0.83em 0;
        }

        .editor-list-ul,
        .editor-list-ol {
          margin: 1em 0;
          padding-left: 2em;
        }

        .editor-list-ul {
          list-style-type: disc;
        }

        .editor-list-ol {
          list-style-type: decimal;
        }

        .editor-listitem {
          margin: 0.5em 0;
        }

        .editor-quote {
          border-left: 2px solid var(--line2);
          padding-left: 1em;
          margin: 1em 0;
          font-style: italic;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}
