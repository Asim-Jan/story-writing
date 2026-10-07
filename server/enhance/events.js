import { askJson } from '../import/analyze.js';
import { chapterHeading } from '../utils/chapters.js';
import { plainText } from './passages.js';
import { bookDigest } from './book.js';
import { norm, same, cap, fieldSuggestions } from './common.js';

// Enhance timeline events from the book: ONE call per chapter reads the
// chapter once for all of its events (when in the story's own time, where,
// what kind of scene, what happens). Chapters go in order, each told the last
// known time, so "three days later" has something to count from. Events with
// no chapter are read against a digest of the whole book.

export const SHORT_FIELDS = ['date', 'location', 'sceneType'];
export const LONG_FIELDS = ['description'];
export const SCENE_TYPES = ['action', 'dialogue', 'exposition', 'transition'];
const MAX_CHAPTER_CHARS = 60000;

const PROMPT = `You fill in the timeline events of one chapter of a novel, reading the chapter. JSON only:
{"events": [{"index": 0, "date": "", "location": "", "sceneType": "${SCENE_TYPES.join('|')}", "description": ""}]}
For EACH event listed (by its index):
- date: when it happens in the story's own time, as the text gives it ("a Monday in late September", "the next morning", "three weeks later", "1888"). Use the last known time to place relative times. "" if the text gives nothing.
- location: where it happens. When it is one of the PLACES listed, use that name exactly. "" if unclear.
- sceneType: action, dialogue, exposition or transition: what the scene mostly is.
- description: 2 or 3 sentences: what happens and who is involved, naming them.
- If an event does not happen in this chapter at all, return only {"index": N, "missing": true} for it: never describe a different scene instead.
Only what the chapter supports. Keep the author's CURRENT values unless the text contradicts them.`;

const chapterOf = (ev) => {
  const n = ev.chapter ?? String(ev.chapterHint || '').match(/\d+/)?.[0];
  return n === undefined || n === null || n === '' ? null : String(n);
};

/**
 * events: [{id, event, description, chapter, chapterHint, date, location, sceneType}] as the author has them.
 * book: the SAVED book. Returns { items: { [eventId]: {suggestions, read} | {error} } }.
 */
export async function enhanceEvents({ events, book, report = async () => {} }) {
  const chapters = book.chapters || [];
  const places = (book.locations || []).map(l => norm(l.name)).filter(Boolean).slice(0, 120);
  const byChapter = new Map();
  for (const ev of events) {
    const n = chapterOf(ev);
    const at = n === null ? -1 : chapters.findIndex((c, i) => String(c.number ?? i + 1) === n);
    const key = at === -1 ? 'book' : String(at);
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(ev);
  }
  const order = [...byChapter.keys()].sort((a, b) => (a === 'book') - (b === 'book') || Number(a) - Number(b));
  const items = {};
  let lastTime = '';
  let failed = 0;
  for (let step = 0; step < order.length; step++) {
    const key = order[step];
    const group = byChapter.get(key);
    const c = key === 'book' ? null : chapters[Number(key)];
    const heading = c ? chapterHeading(c, Number(key) + 1) : 'The whole book';
    await report({ message: `${heading} (${step + 1} of ${order.length})`, current: step, total: order.length });
    const text = c ? plainText(c.content).slice(0, MAX_CHAPTER_CHARS) : bookDigest(chapters);
    if (!norm(text)) {
      for (const ev of group) items[ev.id] = { error: 'Its chapter has no saved text' };
      continue;
    }
    const list = group.map((ev, i) => `[${i}] "${cap(ev.event || ev.title, 120)}"${ev.description ? `: ${cap(ev.description, 300)}` : ''} | CURRENT ${JSON.stringify(Object.fromEntries(SHORT_FIELDS.map(f => [f, norm(ev[f])]).filter(([, v]) => v)))}`);
    try {
      const out = await askJson(PROMPT, [
        `Book: ${norm(book.title) || 'Untitled'}`,
        `PLACES: ${places.join(', ') || 'none'}`,
        `Last known time: ${lastTime || 'none yet'}`,
        `Events:\n${list.join('\n')}`,
        `${heading}\n\n${text}`,
      ].join('\n\n'), 3000);
      const rows = Array.isArray(out.events) ? out.events : [];
      group.forEach((ev, i) => {
        const row = rows.find(r => Number(r?.index) === i) || {};
        if (row.missing === true) { // the event is not in the chapter it says: change nothing
          items[ev.id] = { suggestions: [], relationships: [], aliases: [], read: { chapters: 1, mentions: null }, missing: true };
          return;
        }
        row.sceneType = SCENE_TYPES.find(t => same(t, row.sceneType)) || '';
        const suggestions = fieldSuggestions(row, ev, SHORT_FIELDS, LONG_FIELDS).map(s => ({ ...s, chapters: c ? [c.number ?? Number(key) + 1].map(Number) : [] }));
        items[ev.id] = { suggestions, relationships: [], aliases: [], read: { chapters: 1, mentions: null } };
        const when = norm(row.date) || norm(ev.date);
        if (when) lastTime = when;
      });
    } catch (err) {
      failed++;
      console.warn(`enhance events: ${heading} failed:`, err.message);
      for (const ev of group) items[ev.id] = { error: 'Could not read its chapter' };
    }
  }
  if (failed && failed === order.length) throw new Error('The model could not read the book');
  return { items };
}
