import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { chapterHeading } from '../utils/chapters.js';
import { mergeNameForms } from '../enhance/duplicates.js';

// Book analysis (a book media job, type 'analysis'): read the book chapter by
// chapter with the Assistant model in JSON mode, then merge in CODE. The old
// version sent every chapter in one long request, re-sent each chapter in full
// with no limit, and merged with a final LLM call whose truncated JSON threw
// the whole run away; nothing was saved unless everything succeeded.

const MAX_CHAPTER_CHARS = 60000; // ~15k tokens: one chapter, comfortably inside the model's window

export async function askJson(system, user, maxTokens) {
  const completion = await getSAIClient().chat.completions.create({
    model: SAI_CHAT_FAST,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }, { timeout: 180000, maxRetries: 1 });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}

const CHAPTER_PROMPT = `You read one chapter of a novel and extract facts as JSON only:
{"summary": "two sentences",
 "characters": [{"name": "full name as used", "role": "protagonist|antagonist|supporting|minor", "description": "who they are", "appearance": "physical details if given, else empty"}],
 "locations": [{"name": "", "type": "city|building|room|landscape|...", "description": ""}],
 "events": [{"title": "short", "description": "one sentence"}],
 "plot": [{"title": "storyline name", "description": "what develops in this chapter"}]}
Only include what this chapter actually shows. Use the names exactly as written. Keep descriptions short.`;

const key = (name) => String(name || '').trim().toLowerCase();
const longer = (a, b) => (String(b || '').length > String(a || '').length ? b : a);

/**
 * chapters: [{id, number, title, content}]. report(progress) per chapter.
 * Returns the contract's result; throws with .partial if a later step fails.
 */
export async function analyzeBook({ chapters, title, report }) {
  const characters = new Map();
  const locations = new Map();
  const plotlines = new Map();
  const timeline = [];
  const chapterSummaries = {};
  const rows = chapters.map(c => ({ chapterId: c.id, status: 'pending' }));
  const partial = () => ({
    characters: [...characters.values()],
    locations: [...locations.values()],
    plotlines: [...plotlines.values()],
    timeline,
    chapterSummaries,
    overview: '',
  });

  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    rows[i].status = 'reading';
    await report({ message: `Reading chapter ${c.number || i + 1} of ${chapters.length}`, current: i, total: chapters.length, chapters: rows.map(r => ({ ...r })) });
    try {
      const text = String(c.content || '').slice(0, MAX_CHAPTER_CHARS);
      if (!text.trim()) { rows[i].status = 'done'; continue; }
      const known = [...characters.values()].map(x => x.name).slice(0, 80).join(', ');
      const facts = await askJson(CHAPTER_PROMPT, `Book: ${title || 'Untitled'}\nKnown characters so far: ${known || 'none'}\n\n${chapterHeading(c, i + 1)}\n\n${text}`, 3000);
      const n = c.number || i + 1;
      if (facts.summary) chapterSummaries[c.id] = String(facts.summary).slice(0, 600);
      for (const ch of facts.characters || []) {
        if (!ch?.name) continue;
        const k = key(ch.name);
        const prev = characters.get(k);
        characters.set(k, prev
          ? { ...prev, description: longer(prev.description, ch.description), appearance: longer(prev.appearance, ch.appearance), mentions: prev.mentions + 1 }
          : { name: String(ch.name).trim(), role: ch.role || 'supporting', description: ch.description || '', appearance: ch.appearance || '', firstChapter: n, mentions: 1 });
      }
      for (const loc of facts.locations || []) {
        if (!loc?.name) continue;
        const k = key(loc.name);
        const prev = locations.get(k);
        locations.set(k, prev
          ? { ...prev, description: longer(prev.description, loc.description) }
          : { name: String(loc.name).trim(), type: loc.type || '', description: loc.description || '', firstChapter: n });
      }
      for (const pl of facts.plot || []) {
        if (!pl?.title) continue;
        const k = key(pl.title);
        const prev = plotlines.get(k);
        plotlines.set(k, prev
          ? { ...prev, description: longer(prev.description, pl.description), chapters: [...new Set([...prev.chapters, n])] }
          : { title: String(pl.title).trim(), description: pl.description || '', chapters: [n] });
      }
      for (const ev of (facts.events || []).slice(0, 6)) {
        if (ev?.title) timeline.push({ title: String(ev.title).slice(0, 120), description: String(ev.description || '').slice(0, 400), chapter: n });
      }
      rows[i].status = 'done';
    } catch (err) {
      console.warn(`analysis: chapter ${c.number || i + 1} failed:`, err.message);
      rows[i].status = 'failed';
    }
  }

  // one person named two ways ("Olive", "Olive Smith") is one character;
  // main characters first; drop one-off mentions when the cast is large
  const cast = mergeNameForms([...characters.values()]).sort((a, b) => b.mentions - a.mentions);
  const result = { ...partial(), characters: cast.length > 40 ? cast.filter(c => c.mentions > 1 || c.role !== 'minor') : cast };
  if (rows.every(r => r.status === 'failed')) throw Object.assign(new Error('No chapter could be analysed'), { partial: null });

  try {
    await report({ message: 'Writing the overview...', current: chapters.length, total: chapters.length, chapters: rows.map(r => ({ ...r })) });
    const summaries = chapters.map((c, i) => `${c.number || i + 1}. ${chapterSummaries[c.id] || ''}`).join('\n').slice(0, 30000);
    const o = await askJson('Write a one-paragraph overview of a novel from its chapter summaries. JSON only: {"overview": "..."}', `Book: ${title || 'Untitled'}\n\n${summaries}`, 800);
    result.overview = String(o.overview || '').slice(0, 2000);
  } catch (err) {
    console.warn('analysis: overview failed (keeping the rest):', err.message);
  }
  return result;
}
