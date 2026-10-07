import { askJson } from '../import/analyze.js';
import { findPassages, batchPassages } from './passages.js';

// The shared half of "enhance from the book" (characters, locations): read the
// passages that mention the item in batches, taking notes with sai-chat-fast,
// then turn the profile the model writes into per-field suggestions.

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
export const cap = (s, n) => (norm(s).length > n ? `${norm(s).slice(0, n - 1).replace(/\s+\S*$/, '')}...` : norm(s));
const BLANK = /^(n\/?a|none|unknown|not (stated|specified|mentioned|given)|unspecified|-)\.?$/i;
// the model explaining that there is nothing to say ("The book gives no history of...")
const NOTHING = /^(the (book|text|notes|story) (gives|does not|doesn't|never|says nothing|provides no|offers no|mentions no)|there is no (mention|information|detail|history|description)|no (\w+ ){0,2}(information|details|history|description) (is |are )?(given|provided|mentioned))/i;
const chapterList = (v) => [...new Set((Array.isArray(v) ? v : [v]).map(x => String(x ?? '').match(/\d+/)?.[0]).filter(Boolean).map(Number))].slice(0, 12);

/**
 * Find the passages for `variants`, take notes on each batch with
 * notesPrompt. Returns { facts: ['- [about] fact (chapter)'], read, steps }
 * (steps = the batches plus the profile, for progress).
 * Throws 422 when the chapters never mention the item.
 */
export async function takeNotes({ name, variants, chapters, title, notesPrompt, report }) {
  const found = findPassages(chapters, variants);
  const read = { mentions: found.mentions, chapters: found.chapters.length, passages: found.passages.length, sampled: found.sampled };
  if (!found.passages.length) {
    throw Object.assign(new Error(`"${name}" is not mentioned in the saved chapters`), { status: 422 });
  }
  const batches = batchPassages(found.passages);
  const facts = [];
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    await report({ message: `Reading the passages about ${name} (${i + 1} of ${batches.length})`, current: i, total: batches.length + 1 });
    try {
      const out = await askJson(notesPrompt, `Book: ${title || 'Untitled'}\n\n${batches[i]}`, 3000);
      for (const f of Array.isArray(out.facts) ? out.facts : []) {
        if (f?.fact) facts.push(`- [${f.about || 'other'}${f.with ? ` with ${f.with}` : ''}] ${cap(f.fact, 300)}${f.chapter ? ` (${cap(f.chapter, 40)})` : ''}`);
      }
    } catch (err) {
      failed++;
      console.warn(`enhance: notes batch ${i + 1} for "${name}" failed:`, err.message);
    }
  }
  if (failed === batches.length) throw new Error('The model could not read the passages');
  return { facts, read, steps: batches.length + 1 };
}

/** Ask for the profile; the model sees the current one and the notes. */
export async function writeProfile({ prompt, title, name, kind, item, fields, extra = [], facts, report, steps }) {
  await report({ message: `Writing the profile of ${name}`, current: steps - 1, total: steps });
  const current = Object.fromEntries(fields.map(f => [f, norm(item[f])]).filter(([, v]) => v));
  return askJson(prompt, [
    `Book: ${title || 'Untitled'}`,
    `${kind}: ${name}`,
    `CURRENT profile: ${JSON.stringify(current)}`,
    ...extra,
    `Notes (${facts.length}):`,
    facts.slice(0, 600).join('\n'),
  ].join('\n\n'), 4000);
}

/** One suggestion per field the profile would change: [{field, value, current, chapters}]. */
export function fieldSuggestions(profile, item, shortFields, longFields) {
  const sources = profile.sources && typeof profile.sources === 'object' ? profile.sources : {};
  const out = [];
  for (const field of [...shortFields, ...longFields]) {
    const raw = profile[field];
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const value = cap(raw, shortFields.includes(field) ? 80 : 1500);
    if (!value || BLANK.test(value) || NOTHING.test(value) || same(value, item[field])) continue;
    out.push({ field, value, current: norm(item[field]), chapters: chapterList(sources[field]) });
  }
  return out;
}

/** Other names: new ones only, not the name with a title added, not a note about someone else. */
export function newAliases(aliases, name, known) {
  const have = new Set(known.map(v => v.toLowerCase()));
  return [...new Set((Array.isArray(aliases) ? aliases : [])
    .map(a => cap(a, 60))
    .filter(a => a && !have.has(a.toLowerCase()) && !a.toLowerCase().includes(name.toLowerCase()) && !/[()]/.test(a)))].slice(0, 8);
}
