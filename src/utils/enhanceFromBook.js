// "Enhance from the book": a job (type 'enhance') reads the book and returns
// suggestions for a character, a location, a whole list of them ("Enhance
// all"), or the Book Info. They are kept ON the item (item.enhancement; for
// the Book Info, book.metadata.enhancement) until the author uses or skips each
// one, so they survive a reload and the job can be acknowledged after a save.
//
// item.enhancement = { jobId, at, read, suggestions: [{field, value, chapters}],
//                      relationships: [{characterId, name, type, description}] (characters),
//                      links: [{list, id, name}] (plotlines: linkedCharacters/Locations/Plotlines),
//                      aliases: [string], closed }

export const AUDIENCE_OPTIONS = [
  ['children', 'Children (5-12)'], ['young-adult', 'Young Adult (13-18)'], ['adult', 'Adult (18+)'], ['all-ages', 'All Ages'],
];

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
  plotline: {
    collection: 'plotlines',
    nameField: 'title',
    extra: ['chapters', 'linkedCharacters', 'linkedLocations', 'linkedPlotlines'],
    labels: { type: 'Type', description: 'Description', themes: 'Themes explored', conflicts: 'Key conflicts' },
    long: new Set(['description', 'themes', 'conflicts']),
    options: { type: [['main', 'Main Plot'], ['subplot', 'Subplot'], ['backstory', 'Backstory']] },
  },
  event: {
    collection: 'timelines',
    nameField: 'event',
    extra: ['chapter', 'chapterHint'],
    labels: { date: 'Date / time', location: 'Location', sceneType: 'Scene type', description: 'Description' },
    long: new Set(['description']),
    options: { sceneType: [['action', 'Action'], ['dialogue', 'Dialogue'], ['exposition', 'Exposition'], ['transition', 'Transition']] },
  },
  book: {
    collection: null, // the Book Info lives in book.metadata
    labels: { genre: 'Genre', targetAudience: 'Target audience', tagline: 'Tagline / hook', blurb: 'Back cover blurb' },
    long: new Set(['tagline', 'blurb']),
    options: { targetAudience: AUDIENCE_OPTIONS },
  },
};

// a list job's target type -> the kind of each item in it
export const BATCH_KINDS = { characters: 'character', locations: 'location', plotlines: 'plotline', timelines: 'event' };

// what an item is called (characters and locations have a name; a plotline a title, an event its event)
export const nameOf = (item) => item?.name || item?.title || item?.event || '';

// a plotline link's list -> the book collection it points into
const LINK_COLLECTIONS = { linkedCharacters: 'characters', linkedLocations: 'locations', linkedPlotlines: 'plotlines' };
export const LINK_LABELS = { linkedCharacters: 'People', linkedLocations: 'Places', linkedPlotlines: 'Related plotlines' };

const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const RECIPROCAL = { Parent: 'Child', Child: 'Parent', Mentor: 'Student', Student: 'Mentor' };

// The item a kind + id points at, and a way to replace it (same book when unchanged).
const getItem = (book, kind, id) => (kind === 'book'
  ? book.metadata || {}
  : (book[ENHANCE_KINDS[kind].collection] || []).find(c => sameId(c.id, id)));
const putItem = (book, kind, id, next) => (kind === 'book'
  ? { ...book, metadata: next }
  : { ...book, [ENHANCE_KINDS[kind].collection]: (book[ENHANCE_KINDS[kind].collection] || []).map(c => (sameId(c.id, id) ? next : c)) });

export const openItems = (enhancement) => {
  if (!enhancement || enhancement.closed) return 0;
  return (enhancement.suggestions || []).length + (enhancement.relationships || []).length + (enhancement.links || []).length + (enhancement.aliases || []).length;
};

// One item's result as its enhancement. In a list job an item with nothing new
// is recorded closed (no panel); on its own it shows "nothing new".
const enhancementFor = (book, kind, item, jobId, at, r, { quietWhenEmpty = false } = {}) => {
  const characters = book.characters || [];
  const has = new Set((item.relationships || []).map(x => String(x.characterId)));
  const names = new Set([item.name, ...(item.aliases || [])].filter(Boolean).map(norm));
  const e = {
    jobId,
    at,
    read: r.read || null,
    suggestions: (r.suggestions || []).filter(s => ENHANCE_KINDS[kind].labels[s?.field] && s.value && norm(s.value) !== norm(item[s.field])),
    relationships: kind !== 'character' ? [] : (r.relationships || []).filter(x => x?.characterId != null && !has.has(String(x.characterId))
      && characters.some(c => sameId(c.id, x.characterId))),
    links: (r.links || []).filter(l => LINK_COLLECTIONS[l?.list] && !(item[l.list] || []).some(id => sameId(id, l.id))
      && (book[LINK_COLLECTIONS[l.list]] || []).some(x => sameId(x.id, l.id))),
    aliases: (r.aliases || []).filter(a => a && !names.has(norm(a))),
    closed: false,
  };
  if (quietWhenEmpty && openItems(e) === 0) e.closed = true;
  return e;
};

