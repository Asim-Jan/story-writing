import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { cleanText, decodeText, htmlToText } from './text.js';

// Word, Markdown, PDF and plain text → sections. Structure first (heading
// styles, '#' headings), patterns second. The AI detector (detect.js) runs
// later only when nothing here finds the chapters. Text is never dropped:
// whatever precedes the first heading becomes its own section.

// A line that is a chapter heading on its own: "Chapter 12", "CHAPTER TWELVE",
// "Chapter 3: The Storm", "Part One", "Prologue", "Epilogue", "XIV".
const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty';
const HEADING = new RegExp(
  `^(?:(?:chapter|ch\\.|part|book)\\s+(?:\\d{1,3}|[ivxlcdm]{1,7}|(?:${NUMBER_WORDS})(?:[- ](?:${NUMBER_WORDS}))?)\\b[.:\\-–—]?\\s*.{0,80}`
  + '|(?:prologue|epilogue|interlude|afterword|foreword|preface)\\b[.:\\-–—]?\\s*.{0,80}'
  + '|[IVXLC]{1,7}\\.?)$',
  'i'
);

function looksLikeHeading(line) {
  const t = line.trim();
  return t.length > 0 && t.length <= 90 && HEADING.test(t) && !/[,;]\s*$/.test(t);
}

/** Split plain text on heading lines; text before the first heading is kept. */
export function splitOnPatterns(text) {
  const paragraphs = cleanText(text).split(/\n\n+/);
  const sections = [];
  let current = { title: null, parts: [], source: 'pattern' };
  for (const para of paragraphs) {
    const firstLine = para.split('\n')[0];
    if (looksLikeHeading(firstLine)) {
      if (current.parts.length || current.title) sections.push(current);
      const rest = para.split('\n').slice(1).join('\n').trim();
      current = { title: firstLine.trim(), parts: rest ? [rest] : [], source: 'pattern' };
    } else {
      current.parts.push(para);
    }
  }
  if (current.parts.length || current.title) sections.push(current);
  return sections.map(s => ({ title: s.title, content: s.parts.join('\n\n'), source: s.title ? s.source : 'whole' }));
}

/** Split an HTML document on h1/h2 (Word heading styles, Markdown #/##). */
function splitHtmlOnHeadings(html) {
  const $ = cheerio.load(html);
  const blocks = $('body').length ? $('body').children().toArray() : $.root().children().toArray();
  const level = $('h1').length >= 2 ? 'h1' : $('h2').length >= 2 ? 'h2' : null;
  if (!level) return null;
  const sections = [];
  let current = { title: null, html: [] };
  for (const el of blocks) {
    if (el.tagName === level) {
      if (current.html.length || current.title) sections.push(current);
      current = { title: cleanText($(el).text()), html: [] };
    } else {
      current.html.push($.html(el));
    }
  }
  if (current.html.length || current.title) sections.push(current);
  return sections.map(s => ({ title: s.title, content: htmlToText(s.html.join('\n')), source: s.title ? 'heading' : 'whole' }));
}

export async function parseDocx(buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const fromHeadings = splitHtmlOnHeadings(html);
  if (fromHeadings) return { sections: fromHeadings, warnings: [] };
  return { sections: splitOnPatterns(htmlToText(html)), warnings: [] };
}

export function parseMarkdown(buffer) {
  const text = decodeText(buffer);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const marker = lines.filter(l => /^#\s+\S/.test(l)).length >= 2 ? /^#\s+(.*)$/ : lines.filter(l => /^##\s+\S/.test(l)).length >= 2 ? /^##\s+(.*)$/ : null;
  if (!marker) return { sections: splitOnPatterns(text), warnings: [] };
  const sections = [];
  let current = { title: null, lines: [] };
  for (const line of lines) {
    const m = marker.exec(line);
    if (m) {
      if (current.lines.join('').trim() || current.title) sections.push(current);
      current = { title: m[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim() || current.title) sections.push(current);
  return {
    sections: sections.map(s => ({ title: s.title, content: cleanText(s.lines.join('\n')), source: s.title ? 'heading' : 'whole' })),
    warnings: [],
  };
}

export function parsePlainText(buffer) {
  return { sections: splitOnPatterns(decodeText(buffer)), warnings: [] };
}

/**
 * PDF: text per page, then page furniture removed: page numbers, and running
 * headers/footers (the same short line on many pages). Paragraphs that a page
 * break cut in two are joined again.
 */
export async function parsePdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy?.();
  const pages = (result.pages || []).map(p => p.text || '');
  const pageTexts = pages.length ? pages : String(result.text || '').split('\f');

  const counts = new Map();
  for (const page of pageTexts) {
    const lines = page.split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of new Set([...lines.slice(0, 2), ...lines.slice(-2)])) {
      if (l.length <= 80) counts.set(l, (counts.get(l) || 0) + 1);
    }
  }
  const repeated = new Set([...counts].filter(([, n]) => n >= Math.max(3, pageTexts.length * 0.3)).map(([l]) => l));
  let removedNumbers = 0;
  let removedHeaders = 0;
  const cleaned = pageTexts.map(page => page.split('\n').filter(line => {
    const t = line.trim();
    if (/^(page\s+)?\d{1,4}(\s+of\s+\d{1,4})?$/i.test(t) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(t)) { removedNumbers++; return false; }
    if (repeated.has(t)) { removedHeaders++; return false; }
    return true;
  }).join('\n'));

  // a page that ends mid-sentence continues on the next
  let text = '';
  for (const page of cleaned) {
    const t = page.trim();
    if (!t) continue;
    text = !text ? t : /[.!?"”’)]$/.test(text) ? `${text}\n\n${t}` : `${text} ${t}`;
  }
  const warnings = [];
  if (removedNumbers) warnings.push(`Removed ${removedNumbers} page numbers`);
  if (removedHeaders) warnings.push(`Removed ${removedHeaders} repeated page headers or footers`);
  return { sections: splitOnPatterns(text), warnings };
}
