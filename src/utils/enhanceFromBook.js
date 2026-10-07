// "Enhance from the book": a job (type 'enhance') reads the passages that
// mention a character or a location and returns suggestions. They are kept ON
// the item (item.enhancement) until the author uses or skips each one, so they
// survive a reload and the job can be acknowledged after the next save.
//
// item.enhancement = { jobId, at, read, suggestions: [{field, value, chapters}],
//                      relationships: [{characterId, name, type, description}] (characters),
//                      aliases: [string], closed }

export const ENHANCE_KINDS = {
  character: {
    collection: 'characters',
    labels: {
      role: 'Role', age: 'Age', gender: 'Gender', skinColor: 'Skin', hairColor: 'Hair', eyeColor: 'Eyes',
      height: 'Height', weight: 'Weight', build: 'Build', appearance: 'Appearance details', background: 'Background',
      personality: 'Personality', arc: 'Character arc', motivations: 'Motivations', fears: 'Fears & vulnerabilities',
      quirks: 'Quirks & mannerisms',
    },
    long: new Set(['appearance', 'background', 'personality', 'arc', 'motivations', 'fears', 'quirks']),
  },
  location: {
    collection: 'locations',
    labels: {
      type: 'Type', description: 'Description', atmosphere: 'Atmosphere & mood', history: 'History & background', significance: 'Story significance',
    },
    long: new Set(['description', 'atmosphere', 'history', 'significance']),
  },
};

const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const RECIPROCAL = { Parent: 'Child', Child: 'Parent', Mentor: 'Student', Student: 'Mentor' };

export const openItems = (enhancement) => {
  if (!enhancement || enhancement.closed) return 0;
  return (enhancement.suggestions || []).length + (enhancement.relationships || []).length + (enhancement.aliases || []).length;
};

// A finished job onto its character or location. Suggestions the item
// already matches (the author typed the same meanwhile) are dropped. Applying
// the same job twice returns the SAME book.
export const applyEnhanceJob = (book, job) => {
  const r = job.result;
  const kind = ENHANCE_KINDS[job.target?.type];
  if (!kind || !r || !Array.isArray(r.suggestions)) return book;
  const list = book[kind.collection] || [];
  const item = list.find(c => sameId(c.id, job.target?.id));
  if (!item || item.enhancement?.jobId === job.jobId) return book;
  const characters = book.characters || [];
  const has = new Set((item.relationships || []).map(x => String(x.characterId)));
  const aliases = new Set([item.name, ...(item.aliases || [])].map(norm));
  const enhancement = {
    jobId: job.jobId,
    at: job.finishedAt || new Date().toISOString(),
    read: r.read || null,
    suggestions: r.suggestions.filter(s => kind.labels[s?.field] && s.value && norm(s.value) !== norm(item[s.field])),
    relationships: job.target.type !== 'character' ? [] : (r.relationships || []).filter(x => x?.characterId != null && !has.has(String(x.characterId))
      && characters.some(c => sameId(c.id, x.characterId))),
    aliases: (r.aliases || []).filter(a => a && !aliases.has(norm(a))),
    closed: false,
  };
  return { ...book, [kind.collection]: list.map(c => (c === item ? { ...c, enhancement } : c)) };
};

/**
 * Use or skip some of an item's suggestions (kind: 'character' | 'location'). items:
 *   {kind: 'field', field, value?}   value overrides the suggestion (edited by the author)
 *   {kind: 'relationship', characterId}
 *   {kind: 'alias', value}
 * Or items = 'all'. A used relationship is added both ways, as the form does.
 */
export const resolveEnhancement = (book, kind, id, items, use) => {
  const { collection } = ENHANCE_KINDS[kind];
  const characters = book[collection] || [];
  const character = characters.find(c => sameId(c.id, id));
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
    [collection]: characters.map(c => {
      if (c === character) return next;
      const rel = reciprocals.find(x => sameId(x.characterId, c.id));
      if (!rel || (c.relationships || []).some(x => sameId(x.characterId, character.id))) return c;
      return { ...c, relationships: [...(c.relationships || []), { characterId: character.id, type: RECIPROCAL[rel.type] || rel.type, description: rel.description ? `Reciprocal: ${rel.description}` : '' }] };
    }),
  };
};

// Close the panel (when it found nothing, or the author is done with it).
export const closeEnhancement = (book, kind, id) => {
  const { collection } = ENHANCE_KINDS[kind];
  return {
    ...book,
    [collection]: (book[collection] || []).map(c => (sameId(c.id, id) && c.enhancement ? { ...c, enhancement: { ...c.enhancement, suggestions: [], relationships: [], aliases: [], closed: true } } : c)),
  };
};

// What the enhance job is sent: the profile as the author has it now.
export const enhanceParams = (kind, item) => ({
  item: Object.fromEntries(['name', 'aliases', 'relationships', ...Object.keys(ENHANCE_KINDS[kind].labels)]
    .filter(k => item[k] !== undefined && item[k] !== null && item[k] !== '')
    .map(k => [k, k === 'relationships' ? (item.relationships || []).map(r => ({ characterId: r.characterId, type: r.type })) : item[k]])),
});
