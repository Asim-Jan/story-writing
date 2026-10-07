// The pictures a character or location has: its main image, every image
// generated or uploaded for it (kept in the visuals library with a
// characterId/locationId), and, for characters, its reference sheets. A new
// "Generate Image" replaces the main image, so the earlier ones only live in
// the library; this lists them on the item so the author can pick or delete.
// Deleting detaches the picture from the book; the stored file is kept, so
// Version History can still bring it back.

const LINK = { character: 'characterId', location: 'locationId' };
const LIST = { character: 'characters', location: 'locations' };
const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);
const urlOf = (v) => v?.url || v?.imageUrl || '';
const time = (p) => Date.parse(p.createdAt || '') || 0;

/**
 * Every picture of the item, main first then newest first:
 * [{url, label, createdAt, main, reference}]. references: false leaves out
 * reference sheets that are not the main image (they have their own gallery).
 */
export const picturesOf = (book, kind, item, { references = true } = {}) => {
  if (!item) return [];
  const found = new Map();
  const add = (url, picture) => {
    if (!url || found.has(url)) return;
    found.set(url, { url, main: url === item.imageUrl, ...picture });
  };
  for (const v of book?.visuals || []) {
    if (sameId(v[LINK[kind]], item.id)) add(urlOf(v), { label: 'Generated or uploaded', createdAt: v.createdAt || null, reference: false });
  }
  if (kind === 'character') {
    for (const r of item.referenceImages || []) {
      if (references || r.imageUrl === item.imageUrl) add(r.imageUrl, { label: r.kind === 'portrait' ? 'Portrait' : 'Reference sheet', createdAt: r.createdAt || null, reference: true, portrait: r.kind === 'portrait' });
    }
  }
  add(item.imageUrl, { label: 'Main picture', createdAt: null, reference: false });
  return [...found.values()].sort((a, b) => (b.main - a.main) || (time(b) - time(a)));
};

const fileName = (url) => String(url || '').split('?')[0].split('/').pop() || undefined;

/** Make one of the item's pictures its main image. */
export const setMainPicture = (book, kind, id, url) => ({
  ...book,
  [LIST[kind]]: (book[LIST[kind]] || []).map(it => (sameId(it.id, id) ? { ...it, imageUrl: url, imageFilename: fileName(url) } : it)),
});

/**
 * Delete a picture from the item: from its main image (the newest remaining
 * generated, uploaded or portrait picture takes over, or none), its reference
 * sheets, its entries in the visuals library and the comic's reference for it.
 */
export const removePicture = (book, kind, id, url) => {
  const items = book[LIST[kind]] || [];
  const item = items.find(it => sameId(it.id, id));
  if (!item || !url) return book;
  const next = {
    ...book,
    visuals: (book.visuals || []).filter(v => !(urlOf(v) === url && sameId(v[LINK[kind]], id))),
  };
  let updated = item;
  if (kind === 'character' && (item.referenceImages || []).some(r => r.imageUrl === url)) {
    updated = { ...updated, referenceImages: item.referenceImages.filter(r => r.imageUrl !== url) };
  }
  if (item.imageUrl === url) {
    // a turnaround or expression sheet is not a portrait: never promote one
    const rest = picturesOf(next, kind, { ...updated, imageUrl: '' }).filter(p => !p.reference || p.portrait);
    updated = { ...updated, imageUrl: rest[0]?.url || '', imageFilename: rest[0] ? fileName(rest[0].url) : '' };
  }
  next[LIST[kind]] = items.map(it => (it === item ? updated : it));
  if (kind === 'character' && book.characterRefs && book.characterRefs[item.id] === url) {
    const refs = { ...book.characterRefs };
    delete refs[item.id];
    next.characterRefs = refs;
  }
  return next;
};

/**
 * Delete a visual from the library. A visual made for a character or location
 * is that item's picture too, so it goes from the item as well; otherwise the
 * "deleted" image would stay on the character.
 */
export const removeVisual = (book, visualId) => {
  const visual = (book.visuals || []).find(v => sameId(v.id, visualId));
  if (!visual) return book;
  for (const kind of ['character', 'location']) {
    const id = visual[LINK[kind]];
    if (id !== undefined && id !== null && (book[LIST[kind]] || []).some(it => sameId(it.id, id))) {
      return removePicture(book, kind, id, urlOf(visual));
    }
  }
  return { ...book, visuals: book.visuals.filter(v => v !== visual) };
};

/** What a visual is attached to, for the delete confirm ("" when nothing). */
export const visualOwner = (book, visual) => {
  for (const kind of ['character', 'location']) {
    const id = visual?.[LINK[kind]];
    const item = (book[LIST[kind]] || []).find(it => sameId(it.id, id));
    if (item) return item.name || kind;
  }
  return '';
};
