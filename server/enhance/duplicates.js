import { nameVariants } from './passages.js';

// One person, two entries: "Olive" and "Olive Smith", "Aslan" and "Dr.
// Aslan". A name is a duplicate of another when it is one of that name's forms
// (first name, surname, without a title, an alias) and it fits ONE person
// only: with two Smiths in the cast, "Smith" stays as it is.

const lower = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const words = (s) => lower(s).split(' ').filter(Boolean).length;

/** For each entry whose name is a short form of exactly one other: [{ from, into }] (indexes). */
export function nameFormPairs(people) {
  const forms = people.map(p => new Set(nameVariants(p.name, p.aliases).map(lower)));
  const pairs = [];
  people.forEach((p, i) => {
    const n = lower(p.name);
    if (!n) return;
    const into = people
      .map((q, j) => j)
      .filter(j => j !== i && forms[j].has(n) && (words(people[j].name) > words(p.name) || lower(people[j].name).length > n.length));
    if (into.length === 1) pairs.push({ from: i, into: into[0] });
  });
  return pairs;
}

const ROLE_RANK = { protagonist: 4, antagonist: 3, supporting: 2, minor: 1 };
const longer = (a, b) => (String(b || '').length > String(a || '').length ? b : a);

/**
 * The import's cast ({name, role, description, appearance, firstChapter,
 * mentions}): merge each short form into its full name, shortest first, and
 * keep the short name as an alias.
 */
export function mergeNameForms(cast) {
  let list = cast.map(c => ({ ...c, aliases: [...(c.aliases || [])] }));
  for (;;) {
    const pair = nameFormPairs(list).sort((a, b) => words(list[a.from].name) - words(list[b.from].name))[0];
    if (!pair) return list;
    const from = list[pair.from];
    const into = list[pair.into];
    const merged = {
      ...into,
      role: (ROLE_RANK[from.role] || 0) > (ROLE_RANK[into.role] || 0) ? from.role : into.role,
      description: longer(into.description, from.description),
      appearance: longer(into.appearance, from.appearance),
      firstChapter: [into.firstChapter, from.firstChapter].filter(x => x != null).sort((a, b) => Number(a) - Number(b))[0] ?? null,
      mentions: (into.mentions || 0) + (from.mentions || 0),
      aliases: [...new Set([...into.aliases, ...from.aliases, from.name])],
    };
    list = list.map((c, i) => (i === pair.into ? merged : c)).filter((_, i) => i !== pair.from);
  }
}

// ---- places ----
// The words that tell places apart (mirrors placeWords in
// src/utils/duplicates.js, without resolving owners to characters): "The Lab
// (night)", "lab" and "Labs" are one key; "Main St." is "main street".
const VIEW_WORDS = new Set(['interior', 'exterior', 'inside', 'outside']);
const ABBREVIATIONS = { st: 'street', rd: 'road', ave: 'avenue', ln: 'lane', sq: 'square', blvd: 'boulevard' };
const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w);

export function placeKey(name) {
  let w = lower(name)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[’‘`']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[.,;:!?"“”]/g, ' ')
    .replace(/[-–—/]/g, ' ')
    .split(/\s+/).filter(Boolean);
  while (w.length > 1 && ['the', 'a', 'an'].includes(w[0])) w = w.slice(1);
  w = w.filter(x => !VIEW_WORDS.has(x)).map(singular);
  if (w.length > 1 && ABBREVIATIONS[w[w.length - 1]]) w[w.length - 1] = ABBREVIATIONS[w[w.length - 1]];
  return w.join(' ');
}

/** How much of a name is name: "(night)", "- interior" and "The" don't count. */
export const placeFullness = (name) => String(name || '').replace(/\s+/g, ' ').trim()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\b(interior|exterior|inside|outside)\b/gi, ' ')
  .replace(/^\s*(the|a|an)\s+/i, '').replace(/[\s:;,.–—-]+$/, '').trim().length;
