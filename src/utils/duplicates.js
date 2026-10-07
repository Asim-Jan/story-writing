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

// ---- places: a name reduced to the words that tell places apart ----
// "The Lab (night)", "lab" and "Aslan Lab"; "Adam's office" and "Dr.
// Carlsen's office" (one person's office); "Stanford" and "Stanford
// University". A room or part of a place is NOT the place: "the lighthouse"
// and "the lighthouse cottage" stay apart.

// what a place is: a proper name followed by one of these is still that place
const TYPE_WORDS = new Set(['university', 'college', 'school', 'academy', 'institute', 'city', 'town', 'village', 'hamlet', 'county', 'district',
  'quarter', 'kingdom', 'empire', 'republic', 'province', 'island', 'isle', 'lake', 'river', 'forest', 'wood', 'woods', 'mountain', 'mountains',
  'valley', 'hill', 'hills', 'bay', 'beach', 'coast', 'park', 'street', 'road', 'avenue', 'lane', 'square', 'station', 'airport', 'hospital',
  'church', 'cathedral', 'abbey', 'temple', 'palace', 'castle', 'manor', 'hall', 'house', 'estate', 'farm', 'cottage', 'hotel', 'inn', 'tavern',
  'pub', 'bar', 'cafe', 'café', 'restaurant', 'diner', 'shop', 'store', 'market', 'mall', 'lighthouse', 'tower', 'fort', 'fortress', 'base',
  'building', 'centre', 'center', 'library', 'museum', 'theatre', 'theater', 'club', 'stadium', 'harbour', 'harbor', 'port', 'bridge',
  'apartments', 'apartment', 'flat', 'mansion', 'ranch', 'plaza', 'prison', 'campus', 'laboratory', 'lab']);
// parts of a place
const PART_WORDS = new Set(['room', 'kitchen', 'bedroom', 'bathroom', 'hallway', 'corridor', 'office', 'lobby', 'foyer', 'attic', 'basement',
  'cellar', 'garden', 'yard', 'porch', 'balcony', 'roof', 'rooftop', 'stair', 'staircase', 'gallery', 'chamber', 'cell', 'wing', 'gate',
  'door', 'entrance', 'garage', 'shed', 'deck', 'department', 'floor', 'courtyard', 'parking', 'lot', 'desk', 'bench', 'study', 'den',
  'lounge', 'cafeteria', 'canteen', 'dock', 'pier', 'tunnel', 'crypt', 'vault', 'throne', 'ward', 'quarters']);
const ABBREVIATIONS = { st: 'street', rd: 'road', ave: 'avenue', ln: 'lane', sq: 'square', blvd: 'boulevard' };
const VIEW_WORDS = new Set(['interior', 'exterior', 'inside', 'outside']);
const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w);
const isPlaceNoun = (w) => TYPE_WORDS.has(w) || PART_WORDS.has(w) || TYPE_WORDS.has(`${w}s`) || PART_WORDS.has(`${w}s`);

