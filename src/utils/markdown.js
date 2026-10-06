// Markdown helpers for the editor's markdown round-trip.
// The editor stores chapter.content as markdown (Lexical $convertToMarkdownString);
// the exporters (PDF/DOCX/EPUB/audiobooks) want PROSE — inline markers out,
// headings/bullets become plain lines.

export function stripMarkdown(md) {
  if (typeof md !== 'string') return '';
  return md
    // images + links: keep the text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // headings/bold/italic/inline-code markers
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // blockquotes + horizontal rules
    .replace(/^>\s?/gm, '')
    .replace(/^(-{3,}|\*{3,})$/gm, '')
    // list markers become dashes-of-prose
    .replace(/^\s*[-*+]\s+/gm, '\u2022 ')
    .trim();
}
