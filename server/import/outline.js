import crypto from 'crypto';
import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { wordCount } from './text.js';

// Outline review: one call to the Assistant model (sai-chat-fast) with the
// whole outline (titles, sizes, how each section starts and ends). It only
// SUGGESTS; the rules stay in charge and the user accepts or dismisses each
// suggestion in the review. It catches what the rules cannot see: one chapter
// split over several files (split_001.html, split_002.html), back matter with
// an unusual title, a generic title the opening text gives away.
//
// Suggestions point at a section's KEY, not its position, so they stay right
// while the user edits; one that no longer applies (already done, or its
// section merged away) disappears when the import is read.

const GENERIC_TITLE = /^(chapter \d+|opening|front matter|back matter|new chapter|untitled)$/i;
const MAX_SUGGESTIONS = 40;

const SYSTEM = `You check how an imported book was split into sections. Each line is one section:
[index] kind=<front|chapter|back> words=<n> title="..." | starts: "..." | ends: "..."
kind: front = before the story (title page, copyright, dedication, contents, epigraph, praise), chapter = the story itself (incl. prologue/epilogue), back = after the story (author's note, acknowledgements, about the author, excerpts or previews of OTHER books, reading-group guides, ads).
Reply with JSON only, listing ONLY what is wrong (empty lists when the outline is right):
{"kinds":[{"index":n,"kind":"front|chapter|back","reason":"short"}],
 "merges":[{"index":n,"reason":"short"}],
 "titles":[{"index":n,"title":"...","reason":"short"}]}
- kinds: a section whose kind is wrong.
- merges: section n and section n+1 are ONE chapter cut in two (n ends mid-sentence or mid-scene and n+1 carries straight on, or they are numbered parts of one chapter). Never merge two real chapters.
- titles: only for sections whose title is generic ("Chapter 12", "Opening", "Front matter") when the text shows the real title. Use the book's own title, without a chapter number.
Be conservative: a wrong suggestion costs the user time.`;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export const sectionKey = () => crypto.randomBytes(5).toString('hex');

/** Ask the model about the outline. Returns [{id, type, key, nextKey?, value, reason}]. Throws on failure. */
export async function reviewOutline({ title, author, chapters }) {
  if (chapters.length < 2) return [];
  const snip = chapters.length > 150 ? 100 : 220;
  const tail = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(-snip);
  const lines = chapters.map((c, i) => `[${i}] kind=${c.kind} words=${wordCount(c.content)} title="${clip(c.title, 120).replace(/"/g, "'")}" | starts: "${clip(c.content, snip).replace(/"/g, "'")}" | ends: "${tail(c.content).replace(/"/g, "'")}"`);
  const completion = await getSAIClient().chat.completions.create({
    model: SAI_CHAT_FAST,
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Book: ${title || 'Untitled'}${author ? ` by ${author}` : ''}\n\n${lines.join('\n')}` },
    ],
  }, { timeout: 90000, maxRetries: 1 });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const has = (i) => Number.isInteger(i) && i >= 0 && i < chapters.length;
  const reason = (r) => clip(r, 200) || null;
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const sig = `${item.type}:${item.key}`;
    if (seen.has(sig) || items.length >= MAX_SUGGESTIONS) return;
    seen.add(sig);
    items.push({ id: crypto.randomBytes(4).toString('hex'), ...item });
  };
  for (const k of out.kinds || []) {
    const i = Number(k?.index);
    if (has(i) && ['front', 'chapter', 'back'].includes(k.kind) && chapters[i].kind !== k.kind) {
      add({ type: 'kind', key: chapters[i].key, value: k.kind, reason: reason(k.reason) });
    }
  }
  for (const m of out.merges || []) {
    const i = Number(m?.index);
    if (has(i) && has(i + 1)) add({ type: 'merge', key: chapters[i].key, nextKey: chapters[i + 1].key, reason: reason(m.reason) });
  }
  for (const t of out.titles || []) {
    const i = Number(t?.index);
    const value = clip(t?.title, 120);
    if (has(i) && value && GENERIC_TITLE.test(chapters[i].title || '') && value.toLowerCase() !== String(chapters[i].title).toLowerCase()) {
      add({ type: 'title', key: chapters[i].key, value, reason: reason(t.reason) });
    }
  }
  return items;
}

/**
 * The suggestions that still apply to the current chapters, with each one's
 * current index. Done, dismissed or orphaned ones are left out.
 */
export function liveSuggestions(suggestions, chapters) {
  if (!suggestions || !Array.isArray(suggestions.items)) return [];
  const dismissed = new Set(suggestions.dismissed || []);
  const at = new Map(chapters.map((c, i) => [c.key, i]));
  const out = [];
  for (const s of suggestions.items) {
    if (dismissed.has(s.id) || !at.has(s.key)) continue;
    const index = at.get(s.key);
    const c = chapters[index];
    if (s.type === 'kind' && c.kind === s.value) continue;
    if (s.type === 'title' && c.title === s.value) continue;
    if (s.type === 'merge' && chapters[index + 1]?.key !== s.nextKey) continue;
    out.push({ id: s.id, type: s.type, index, value: s.value ?? null, reason: s.reason || null });
  }
  return out;
}
