// "Enhance from the book": a job (type 'enhance') reads the passages that
// mention a character and returns suggestions. They are kept ON the character
// (character.enhancement) until the author uses or skips each one, so they
// survive a reload and the job can be acknowledged after the next save.
//
// character.enhancement = { jobId, at, read, suggestions: [{field, value, chapters}],
//                           relationships: [{characterId, name, type, description}],
//                           aliases: [string], closed }

export const FIELD_LABELS = {
  role: 'Role', age: 'Age', gender: 'Gender', skinColor: 'Skin', hairColor: 'Hair', eyeColor: 'Eyes',
  height: 'Height', weight: 'Weight', build: 'Build', appearance: 'Appearance details', background: 'Background',
  personality: 'Personality', arc: 'Character arc', motivations: 'Motivations', fears: 'Fears & vulnerabilities',
  quirks: 'Quirks & mannerisms',
};
export const LONG_FIELDS = new Set(['appearance', 'background', 'personality', 'arc', 'motivations', 'fears', 'quirks']);

const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const RECIPROCAL = { Parent: 'Child', Child: 'Parent', Mentor: 'Student', Student: 'Mentor' };

export const openItems = (enhancement) => {
  if (!enhancement || enhancement.closed) return 0;
  return (enhancement.suggestions || []).length + (enhancement.relationships || []).length + (enhancement.aliases || []).length;
};

// A finished job onto its character. Suggestions the character already
// matches (the author typed the same meanwhile) are dropped. Applying the same
// job twice returns the SAME book.
export const applyEnhanceJob = (book, job) => {
  const r = job.result;
  if (!r || !Array.isArray(r.suggestions)) return book;
  const characters = book.characters || [];
  const character = characters.find(c => sameId(c.id, job.target?.id));
  if (!character || character.enhancement?.jobId === job.jobId) return book;
  const has = new Set((character.relationships || []).map(x => String(x.characterId)));
  const aliases = new Set([character.name, ...(character.aliases || [])].map(norm));
  const enhancement = {
    jobId: job.jobId,
    at: job.finishedAt || new Date().toISOString(),
    read: r.read || null,
    suggestions: r.suggestions.filter(s => FIELD_LABELS[s?.field] && s.value && norm(s.value) !== norm(character[s.field])),
    relationships: (r.relationships || []).filter(x => x?.characterId != null && !has.has(String(x.characterId))
      && characters.some(c => sameId(c.id, x.characterId))),
    aliases: (r.aliases || []).filter(a => a && !aliases.has(norm(a))),
    closed: false,
  };
  return { ...book, characters: characters.map(c => (c === character ? { ...c, enhancement } : c)) };
};

/**
 * Use or skip some of a character's suggestions. items:
 *   {kind: 'field', field, value?}   value overrides the suggestion (edited by the author)
 *   {kind: 'relationship', characterId}
 *   {kind: 'alias', value}
 * Or items = 'all'. A used relationship is added both ways, as the form does.
 */
export const resolveEnhancement = (book, characterId, items, use) => {
  const characters = book.characters || [];
  const character = characters.find(c => sameId(c.id, characterId));
  const enh = character?.enhancement;
  if (!enh) return book;
  const list = items === 'all'
    ? [
      ...(enh.suggestions || []).map(s => ({ kind: 'field', field: s.field })),
      ...(enh.relationships || []).map(x => ({ kind: 'relationship', characterId: x.characterId })),
      ...(enh.aliases || []).map(a => ({ kind: 'alias', value: a })),
    ]
    : items;

  let next = { ...character };
  let suggestions = enh.suggestions || [];
  let relationships = enh.relationships || [];
  let aliases = enh.aliases || [];
  const reciprocals = [];
  for (const item of list) {
    if (item.kind === 'field') {
      const s = suggestions.find(x => x.field === item.field);
      if (!s) continue;
      suggestions = suggestions.filter(x => x !== s);
      if (use) next[s.field] = item.value !== undefined ? item.value : s.value;
    } else if (item.kind === 'relationship') {
      const rel = relationships.find(x => sameId(x.characterId, item.characterId));
      if (!rel) continue;
      relationships = relationships.filter(x => x !== rel);
      if (use && !(next.relationships || []).some(x => sameId(x.characterId, rel.characterId))) {
        next.relationships = [...(next.relationships || []), { characterId: rel.characterId, type: rel.type, description: rel.description || '' }];
        reciprocals.push(rel);
      }
    } else if (item.kind === 'alias') {
      if (!aliases.includes(item.value)) continue;
      aliases = aliases.filter(a => a !== item.value);
      if (use && !(next.aliases || []).some(a => norm(a) === norm(item.value))) next.aliases = [...(next.aliases || []), item.value];
    }
  }
  const left = suggestions.length + relationships.length + aliases.length;
  next.enhancement = { ...enh, suggestions, relationships, aliases, closed: left === 0 };

  return {
    ...book,
    characters: characters.map(c => {
      if (c === character) return next;
      const rel = reciprocals.find(x => sameId(x.characterId, c.id));
      if (!rel || (c.relationships || []).some(x => sameId(x.characterId, character.id))) return c;
      return { ...c, relationships: [...(c.relationships || []), { characterId: character.id, type: RECIPROCAL[rel.type] || rel.type, description: rel.description ? `Reciprocal: ${rel.description}` : '' }] };
    }),
  };
};

// Close the panel (when it found nothing, or the author is done with it).
export const closeEnhancement = (book, characterId) => ({
  ...book,
  characters: (book.characters || []).map(c => (sameId(c.id, characterId) && c.enhancement ? { ...c, enhancement: { ...c.enhancement, suggestions: [], relationships: [], aliases: [], closed: true } } : c)),
});

// What the enhance job is sent: the profile as the author has it now.
export const enhanceParams = (character) => ({
  character: Object.fromEntries(['name', 'aliases', 'relationships', ...Object.keys(FIELD_LABELS)]
    .filter(k => character[k] !== undefined && character[k] !== null && character[k] !== '')
    .map(k => [k, k === 'relationships' ? (character.relationships || []).map(r => ({ characterId: r.characterId, type: r.type })) : character[k]])),
});
