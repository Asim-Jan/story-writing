import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

export function TypewriterModePlugin({ enabled }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!enabled) return;

    const editorElement = editor.getRootElement();
    if (!editorElement) return;

    const handleSelectionChange = () => {
      if (!enabled) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.top === 0 && rect.bottom === 0) return;

      const editorRect = editorElement.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const targetY = viewportHeight / 2;

      const currentY = rect.top;
      const scrollOffset = currentY - targetY;

      if (Math.abs(scrollOffset) > 50) {
        editorElement.scrollBy({
          top: scrollOffset,
          behavior: 'smooth',
        });
      }
    };

    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange);

    // Also listen for editor updates
    const removeUpdateListener = editor.registerUpdateListener(() => {
      handleSelectionChange();
    });

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      removeUpdateListener();
    };
  }, [editor, enabled]);

  return null;
}
