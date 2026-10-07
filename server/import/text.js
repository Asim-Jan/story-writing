import * as cheerio from 'cheerio';
import chardet from 'chardet';
import iconv from 'iconv-lite';

// Text helpers shared by every format.

/** Bytes → string: BOM stripped, encoding detected (UTF-8, UTF-16, Windows-1252...). */
export function decodeText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return iconv.decode(buffer.subarray(2), 'utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return iconv.decode(buffer.subarray(2), 'utf16be');
  const guess = chardet.detect(buffer) || 'UTF-8';
  const encoding = iconv.encodingExists(guess) ? guess : 'UTF-8';
  return iconv.decode(buffer, encoding);
}

/**
 * Normalise prose: Unicode NFC, unified line endings, no trailing spaces,
 * paragraphs separated by exactly one blank line. Never drops words.
 */
export function cleanText(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BLOCK = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr, section, article, header, footer, figcaption';

/** HTML/XHTML → plain text with paragraph breaks kept, entities decoded. */
export function htmlToText(html) {
  const $ = cheerio.load(html, { xmlMode: false, decodeEntities: true });
  $('script, style, head, nav[epub\\:type="toc"]').remove();
  $('br').replaceWith('\n');
  $(BLOCK).each((_, el) => {
    $(el).prepend('\n\n');
    $(el).append('\n\n');
  });
  return cleanText($('body').length ? $('body').text() : $.root().text());
}

export const wordCount = (text) => (String(text || '').match(/\S+/g) || []).length;

export function preview(text, n = 300) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}