// A finished job onto its item(s). Suggestions an item already matches (the
// author typed the same meanwhile) are dropped. Applying the same job twice
// returns the SAME book.
export const applyEnhanceJob = (book, job) => {
  const r = job.result;
  const type = job.target?.type;
  const at = job.finishedAt || new Date().toISOString();
  if (!r) return book;
  if (type === 'missing') return applyMissing(book, job, at);
  if (type === 'duplicates') return applyDuplicateCheck(book, job, at);
  if (BATCH_KINDS[type]) {
    const kind = BATCH_KINDS[type];
    let next = book;
    for (const [id, itemResult] of Object.entries(r.items || {})) {
      if (!Array.isArray(itemResult?.suggestions)) continue; // not in the book, or it failed
      const item = getItem(next, kind, id);
      if (!item || item.enhancement?.jobId === job.jobId) continue;
      next = putItem(next, kind, id, { ...item, enhancement: enhancementFor(next, kind, item, job.jobId, at, itemResult, { quietWhenEmpty: true }) });
    }
    return next;
  }
  if (!ENHANCE_KINDS[type] || !Array.isArray(r.suggestions)) return book;
  const item = getItem(book, type, job.target.id);
  if (!item || item.enhancement?.jobId === job.jobId) return book;
  return putItem(book, type, job.target.id, { ...item, enhancement: enhancementFor(book, type, item, job.jobId, at, r) });
};

/**
 * Use or skip some of an item's suggestions (kind: 'character' | 'location' | 'book'). items:
 *   {kind: 'field', field, value?}   value overrides the suggestion (edited by the author)
 *   {kind: 'relationship', characterId}
 *   {kind: 'alias', value}
 * Or items = 'all'. A used relationship is added both ways, as the form does.
 */
export const resolveEnhancement = (book, kind, id, items, use) => {
  const item = getItem(book, kind, id);
  const enh = item?.enhancement;
  if (!enh) return book;
  const list = items === 'all'
    ? [
      ...(enh.suggestions || []).map(s => ({ kind: 'field', field: s.field })),
      ...(enh.relationships || []).map(x => ({ kind: 'relationship', characterId: x.characterId })),
      ...(enh.links || []).map(l => ({ kind: 'link', list: l.list, id: l.id })),
      ...(enh.aliases || []).map(a => ({ kind: 'alias', value: a })),
    ]
    : items;

  const next = { ...item };
  let suggestions = enh.suggestions || [];
  let relationships = enh.relationships || [];
  let aliases = enh.aliases || [];
  let links = enh.links || [];
  const reciprocals = [];
  for (const it of list) {
    if (it.kind === 'field') {
      const s = suggestions.find(x => x.field === it.field);
      if (!s) continue;
      suggestions = suggestions.filter(x => x !== s);
      if (use) next[s.field] = it.value !== undefined ? it.value : s.value;
    } else if (it.kind === 'relationship') {
      const rel = relationships.find(x => sameId(x.characterId, it.characterId));
      if (!rel) continue;
      relationships = relationships.filter(x => x !== rel);
      if (use && !(next.relationships || []).some(x => sameId(x.characterId, rel.characterId))) {
        next.relationships = [...(next.relationships || []), { characterId: rel.characterId, type: rel.type, description: rel.description || '' }];
        reciprocals.push(rel);
      }
    } else if (it.kind === 'link') {
      const link = links.find(l => l.list === it.list && sameId(l.id, it.id));
      if (!link) continue;
      links = links.filter(l => l !== link);
      if (use && !(next[link.list] || []).some(id => sameId(id, link.id))) next[link.list] = [...(next[link.list] || []), link.id];
    } else if (it.kind === 'alias') {
      if (!aliases.includes(it.value)) continue;
      aliases = aliases.filter(a => a !== it.value);
      if (use && !(next.aliases || []).some(a => norm(a) === norm(it.value))) next.aliases = [...(next.aliases || []), it.value];
    }
  }
  const left = suggestions.length + relationships.length + links.length + aliases.length;
  next.enhancement = { ...enh, suggestions, relationships, links, aliases, closed: left === 0 };

  let out = putItem(book, kind, id, next);
  if (reciprocals.length) {
    out = {
      ...out,
      characters: out.characters.map(c => {
        const rel = reciprocals.find(x => sameId(x.characterId, c.id));
        if (!rel || (c.relationships || []).some(x => sameId(x.characterId, item.id))) return c;
        return { ...c, relationships: [...(c.relationships || []), { characterId: item.id, type: RECIPROCAL[rel.type] || rel.type, description: rel.description ? `Reciprocal: ${rel.description}` : '' }] };
      }),
    };
  }
  return out;
};