/** A place name's words, owners resolved to characters ("adam's office" -> ["@<id>", "office"]). */
export const placeWords = (name, characters = []) => {
  const s = lower(name)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[.,;:!?"“”]/g, ' ')
    .replace(/[-–—/]/g, ' ');
  let words = s.split(/\s+/).filter(Boolean);
  while (words.length > 1 && ['the', 'a', 'an'].includes(words[0])) words = words.slice(1);
  const k = words.findIndex(w => /'s?$/.test(w) && w.length > 2);
  if (k !== -1) {
    const owner = [...words.slice(0, k), words[k].replace(/'s?$/, '')].filter(w => !HONORIFICS.has(w));
    const whose = owner.length ? characters.filter(c => personForms(c.name, c.aliases).includes(owner.join(' '))) : [];
    words = [...(whose.length === 1 ? [`@${whose[0].id}`] : owner), ...words.slice(k + 1)];
  }
  words = words.map(w => w.replace(/'/g, '')).filter(w => w && !VIEW_WORDS.has(w)).map(singular);
  const last = words.length - 1;
  if (last > 0 && ABBREVIATIONS[words[last]]) words[last] = ABBREVIATIONS[words[last]];
  return words;
};

// short is `long` with words left off: the same place, or a part of it?
const samePlace = (short, long) => {
  if (short.length >= long.length) return false;
  const at = (i) => short.every((w, j) => long[i + j] === w);
  if (at(long.length - short.length)) return true;             // "lab" / "aslan lab"
  if (!at(0)) return false;
  const head = short[short.length - 1];
  if (isPlaceNoun(head) || head.startsWith('@')) return false;  // "lighthouse" / "lighthouse cottage"
  return long.slice(short.length).every(w => TYPE_WORDS.has(w) || TYPE_WORDS.has(`${w}s`)); // "stanford" / "stanford university"
};

// how much of a name is name: "(night)", "- interior" and "The" don't count
const fullness = (name) => clean(name).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\b(interior|exterior|inside|outside)\b/gi, ' ')
  .replace(/^\s*(the|a|an)\s+/i, '').replace(/[\s:;,.–—-]+$/, '').trim().length;

// Entries with the same words are one place (each points at the one with
// the fullest name); then a name that is a shorter form of exactly one other.
const placePairs = (book, list) => {
  const w = list.map(x => placeWords(x.name, book.characters));
  const keys = w.map(x => x.join(' '));
  const aliasKeys = list.map(x => (x.aliases || []).map(a => placeWords(a, book.characters).join(' ')));
  const head = new Map();
  keys.forEach((k, i) => { if (!head.has(k) || fullness(list[i].name) > fullness(list[head.get(k)].name)) head.set(k, i); });
  const first = (i) => head.get(keys[i]);
  const out = [];
  list.forEach((a, i) => {
    if (!keys[i]) return;
    if (first(i) !== i) { out.push({ keep: list[first(i)], drop: a }); return; }
    const into = list.map((_, j) => j).filter(j => j !== i && keys[j] && first(j) === j && keys[j] !== keys[i]
      && (aliasKeys[j].includes(keys[i]) || samePlace(w[i], w[j])));
    if (into.length === 1) out.push({ keep: list[into[0]], drop: a });
  });
  return out;
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
  const pairs = [];
  const seen = new Set();
  const add = (keep, drop, reason) => {
    const key = pairKey(kind, keep.id, drop.id);
    if (sameId(keep.id, drop.id) || ignored.has(key) || seen.has(key)) return;
    seen.add(key);
    pairs.push(reason ? { keep, drop, reason } : { keep, drop });
  };
  if (kind === 'location') {
    placePairs(book, list).forEach(p => add(p.keep, p.drop));
  } else {
    const f = list.map(x => new Set(forms(x.name, x.aliases)));
    list.forEach((a, i) => {
      const n = lower(a.name);
      const into = list.map((_, j) => j).filter(j => j !== i && f[j].has(n)
        && (lower(list[j].name) !== n ? words(list[j].name) > words(a.name) || lower(list[j].name).length > n.length : j < i));
      if (into.length === 1) add(list[into[0]], a);
    });
  }
  // what SAI's duplicate check found (book.metadata.duplicateCheck[kind])
  for (const p of book.metadata?.duplicateCheck?.[kind]?.pairs || []) {
    const keep = list.find(x => sameId(x.id, p.keepId));
    const drop = list.find(x => sameId(x.id, p.dropId));
    if (keep && drop) add(keep, drop, p.reason);
  }
  return pairs;
};

export const markNotDuplicates = (book, kind, a, b) => ({
  ...book,
  metadata: { ...(book.metadata || {}), notDuplicates: [...new Set([...(book.metadata?.notDuplicates || []), pairKey(kind, a, b)])] },
});

const LONG = new Set(['background', 'description', 'personality', 'arc', 'motivations', 'fears', 'quirks', 'appearance', 'atmosphere', 'history', 'significance']);
const SKIP = new Set(['id', 'name', 'aliases', 'relationships', 'referenceImages', 'enhancement', 'mentions', 'firstChapter', 'imageUrl', 'imageFilename']);
const LINK = { character: 'characterId', location: 'locationId' };
const urlOf = (v) => v?.url || v?.imageUrl || '';
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
  if (!keep.imageUrl && drop.imageUrl) {
    merged.imageUrl = drop.imageUrl;
    if (drop.imageFilename) merged.imageFilename = drop.imageFilename;
  }

  let next = { ...book };
  // pictures: the library's pictures of the dropped one become the kept
  // one's; its main picture too, when it is a different one
  const link = LINK[kind];
  const visuals = (book.visuals || []).map(v => (sameId(v[link], drop.id) ? { ...v, [link]: keep.id } : v));
  if (drop.imageUrl && drop.imageUrl !== merged.imageUrl && !visuals.some(v => urlOf(v) === drop.imageUrl)) {
    visuals.push({ id: `vis-${Date.now().toString(36)}-${drop.id}`, description: clean(keep.name), url: drop.imageUrl,
      filename: drop.imageFilename || String(drop.imageUrl).split('?')[0].split('/').pop(), [link]: keep.id, createdAt: new Date().toISOString() });
  }
  if (book.visuals || visuals.length) next.visuals = visuals;
  const check = book.metadata?.duplicateCheck?.[kind];
  if (check?.pairs?.length) {
    const to = (id) => (sameId(id, drop.id) ? keep.id : id);
    const pairs = check.pairs.map(p => ({ ...p, keepId: to(p.keepId), dropId: to(p.dropId) })).filter(p => !sameId(p.keepId, p.dropId));
    next.metadata = { ...book.metadata, duplicateCheck: { ...book.metadata.duplicateCheck, [kind]: { ...check, pairs } } };
  }
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
