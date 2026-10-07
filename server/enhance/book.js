import { askJson } from '../import/analyze.js';
import { chapterHeading } from '../utils/chapters.js';
import { plainText } from './passages.js';
import { norm, same, fieldSuggestions } from './common.js';

// Fill Book Info (genre, audience, tagline, blurb) from the book: one call over
// a digest of the chapters, their saved summaries where they have one (an
// import writes them), else the start and end of their text. Same suggestion
// contract as characters and locations, stored on book.metadata.

export const SHORT_FIELDS = ['genre', 'targetAudience'];
export const LONG_FIELDS = ['tagline', 'blurb']; // tagline: longer than a short field's 80 characters
export const AUDIENCES = ['children', 'young-adult', 'adult', 'all-ages'];

const DIGEST_CHARS = 60000;

export function bookDigest(chapters, budget = DIGEST_CHARS) {
  const rows = (chapters || []).map((c, i) => {
    const summary = norm(c.summary);
    const text = norm(plainText(c.content));
    if (!summary && !text) return null;
    const body = summary || (text.length > 1600 ? `${text.slice(0, 1200)} [...] ${text.slice(-400)}` : text);
    return `${chapterHeading(c, i + 1)}: ${body}`;
  }).filter(Boolean);
  const total = rows.reduce((n, r) => n + r.length, 0);
  if (total <= budget) return rows.join('\n\n');
  // too long: rows trimmed to fit; with very many chapters, an even sample of
  // them, so the end of the book is never the part that is cut
  const MIN = 300;
  const keep = Math.min(rows.length, Math.floor(budget / MIN));
  const picked = keep === rows.length ? rows : Array.from({ length: keep }, (_, j) => rows[Math.round((j * (rows.length - 1)) / Math.max(1, keep - 1))]);
  const each = Math.floor(budget / picked.length) - 8;
  return picked.map(r => (r.length > each ? `${r.slice(0, each)} [...]` : r)).join('\n\n');
}

const PROMPT = `You write the catalogue details of a novel from a digest of its chapters. JSON only:
{"genre": "", "targetAudience": "${AUDIENCES.join('|')}", "tagline": "", "blurb": ""}
Rules:
- genre: the genre and subgenre as a bookshop would shelve it, a few words (e.g. "Contemporary romance, academic rom-com").
- targetAudience: one of ${AUDIENCES.join(', ')}, from the content and the age of the main characters.
- tagline: one line, under 20 words, that makes someone want to read it.
- blurb: a back cover blurb of 120 to 200 words, in the present tense: who the main character is, what they want, what stands in the way, and the stakes. Use the characters' names. NEVER reveal the ending, late twists, or who ends up with whom.
- The CURRENT details were written by the author: if one is already good, return it unchanged.
- Use only what the digest supports.`;

const audienceOf = (v) => {
  const s = norm(v).toLowerCase().replace(/[\s_]+/g, '-');
  if (AUDIENCES.includes(s)) return s;
  if (/young|ya|teen/.test(s)) return 'young-adult';
  if (/child|kid|middle-grade/.test(s)) return 'children';
  if (/all/.test(s)) return 'all-ages';
  if (/adult/.test(s)) return 'adult';
  return '';
};

/**
 * book: the SAVED book ({title, overview, chapters, characters}).
 * item: the Book Info as the author has it now ({genre, targetAudience, tagline, blurb}).
 * Returns { suggestions, relationships: [], aliases: [], read: {chapters, summaries} }.
 */
export async function enhanceBookInfo({ book, item = {}, report = async () => {} }) {
  const chapters = book.chapters || [];
  const digest = bookDigest(chapters);
  if (!digest) throw Object.assign(new Error('The book has no saved chapter text to read yet'), { status: 422 });
  await report({ message: 'Reading the chapter summaries', current: 0, total: 1 });
  const cast = (book.characters || []).slice(0, 12).map(c => `${norm(c.name)}${c.role ? ` (${norm(c.role)})` : ''}`).join(', ');
  const current = Object.fromEntries([...SHORT_FIELDS, ...LONG_FIELDS].map(f => [f, norm(item[f])]).filter(([, v]) => v));
  const profile = await askJson(PROMPT, [
    `Title: ${norm(book.title) || 'Untitled'}`,
    book.overview ? `Overview: ${norm(book.overview).slice(0, 3000)}` : '',
    cast ? `Main characters: ${cast}` : '',
    `CURRENT details: ${JSON.stringify(current)}`,
    `Chapters (${chapters.length}):\n${digest}`,
  ].filter(Boolean).join('\n\n'), 2000);
  profile.targetAudience = audienceOf(profile.targetAudience);
  const suggestions = fieldSuggestions(profile, item, SHORT_FIELDS, LONG_FIELDS)
    .filter(s => !(s.field === 'targetAudience' && same(s.value, item.targetAudience)));
  return {
    suggestions,
    relationships: [],
    aliases: [],
    read: { chapters: chapters.filter(c => norm(c.summary) || norm(c.content)).length, summaries: chapters.filter(c => norm(c.summary)).length },
  };
}
