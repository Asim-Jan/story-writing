import { chapterHeading } from '../utils/chapters.js';

// Find the passages of a book that mention someone (or somewhere): every
// mention of any of its names, with the text around it, merged where they
// overlap. Enhancing a profile reads these instead of the whole book, so a
// minor character costs one short call and a lead is sampled across the book.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

// chapter content may be the editor's HTML: read it as plain text
export function plainText(s) {
  const text = String(s || '');
  if (!/<\/?[a-z][^>]*>/i.test(text)) return text;
  return text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, '\n\n');
}

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'doctor', 'sir', 'dame', 'lady', 'lord', 'captain', 'professor', 'prof', 'uncle', 'aunt', 'auntie',
  'king', 'queen', 'prince', 'princess', 'the', 'of', 'de', 'la', 'le', 'van', 'von', 'der', 'jr', 'sr']);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The names a person goes by: the full name, its parts (first name, surname), aliases. */
export function nameVariants(name, aliases = []) {
  const full = clean(name);
  const out = new Set([full, ...(Array.isArray(aliases) ? aliases : []).map(clean)].filter(v => v.length >= 2));
  const parts = full.split(' ').filter(p => p.length >= 3 && !HONORIFICS.has(p.toLowerCase().replace(/\.$/, '')));
  if (parts.length > 1) parts.forEach(p => out.add(p));
  return [...out];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// widen a span to the nearest paragraph (or sentence) edge, within reason
function snap(text, start, end) {
  const back = text.lastIndexOf('\n', start);
  const s = back !== -1 && start - back < 400 ? back + 1 : Math.max(0, text.lastIndexOf('. ', start) + 2);
  const fwd = text.indexOf('\n', end);
  const e = fwd !== -1 && fwd - end < 400 ? fwd : (text.indexOf('. ', end) === -1 ? text.length : text.indexOf('. ', end) + 1);
  return [s, Math.min(text.length, e)];
}

/**
 * chapters: [{number, title, content}]. Names are matched as whole words, case
 * sensitive (they are proper nouns: "Will" the person, not "will").
 * Returns { passages: [{chapter, heading, text}], mentions, chapters: [numbers], sampled }.
 * Over `budget` characters, passages are sampled evenly across the book, always
 * keeping the first few (where a character is usually introduced and described).
 */
export function findPassages(chapters, variants, { radius = 900, budget = 160000 } = {}) {
  const names = [...new Set(variants.map(clean).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!names.length) return { passages: [], mentions: 0, chapters: [], sampled: false };
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const passages = [];
  const seenIn = [];
  let mentions = 0;
  (chapters || []).forEach((c, i) => {
    const text = plainText(c.content);
    const spans = [];
    for (const m of text.matchAll(re)) {
      mentions++;
      const [s, e] = snap(text, Math.max(0, m.index - radius), Math.min(text.length, m.index + m[0].length + radius));
      const last = spans[spans.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else spans.push([s, e]);
    }
    if (!spans.length) return;
    const number = c.number ?? i + 1;
    seenIn.push(number);
    for (const [s, e] of spans) passages.push({ chapter: number, heading: chapterHeading(c, i + 1), text: text.slice(s, e).trim() });
  });

  const total = passages.reduce((n, p) => n + p.text.length, 0);
  if (total <= budget) return { passages, mentions, chapters: seenIn, sampled: false };
  const FIRST = 3;
  const avg = total / passages.length;
  const want = Math.max(FIRST + 1, Math.floor(budget / avg));
  const keep = new Set(passages.slice(0, FIRST).map((_, i) => i));
  const rest = passages.length - FIRST;
  const slots = want - FIRST;
  for (let j = 0; j < slots; j++) keep.add(FIRST + Math.round((j * (rest - 1)) / Math.max(1, slots - 1)));
  const out = [];
  let used = 0;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (used + passages[i].text.length > budget && out.length) continue;
    out.push(passages[i]);
    used += passages[i].text.length;
  }
  return { passages: out, mentions, chapters: seenIn, sampled: true };
}

/** Group passages, in order, into batches of at most `size` characters. */
export function batchPassages(passages, size = 40000) {
  const batches = [];
  let cur = [];
  let len = 0;
  for (const p of passages) {
    const block = `[#${p.chapter} ${p.heading}]\n${p.text.slice(0, size)}`;
    if (cur.length && len + block.length > size) { batches.push(cur.join('\n\n---\n\n')); cur = []; len = 0; }
    cur.push(block);
    len += block.length + 7;
  }
  if (cur.length) batches.push(cur.join('\n\n---\n\n'));
  return batches;
}