// Close the panel (when it found nothing, or the author is done with it).
export const closeEnhancement = (book, kind, id) => {
  const item = getItem(book, kind, id);
  if (!item?.enhancement) return book;
  return putItem(book, kind, id, { ...item, enhancement: { ...item.enhancement, suggestions: [], relationships: [], links: [], aliases: [], closed: true } });
};

// What an enhance job is sent: the profile as the author has it now.
export const enhanceParams = (kind, item) => {
  const def = ENHANCE_KINDS[kind];
  const keys = ['name', 'aliases', 'relationships', ...(def.nameField ? [def.nameField] : []), ...(def.extra || []), ...Object.keys(def.labels)];
  const out = Object.fromEntries(keys
    .filter(k => item[k] !== undefined && item[k] !== null && item[k] !== '')
    .map(k => [k, k === 'relationships' ? (item.relationships || []).map(r => ({ characterId: r.characterId, type: r.type })) : item[k]]));
  if (kind !== 'book' && nameOf(item)) out.name = nameOf(item);
  return { item: out };
};

// ...and for a list job, each one with its id.
export const enhanceAllParams = (kind, items) => ({
  items: items.map(it => ({ id: it.id, ...enhanceParams(kind, it).item })),
});

// Never enhanced (or never by a finished job): what "Enhance all" ticks by default.
export const neverEnhanced = (item) => !item?.enhancement?.jobId;

// ---- people and places the book names that are in neither list ----
// The finds wait on book.metadata.discoveries = { jobId, at, read, people, places }
// until the author adds or skips each one.

const known = (list) => new Set((list || []).flatMap(x => [x.name, ...(x.aliases || [])]).filter(Boolean).map(norm));
const DISCOVERY_LISTS = { people: 'characters', places: 'locations' };

const applyMissing = (book, job, at) => {
  const meta = book.metadata || {};
  if (meta.discoveries?.jobId === job.jobId) return book;
  const r = job.result || {};
  const fresh = (rows, list) => (Array.isArray(rows) ? rows : []).filter(x => x?.name && !known(book[list]).has(norm(x.name)));
  return {
    ...book,
    metadata: { ...meta, discoveries: { jobId: job.jobId, at, read: r.read || null, people: fresh(r.people, 'characters'), places: fresh(r.places, 'locations') } },
  };
};

// ---- one place listed twice (SAI's duplicate check) ----
// The pairs wait on book.metadata.duplicateCheck[kind] = { jobId, at, read, pairs }
// and show with the rule-found ones (utils/duplicates.js); a merge or "Not the
// same" settles each.
const applyDuplicateCheck = (book, job, at) => {
  const kind = job.target?.id;
  const meta = book.metadata || {};
  if (kind !== 'location' || meta.duplicateCheck?.[kind]?.jobId === job.jobId) return book;
  const r = job.result || {};
  const pairs = (Array.isArray(r.pairs) ? r.pairs : []).filter(p => p && p.keepId != null && p.dropId != null)
    .map(p => ({ keepId: p.keepId, dropId: p.dropId, reason: String(p.reason || '').slice(0, 200) }));
  return { ...book, metadata: { ...meta, duplicateCheck: { ...(meta.duplicateCheck || {}), [kind]: { jobId: job.jobId, at, read: r.read || null, pairs } } } };
};

let discoverySeq = 0;
const discoveryId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(discoverySeq++).toString(36)}`;

/** Add (or skip) found people/places: which = 'people' | 'places', names = [name] or 'all'. */
export const resolveDiscoveries = (book, which, names, add) => {
  const d = book.metadata?.discoveries;
  if (!d) return book;
  const rows = d[which] || [];
  const picked = names === 'all' ? rows : rows.filter(x => names.includes(x.name));
  if (!picked.length) return book;
  const next = { ...book, metadata: { ...book.metadata, discoveries: { ...d, [which]: rows.filter(x => !picked.includes(x)) } } };
  if (!add) return next;
  const list = DISCOVERY_LISTS[which];
  const have = known(book[list]);
  const created = picked.filter(x => !have.has(norm(x.name))).map(x => (which === 'people'
    ? { id: discoveryId('char'), name: x.name, role: x.role || 'minor', background: x.description || '', description: x.description || '',
      firstChapter: x.firstChapter ?? null, mentions: x.mentions ?? null, relationships: [], referenceImages: [], fromBook: true }
    : { id: discoveryId('loc'), name: x.name, type: x.type || '', description: x.description || '', significance: '', atmosphere: '', history: '',
      firstChapter: x.firstChapter ?? null, fromBook: true }));
  return { ...next, [list]: [...(book[list] || []), ...created] };
};
