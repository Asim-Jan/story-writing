import { askJson } from '../import/analyze.js';
import { norm, cap } from './common.js';

// "Check for duplicate locations": the rules in src/utils/duplicates.js catch
// one name written two ways; this asks sai-chat-fast to read every location's
// name, type and description and group the entries that are one place under
// different names ("Olive's apartment" and "the flat Olive shares with
// Malcolm"). It only suggests: the author merges or says "Not the same".

const MAX_PLACES = 300;

const PROMPT = `You check a novel's list of locations for duplicates: ONE place entered more than once under different names.
Each line is: [i] Name | type | other names | description.
JSON only: {"groups": [{"same": [i, j], "keep": i, "reason": "one short sentence: why these are the same place"}]}
- Group entries only when they are clearly the same place: the same building, room, town or landscape, named differently.
- A part of a place is NOT the place (a kitchen in a house, a room in a castle, a street in a city).
- Two places of the same kind are NOT the same (two different cafes, two characters' bedrooms).
- keep: the entry with the fullest, most specific name.
- If there are no duplicates, return {"groups": []}. Never guess.`;

/** book: the SAVED book. Returns { pairs: [{keepId, dropId, reason}], read: {locations} }. */
export async function checkPlaceDuplicates({ book, report = async () => {} }) {
  const all = (book.locations || []).filter(l => norm(l.name));
  const list = all.slice(0, MAX_PLACES);
  const read = { locations: list.length, of: all.length };
  if (list.length < 2) return { pairs: [], read };
  await report({ message: `Comparing ${list.length} locations`, current: 0, total: 1 });
  // alphabetical, so names written alike sit together
  const order = list.map((l, i) => i).sort((a, b) => norm(list[a].name).localeCompare(norm(list[b].name)));
  const lines = order.map((i, n) => {
    const l = list[i];
    const aliases = (Array.isArray(l.aliases) ? l.aliases : []).map(norm).filter(Boolean).join('; ');
    return `[${n}] ${cap(l.name, 80)} | ${cap(l.type, 40)} | ${cap(aliases, 120)} | ${cap(norm(l.description || l.significance), 220)}`;
  });
  const out = await askJson(PROMPT, `Book: ${norm(book.title) || 'Untitled'}\n\n${lines.join('\n')}`, 4000);

  const pairs = [];
  const seen = new Set();
  for (const g of Array.isArray(out.groups) ? out.groups : []) {
    const same = [...new Set((Array.isArray(g?.same) ? g.same : []).map(Number).filter(n => Number.isInteger(n) && order[n] !== undefined))];
    if (same.length < 2) continue;
    const keepN = same.includes(Number(g.keep)) ? Number(g.keep) : same[0];
    const keep = list[order[keepN]];
    for (const n of same) {
      const drop = list[order[n]];
      if (n === keepN || seen.has(String(drop.id))) continue;
      seen.add(String(drop.id));
      pairs.push({ keepId: keep.id, dropId: drop.id, reason: cap(g.reason, 200) });
    }
  }
  return { pairs: pairs.slice(0, 100), read };
}
