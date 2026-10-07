import { askJson } from '../import/analyze.js';
import { plainText, nameVariants } from './passages.js';
import { placeVariants } from './location.js';
import { norm, cap } from './common.js';

// Find the people and places the book names that are not in its Characters or
// Locations lists (the import keeps a big cast's main people only). Code
// collects the capitalised names that recur mid-sentence (a name at the start
// of a sentence proves nothing: "Then", "She"); one sai-chat-fast call sorts
// them into people, places and other words, and merges forms of one name.

const MIN_MENTIONS = 3;
const MIN_MID = 2;          // times seen mid-sentence
const MAX_CANDIDATES = 150;
const STOP = new Set(['I', 'I\'m', 'I\'d', 'I\'ll', 'I\'ve', 'OK', 'Okay', 'God', 'Mom', 'Dad', 'Mum', 'Mr', 'Mrs', 'Ms', 'Dr', 'Sir', 'Madam', 'Miss',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December', 'Christmas', 'English', 'Chapter', 'The', 'A', 'An']);
const NAME = /[A-Z][\p{Ll}'’-]+(?:\s+(?:(?:of|the|de|van|von|la|le|du|del)\s+)?[A-Z][\p{Ll}'’-]+)*/gu;

/** [{name, mentions, mid, chapters, example}] most mentioned first, none already known. */
export function nameCandidates(chapters, known) {
  const knownLower = new Set(known.map(k => k.toLowerCase()));
  const found = new Map();
  (chapters || []).forEach((c, i) => {
    const text = plainText(c.content);
    for (const m of text.matchAll(NAME)) {
      let words = m[0].replace(/['’]s$/, '').split(/\s+/);
      let at = m.index;
      const before = text.slice(Math.max(0, at - 3), at);
      let mid = !/(^|[.!?…"“”'‘’:—–\n])\s*$/.test(before) && at > 0;
      // a sentence's first word is capitalised anyway ("Then Malcolm", "The
      // Gates Building"): drop it, and drop words that are never names
      if (!mid && words.length > 1) { at += words[0].length + 1; words = words.slice(1); }
      while (words.length > 1 && STOP.has(words[0])) { at += words[0].length + 1; words = words.slice(1); }
      const name = words.join(' ');
      if (name.length < 3 || STOP.has(name) || knownLower.has(name.toLowerCase())) continue;
      const row = found.get(name) || { name, mentions: 0, mid: 0, chapters: new Set(), example: '' };
      row.mentions++;
      if (mid) {
        row.mid++;
        if (!row.example) row.example = text.slice(Math.max(0, at - 110), at + name.length + 110).replace(/\s+/g, ' ').trim();
      }
      row.chapters.add(c.number ?? i + 1);
      found.set(name, row);
    }
  });
  return [...found.values()]
    .filter(r => r.mentions >= MIN_MENTIONS && r.mid >= MIN_MID)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, MAX_CANDIDATES)
    .map(r => ({ ...r, chapters: [...r.chapters] }));
}

const PROMPT = `You sort the capitalised names found in a novel. Each line is: [i] Name | times named | chapters | an example of it in use.
JSON only: {"people": [{"name": "the fullest form used", "from": [i, ...], "role": "supporting|minor", "description": "who they are, one sentence"}],
 "places": [{"name": "", "from": [i], "type": "city|town|building|room|street|region|landscape|...", "description": "what it is, one sentence"}]}
- people: characters who appear or are talked about. Merge the forms of ONE person ("Aslan", "Dr. Aslan") into one entry listing all their [i].
- places: real or invented places where something can happen.
- Leave out everything else: organisations, brands, titles of works, nationalities, languages, events, ranks, words that are only capitalised.
- Use only what the examples show. Never invent a name.`;

/**
 * book: the SAVED book. Returns { people: [...], places: [...], read: {candidates, chapters} }
 * each entry { name, role|type, description, mentions, chapters, firstChapter }.
 */
export async function findMissing({ book, report = async () => {} }) {
  const chapters = book.chapters || [];
  const known = [
    ...(book.characters || []).flatMap(c => nameVariants(c.name, c.aliases)),
    ...(book.locations || []).flatMap(l => placeVariants(l.name, l.aliases)),
  ];
  await report({ message: 'Collecting the names the book uses', current: 0, total: 2 });
  const candidates = nameCandidates(chapters, known);
  const read = { candidates: candidates.length, chapters: chapters.filter(c => norm(c.content)).length };
  if (!candidates.length) return { people: [], places: [], read };
  await report({ message: `Sorting ${candidates.length} names into people and places`, current: 1, total: 2 });
  const lines = candidates.map((c, i) => `[${i}] ${c.name} | ${c.mentions} | ${c.chapters.slice(0, 6).join(',')}${c.chapters.length > 6 ? ',...' : ''} | ${cap(c.example, 240)}`);
  const out = await askJson(PROMPT, `Book: ${norm(book.title) || 'Untitled'}\n\n${lines.join('\n')}`, 4000);

  const used = new Set();
  const knownLower = new Set(known.map(k => k.toLowerCase()));
  const build = (row, extra) => {
    const from = [...new Set((Array.isArray(row?.from) ? row.from : []).map(Number).filter(i => Number.isInteger(i) && candidates[i] && !used.has(i)))];
    const name = cap(row?.name, 80);
    if (!from.length || !name || knownLower.has(name.toLowerCase())) return null;
    // the name must be one the book uses: a candidate, or one containing one
    if (!from.some(i => name.toLowerCase().includes(candidates[i].name.toLowerCase()))) return null;
    from.forEach(i => used.add(i));
    const chs = [...new Set(from.flatMap(i => candidates[i].chapters))].sort((a, b) => Number(a) - Number(b));
    return { name, ...extra, description: cap(row.description, 300), mentions: from.reduce((n, i) => n + candidates[i].mentions, 0), chapters: chs, firstChapter: chs[0] ?? null };
  };
  const people = (Array.isArray(out.people) ? out.people : [])
    .map(p => build(p, { role: ['supporting', 'minor'].includes(p?.role) ? p.role : 'minor' })).filter(Boolean);
  const places = (Array.isArray(out.places) ? out.places : [])
    .map(p => build(p, { type: cap(p?.type, 40) })).filter(Boolean);
  const byMentions = (a, b) => b.mentions - a.mentions;
  return { people: people.sort(byMentions).slice(0, 60), places: places.sort(byMentions).slice(0, 60), read };
}
