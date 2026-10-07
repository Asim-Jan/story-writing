import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { wordCount } from './text.js';

// Front matter / story / back matter, and chapter detection for text with no
// structure. Cheap signals first (ePub semantics, titles, filenames); the SAI
// decide model (/v1/systemone, ~100 ms typed decisions) only for the sections
// the signals can't place; the chat model only to find chapters in unbroken text.

const FRONT = /\b(cover|title-?page|titlepage|copyright|copyright-page|dedication|epigraph|toc|contents|table of contents|halftitle|half-title|frontmatter|front-matter|imprint|praise|also by)\b/i;
const BACK = /\b(about the author|about-the-author|acknowledg(e)?ments?|backmatter|back-matter|afterword by|colophon|also available|other books|notes|appendix|index|glossary|bibliography|excerpt|sneak peek|preview of|teaser|bonus chapter from|author[’']?s note|a note from the author|reading group|discussion questions|book club|what[’']?s next|next on your reading list|newsletter)\b/i;
// A title that names a story division: "Chapter One", "Chapter 3: ...", "Prologue", "Part Two".
const STORY_TITLE = /^\s*(chapter|prologue|epilogue|interlude|part|book)\b/i;

// kind + whether we are SURE (signals, chapter titles, real length). Unsure
// kinds (sai-decide, fallbacks) never anchor where the story starts or ends.
function signal(section) {
  const hay = `${section.title || ''} ${section.hints || ''}`;
  if (/\b(bodymatter|chapter|prologue|epilogue|part)\b/i.test(section.hints || '')) return 'chapter';
  if (STORY_TITLE.test(section.title || '')) return 'chapter';
  if (FRONT.test(hay)) return 'front';
  if (BACK.test(hay)) return 'back';
  return null;
}

async function decide(sections) {
  const base = (process.env.SAI_API_BASE_URL || 'https://api.solutionsai.co.uk/v1').replace(/\/$/, '');
  const questions = {};
  sections.forEach((s, i) => {
    questions[`s${i}`] = {
      type: 'choice',
      instructions: `A section of a book, titled "${s.title || '(untitled)'}". Its opening text is in the state under key s${i}. Is it front matter (title page, copyright, dedication, contents, epigraph), part of the story itself, or back matter (about the author, acknowledgements, other books)?`,
      criteria: { front: 'front matter before the story', chapter: 'part of the story', back: 'back matter after the story' },
    };
  });
  const state = Object.fromEntries(sections.map((s, i) => [`s${i}`, `${s.title || ''}\n${s.content.slice(0, 1200)}`]));
  const res = await fetch(`${base}/systemone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SAI_API_KEY}` },
    body: JSON.stringify({ model: 'sai-decide', state, questions }),
  });
  if (!res.ok) throw new Error(`systemone ${res.status}`);
  const { answers } = await res.json();
  return sections.map((_, i) => answers?.[`s${i}`]?.choice || 'chapter');
}

/** Give every section a kind: chapter | front | back. Mutates and returns the list. */
export async function classifySections(sections) {
  const unsure = [];
  sections.forEach((s, i) => {
    s.kind = signal(s);
    // a long section no signal placed is story; short unplaced ones get asked
    if (!s.kind && wordCount(s.content) >= 400) s.kind = 'chapter';
    s.sure = Boolean(s.kind);
    if (!s.kind) unsure.push(i);
  });
  // where the story certainly starts and ends (sure chapters only)
  const sureFirst = sections.findIndex(s => s.sure && s.kind === 'chapter');
  const sureLast = sections.map(s => (s.sure && s.kind === 'chapter' ? 'c' : '')).lastIndexOf('c');
  if (unsure.length) {
    try {
      for (let k = 0; k < unsure.length; k += 32) { // 32 questions per call
        const batch = unsure.slice(k, k + 32);
        const kinds = await decide(batch.map(i => sections[i]));
        batch.forEach((i, j) => { sections[i].kind = kinds[j]; });
      }
    } catch (err) {
      // no decide model: place by position (before the story = front, after = back)
      console.warn('Import: section classification fell back to position:', err.message);
      unsure.forEach(i => {
        if (sections[i].kind) return;
        sections[i].kind = sureFirst >= 0 && i < sureFirst ? 'front' : sureLast >= 0 && i > sureLast ? 'back' : 'chapter';
      });
    }
  }
  // Front matter inside the story is story (a mid-book "Contents" is rare; an
  // epigraph page between parts is common). Back matter is only moved into
  // the story when a SURE chapter follows it: one long excerpt or a short
  // "what's next" page at the end must not drag the acknowledgements in.
  sections.forEach((s, i) => {
    if (s.kind === 'front' && sureFirst >= 0 && i > sureFirst && i < sureLast) s.kind = 'chapter';
    if (s.kind === 'back' && sureLast >= 0 && i > sureFirst && i < sureLast) s.kind = 'chapter';
    delete s.sure;
  });
  return sections;
}

/**
 * Text with no headings at all: number the paragraphs, ask the chat model which
 * numbers START a chapter (it sees the numbers, so it can't invent positions),
 * validate, split. Chunks of ~40k characters; the first section keeps
 * everything before the first boundary. Throws on failure (the caller keeps
 * the text as one section and says so).
 */
export async function detectChapters(text) {
  const paragraphs = text.split(/\n\n+/);
  const starts = new Map(); // paragraph index → title
  let from = 0;
  while (from < paragraphs.length) {
    let to = from;
    let size = 0;
    while (to < paragraphs.length && size < 40000) { size += paragraphs[to].length + 2; to++; }
    const numbered = paragraphs.slice(from, to).map((p, k) => `[${from + k}] ${p.slice(0, 400)}`).join('\n');
    const completion = await getSAIClient().chat.completions.create({
      model: SAI_CHAT_FAST,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You find where chapters start in a novel. Paragraphs are numbered in [brackets]. Reply with JSON only: {"chapters":[{"start": <paragraph number>, "title": "<chapter title or Chapter N>"}]}. Only use numbers that appear in the text. If a heading line marks the start, use that paragraph. If no chapter starts in this part, reply {"chapters":[]}.' },
        { role: 'user', content: numbered },
      ],
    }, { timeout: 120000, maxRetries: 1 });
    const raw = completion.choices?.[0]?.message?.content || '{}';
    const found = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).chapters || [];
    for (const c of found) {
      const n = Number(c.start);
      if (Number.isInteger(n) && n >= from && n < to && !starts.has(n)) starts.set(n, String(c.title || '').slice(0, 120) || null);
    }
    from = to;
  }
  const points = [...starts.keys()].sort((a, b) => a - b);
  if (points.length < 2) throw new Error('No chapter boundaries found');
  const sections = [];
  if (points[0] > 0) sections.push({ title: null, content: paragraphs.slice(0, points[0]).join('\n\n'), source: 'whole' });
  points.forEach((p, i) => {
    const end = i + 1 < points.length ? points[i + 1] : paragraphs.length;
    let body = paragraphs.slice(p, end);
    const title = starts.get(p) || `Chapter ${i + 1}`;
    // drop the heading paragraph itself when it IS the title
    if (body[0] && body[0].trim().length <= 90 && body[0].trim().toLowerCase().includes(String(title).toLowerCase().slice(0, 20))) body = body.slice(1);
    sections.push({ title, content: body.join('\n\n'), source: 'ai' });
  });
  return sections;
}
