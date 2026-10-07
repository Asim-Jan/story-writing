// Mirrors src/utils/chapters.js: a chapter whose title already names it
// ("Chapter One", "Prologue") is spoken and shown as just its title.
const NAMES_ITSELF = /^\s*(chapter|prologue|epilogue|interlude|intermission|part|book|preface|foreword|afterword|introduction)\b/i;

export const titleNamesChapter = (title) => NAMES_ITSELF.test(String(title || ''));

export const chapterHeading = (chapter, fallbackNumber) => {
  const title = String(chapter?.title || '').trim();
  if (title && titleNamesChapter(title)) return title;
  const n = chapter?.number || fallbackNumber;
  if (!n) return title || 'Chapter';
  return title ? `Chapter ${n}: ${title}` : `Chapter ${n}`;
};
