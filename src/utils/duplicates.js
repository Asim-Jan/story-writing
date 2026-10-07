// One person (or place), two entries: "Olive" and "Olive Smith", "Aslan" and
// "Dr. Aslan", "Gull Lighthouse" and "The Gull Lighthouse". Mirrors
// server/enhance/duplicates.js: a name is a duplicate of another when it is
// one of that name's forms and fits ONE entry only. The author decides: merge,
// or "not the same" (remembered in book.metadata.notDuplicates).

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'doctor', 'sir', 'dame', 'lady', 'lord', 'captain', 'professor', 'prof', 'uncle', 'aunt', 'auntie',
  'king', 'queen', 'prince', 'princess', 'the', 'of', 'de', 'la', 'le', 'van', 'von', 'der', 'jr', 'sr']);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const lower = (s) => clean(s).toLowerCase();
const words = (s) => lower(s).split(' ').filter(Boolean).length;
const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);

export const personForms = (name, aliases = []) => {
  const full = clean(name);
  const out = new Set([full, ...(aliases || []).map(clean)].filter(v => v.length >= 2));
  const all = full.split(' ');
  const bare = all.filter(p => !HONORIFICS.has(p.toLowerCase().replace(/\.$/, '')));
  if (bare.length && bare.length < all.length && bare.join(' ').length >= 3) out.add(bare.join(' '));
  const parts = bare.filter(p => p.length >= 3);
  if (parts.length > 1) parts.forEach(p => out.add(p));
  return [...out].map(lower);
};
export const placeForms = (name, aliases = []) => {
  const full = clean(name);
  const out = new Set([full, ...(aliases || []).map(clean)].filter(v => v.length >= 2));
  const bare = full.replace(/^the\s+/i, '');
  if (bare !== full && bare.length >= 4) out.add(bare);
  return [...out].map(lower);
};

const KINDS = {
  character: { collection: 'characters', forms: personForms },
  location: { collection: 'locations', forms: placeForms },
};
const pairKey = (kind, a, b) => `${kind}:${[String(a), String(b)].sort().join('|')}`;

/** [{ keep, drop }] items: drop is a short form of keep (or the same name twice). */
export const findDuplicates = (book, kind) => {
  const { collection, forms } = KINDS[kind];
  const list = (book[collection] || []).filter(x => clean(x.name));
  const ignored = new Set(book.metadata?.notDuplicates || []);
  const f = list.map(x => new Set(forms(x.name, x.aliases)));
  const pairs = [];
  const seen = new Set();
  list.forEach((a, i) => {
    const n = lower(a.name);
    const into = list.map((_, j) => j).filter(j => j !== i && f[j].has(n)
      && (lower(list[j].name) !== n ? words(list[j].name) > words(a.name) || lower(list[j].name).length > n.length : j < i));
    if (into.length !== 1) return;
    const b = list[into[0]];
    const key = pairKey(kind, a.id, b.id);
    if (ignored.has(key) || seen.has(key)) return;
    seen.add(key);
    pairs.push({ keep: b, drop: a });
  });
  return pairs;
};

export const markNotDuplicates = (book, kind, a, b) => ({
  ...book,
  metadata: { ...(book.metadata || {}), notDuplicates: [...new Set([...(book.metadata?.notDuplicates || []), pairKey(kind, a, b)])] },
});

const LONG = new Set(['background', 'description', 'personality', 'arc', 'motivations', 'fears', 'quirks', 'appearance', 'atmosphere', 'history', 'significance']);
const SKIP = new Set(['id', 'name', 'aliases', 'relationships', 'referenceImages', 'enhancement', 'mentions', 'firstChapter']);
const empty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/**
 * Merge `dropId` into `keepId`: every field the kept one lacks comes from the
 * other (for long text, the longer one), names become aliases, relationships,
 * pictures and links move over, and references elsewhere in the book point
 * at the kept one. The dropped entry is removed.
 */
export const mergeDuplicate = (book, kind, keepId, dropId) => {
  const { collection } = KINDS[kind];
  const list = book[collection] || [];
  const keep = list.find(x => sameId(x.id, keepId));
  const drop = list.find(x => sameId(x.id, dropId));
  if (!keep || !drop || keep === drop) return book;

  const merged = { ...keep };
  for (const [k, v] of Object.entries(drop)) {
    if (SKIP.has(k) || empty(v)) continue;
    if (empty(merged[k])) merged[k] = v;
    else if (LONG.has(k) && typeof v === 'string' && v.trim().length > String(merged[k]).trim().length) merged[k] = v;
  }
  const keepName = lower(keep.name);
  merged.aliases = [...new Set([...(keep.aliases || []), drop.name, ...(drop.aliases || [])].map(clean).filter(a => a && lower(a) !== keepName))];
  if (!merged.aliases.length) delete merged.aliases;
  const nums = [keep.firstChapter, drop.firstChapter].filter(x => x !== undefined && x !== null && x !== '');
  if (nums.length) merged.firstChapter = nums.sort((a, b) => Number(a) - Number(b))[0];
  if (keep.mentions != null || drop.mentions != null) merged.mentions = (keep.mentions || 0) + (drop.mentions || 0);
  if (!keep.enhancement && drop.enhancement) merged.enhancement = drop.enhancement;

  let next = { ...book };
  if (kind === 'character') {
    const rels = [...(keep.relationships || []), ...(drop.relationships || [])]
      .filter(r => !sameId(r.characterId, keep.id) && !sameId(r.characterId, drop.id));
    merged.relationships = rels.filter((r, i) => rels.findIndex(x => sameId(x.characterId, r.characterId)) === i);
    const pics = [...(keep.referenceImages || []), ...(drop.referenceImages || [])];
    merged.referenceImages = pics.filter((p, i) => pics.findIndex(x => (x.id || x.imageUrl) === (p.id || p.imageUrl)) === i);
    // other characters' relationships, plotlines' people, comic references
    next.characters = list.filter(x => x !== drop).map(x => {
      if (x === keep) return merged;
      if (!(x.relationships || []).some(r => sameId(r.characterId, drop.id))) return x;
      const moved = x.relationships.map(r => (sameId(r.characterId, drop.id) ? { ...r, characterId: keep.id } : r));
      return { ...x, relationships: moved.filter((r, i) => moved.findIndex(y => sameId(y.characterId, r.characterId)) === i) };
    });
    if (book.characterRefs && book.characterRefs[drop.id] !== undefined) {
      const refs = { ...book.characterRefs };
      if (refs[keep.id] === undefined) refs[keep.id] = refs[drop.id];
      delete refs[drop.id];
      next.characterRefs = refs;
    }
  } else {
    next.locations = list.filter(x => x !== drop).map(x => (x === keep ? merged : x));
    // timeline events name their place
    if ((book.timelines || []).some(e => lower(e.location) === lower(drop.name))) {
      next.timelines = book.timelines.map(e => (lower(e.location) === lower(drop.name) ? { ...e, location: keep.name } : e));
    }
  }
  const linkList = kind === 'character' ? 'linkedCharacters' : 'linkedLocations';
  if ((book.plotlines || []).some(p => (p[linkList] || []).some(id => sameId(id, drop.id)))) {
    next.plotlines = book.plotlines.map(p => {
      if (!(p[linkList] || []).some(id => sameId(id, drop.id))) return p;
      const ids = p[linkList].map(id => (sameId(id, drop.id) ? keep.id : id));
      return { ...p, [linkList]: ids.filter((id, i) => ids.findIndex(y => sameId(y, id)) === i) };
    });
  }
  return next;
};
