// Markdown -> prose for server-side consumers (audiobook TTS, exports).
// Mirrors src/utils/markdown.js stripMarkdown.
export function stripMarkdown(md) {
  if (typeof md !== 'string') return '';
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^(-{3,}|\*{3,})$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '\u2022 ')
    .trim();
}
