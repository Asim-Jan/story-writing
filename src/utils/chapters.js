// How a chapter is named on screen, in exports and in prompts.
//
// Most chapters read "Chapter 3: The Storm". A chapter whose title already
// names it ("Chapter One", "Prologue", "Epilogue", "Part Two") reads as just
// its title: a book with a prologue stores "Chapter One" as number 2, and
// "Chapter 2: Chapter One" helps nobody. server/utils/chapters.js mirrors this.

const NAMES_ITSELF = /^\s*(chapter|prologue|epilogue|interlude|intermission|part|book|preface|foreword|afterword|introduction)\b/i;

export const titleNamesChapter = (title) => NAMES_ITSELF.test(String(title || ''));

/** "Chapter 3: The Storm" | "Prologue" | "Chapter 3" (no title). */
export const chapterHeading = (chapter) => {
  const title = String(chapter?.title || '').trim();
  if (title && titleNamesChapter(title)) return title;
  const n = chapter?.number;
  if (!n && n !== 0) return title || 'Chapter';
  return title ? `Chapter ${n}: ${title}` : `Chapter ${n}`;
};

/** The "Chapter 3" line shown above a title; null when the title says it already. */
export const chapterLabel = (chapter) => (titleNamesChapter(chapter?.title) ? null : `Chapter ${chapter?.number ?? ''}`.trim());

/** The short "Ch. 3" badge in lists; null when the title says it already. */
export const chapterBadge = (chapter) => (titleNamesChapter(chapter?.title) ? null : `Ch. ${chapter?.number ?? ''}`.trim());

const asInt = (n) => {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : null;
};

/** Chapters in reading order (by number; unnumbered last, keeping their order). */
export const sortChapters = (chapters) => [...(chapters || [])]
  .map((c, i) => ({ c, i, n: asInt(c.number) }))
  .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || a.i - b.i)
  .map(x => x.c);

/** True when the numbers are not exactly 1..N in order (gaps, duplicates, blanks). */
export const needsRenumber = (chapters) => sortChapters(chapters).some((c, i) => asInt(c.number) !== i + 1);

/** Every chapter numbered 1..N in its current reading order. Numbers are strings, as the app stores them. */
export const renumberChapters = (chapters) => {
  const order = new Map(sortChapters(chapters).map((c, i) => [c.id, String(i + 1)]));
  return (chapters || []).map(c => ({ ...c, number: order.get(c.id) ?? c.number }));
};

/**
 * Delete one chapter. With renumber, every chapter numbered after it moves up
 * by one (4 -> 3, 5 -> 4, ...); chapters before it keep their numbers.
 */
export const deleteChapter = (chapters, id, { renumber = true } = {}) => {
  const gone = (chapters || []).find(c => c.id === id);
  const rest = (chapters || []).filter(c => c.id !== id);
  const at = asInt(gone?.number);
  if (!renumber || at === null) return rest;
  return rest.map(c => {
    const n = asInt(c.number);
    return n !== null && n > at ? { ...c, number: String(n - 1) } : c;
  });
};
