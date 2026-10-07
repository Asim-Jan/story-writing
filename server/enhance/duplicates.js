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
