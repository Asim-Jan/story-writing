import { chapterHeading } from '../utils/chapters.js';
import { plainText } from './passages.js';
import { placeVariants } from './location.js';
import { matchCast } from './character.js';
import { bookDigest } from './book.js';
import { norm, same, cap, takeNotes, writeProfile, fieldSuggestions } from './common.js';

// Enhance a plotline from the book. A storyline's title is not in the text, so
// it is read by CHAPTER: the chapters it runs through (the import records them),
// or, with none, a digest of the whole book. Suggests type, description,
// themes, conflicts, and links to the people, places and other plotlines in it.

export const SHORT_FIELDS = ['type'];
export const LONG_FIELDS = ['description', 'themes', 'conflicts'];
export const TYPES = ['main', 'subplot', 'backstory'];
const BUDGET = 160000;
const PER_CHAPTER = 30000;

// the plotline's chapters as passages, the start and end of a very long one
export function plotPassages(chapters, numbers) {
  const want = new Set((numbers || []).map(n => String(n)));
  const picked = (chapters || []).map((c, i) => ({ c, i })).filter(({ c, i }) => want.has(String(c.number ?? i + 1)));
  const rows = picked.map(({ c, i }) => {
    const text = plainText(c.content).trim();
    const body = text.length > PER_CHAPTER ? `${text.slice(0, PER_CHAPTER * 0.7)}\n[...]\n${text.slice(-PER_CHAPTER * 0.3)}` : text;
    return { chapter: c.number ?? i + 1, heading: chapterHeading(c, i + 1), text: body };
  }).filter(r => r.text);
  const total = rows.reduce((n, r) => n + r.text.length, 0);
  if (total <= BUDGET) return { passages: rows, chapters: rows.map(r => r.chapter), sampled: false };
  const keep = Math.max(1, Math.floor(BUDGET / PER_CHAPTER));
  const sample = Array.from({ length: keep }, (_, j) => rows[Math.round((j * (rows.length - 1)) / Math.max(1, keep - 1))]);
  return { passages: [...new Set(sample)], chapters: rows.map(r => r.chapter), sampled: true };
}

const NOTES_PROMPT = (title, about) => `You read chapters of a novel and note how ONE storyline develops in them: "${title}"${about ? ` (${about})` : ''}.
JSON only: {"facts": [{"about": "event|turn|conflict|stakes|theme|people|place|outcome", "fact": "one short statement", "chapter": the number after # in the excerpt's [#N ...] header, "with": "a person or place named in it"}]}
Only what these chapters show about this storyline; skip what belongs to other storylines. Nothing invented.`;

const PROFILE_PROMPT = `You write the profile of one storyline (plotline) of a novel from notes taken while reading its chapters. JSON only:
{"type": "${TYPES.join('|')}", "description": "", "themes": "", "conflicts": "",
 "people": ["names from the cast list"], "places": ["names from the places list"], "related": ["titles from the other plotlines list"],
 "sources": {"description": [2, 5, 9], "conflicts": [5]}}
Rules:
- type: main for the book's central storyline, subplot for a secondary one, backstory for events before the story.
- description: how the storyline develops from start to end, 3 to 6 sentences, naming people and events (the author knows the ending: say it).
- themes: the ideas it explores, a sentence or two. conflicts: what stands in the way and who opposes whom, a sentence or two.
- people, places, related: only names from the lists given, only ones that matter to this storyline.
- The CURRENT profile was written by the author: keep what it says unless the notes contradict it, and add to it.
- Use only what the notes support. sources: for EVERY field you filled, the chapter numbers of its notes.`;

const matchPlace = (name, places) => {
  const n = norm(name).toLowerCase();
  const hits = (places || []).filter(p => p?.name && placeVariants(p.name, p.aliases).some(v => v.toLowerCase() === n));
  return hits.length === 1 ? hits[0] : null;
};
const matchPlot = (title, plots, selfId) => {
  const n = norm(title).toLowerCase();
  const hits = (plots || []).filter(p => String(p.id) !== String(selfId) && norm(p.title).toLowerCase() === n);
  return hits.length === 1 ? hits[0] : null;
};

/**
 * plotline: as the author has it now ({id, title, description, chapters, linked*}).
 * book: the SAVED book (chapters, characters, locations, plotlines).
 * Returns { suggestions, links: [{list, id, name}], relationships: [], aliases: [], read }.
 */
export async function enhancePlotline({ plotline, book, report = async () => {} }) {
  const name = norm(plotline.title || plotline.name);
  const chapters = book.chapters || [];
  let found = plotPassages(chapters, plotline.chapters);
  if (!found.passages.length) {
    // no chapters recorded: the whole book in brief
    const digest = bookDigest(chapters);
    if (!digest) throw Object.assign(new Error('The book has no saved chapter text to read yet'), { status: 422 });
    found = { passages: [{ chapter: 0, heading: 'The whole book, chapter by chapter', text: digest }], chapters: chapters.map((c, i) => c.number ?? i + 1), sampled: true };
  }
  const { facts, read, steps } = await takeNotes({ name, found, title: book.title, notesPrompt: NOTES_PROMPT(name, cap(plotline.description, 300)), report });
  if (!facts.length) return { suggestions: [], links: [], relationships: [], aliases: [], read };

  const others = (book.plotlines || []).filter(p => String(p.id) !== String(plotline.id) && p.title);
  const profile = await writeProfile({
    prompt: PROFILE_PROMPT, title: book.title, name, kind: 'Plotline', item: plotline, fields: [...SHORT_FIELDS, ...LONG_FIELDS],
    extra: [
      `Cast: ${(book.characters || []).map(c => norm(c.name)).filter(Boolean).slice(0, 120).join(', ') || 'none'}`,
      `Places: ${(book.locations || []).map(l => norm(l.name)).filter(Boolean).slice(0, 120).join(', ') || 'none'}`,
      `Other plotlines: ${others.map(p => norm(p.title)).slice(0, 60).join(', ') || 'none'}`,
    ],
    facts, report, steps,
  });
  profile.type = TYPES.find(t => same(t, profile.type)) || '';

  const links = [];
  const add = (list, hit) => {
    if (!hit) return;
    if ((plotline[list] || []).some(id => String(id) === String(hit.id)) || links.some(l => l.list === list && String(l.id) === String(hit.id))) return;
    links.push({ list, id: hit.id, name: norm(hit.name || hit.title) });
  };
  for (const n of Array.isArray(profile.people) ? profile.people.slice(0, 12) : []) add('linkedCharacters', matchCast(n, book.characters));
  for (const n of Array.isArray(profile.places) ? profile.places.slice(0, 12) : []) add('linkedLocations', matchPlace(n, book.locations));
  for (const n of Array.isArray(profile.related) ? profile.related.slice(0, 8) : []) add('linkedPlotlines', matchPlot(n, book.plotlines, plotline.id));

  return { suggestions: fieldSuggestions(profile, plotline, SHORT_FIELDS, LONG_FIELDS), links, relationships: [], aliases: [], read };
}
