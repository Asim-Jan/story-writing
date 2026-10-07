import { norm, takeNotes, writeProfile, fieldSuggestions, newAliases } from './common.js';

// Enhance a location from the book: the same steps as a character
// (enhance/common.js) with a place's fields. A place is matched by its full
// name (with or without a leading "The") and its other names only: the parts
// of "Gull Lighthouse" or "Black Forest" are ordinary words.

export const SHORT_FIELDS = ['type'];
export const LONG_FIELDS = ['description', 'atmosphere', 'history', 'significance'];

export function placeVariants(name, aliases = []) {
  const full = norm(name);
  const out = new Set([full, ...(Array.isArray(aliases) ? aliases : []).map(norm)].filter(v => v.length >= 2));
  const bare = full.replace(/^the\s+/i, '');
  if (bare !== full && bare.length >= 4) out.add(bare);
  return [...out];
}

const NOTES_PROMPT = (name) => `You read excerpts from a novel and note everything they reveal about ONE place: ${name}.
JSON only: {"facts": [{"about": "looks|kind|mood|history|events|people|name", "fact": "one short statement", "chapter": the number after # in the excerpt's [#N ...] header}]}
Only facts the text states or clearly shows about ${name}, not about other places. Nothing invented. "looks" is what it looks, sounds and smells like; "events" is what happens there; "people" is who lives, works or is often there; "name" is another name people use for ${name}.`;

const PROFILE_PROMPT = `You write a location profile for a novel from notes taken while reading it. JSON only:
{"type": "", "description": "", "atmosphere": "", "history": "", "significance": "", "aliases": [], "sources": {"description": [1, 4], "history": [7]}}
Rules:
- Use only what the notes support. Leave a field "" when the book does not say; never guess.
- type: a few words (city, village, house, room, tavern, forest, ship...).
- description: what it looks like, its layout and details, sounds and smells. atmosphere: its mood and feel, and how that changes over the story. history: its past as the book tells it. significance: what happens there and why it matters to the story, naming the characters and events. 2 to 5 sentences each, specific to this book.
- The CURRENT profile was written by the author: keep what it says unless the notes contradict it, and add to it.
- aliases: other names people use for this place.
- sources: for EVERY field you filled, the chapter numbers of the notes it came from (as in the example).`;

/** Same contract as enhanceCharacter, without relationships. */
export async function enhanceLocation({ location, chapters, title, report = async () => {} }) {
  const name = norm(location.name);
  const variants = placeVariants(name, location.aliases);
  const { facts, read, steps } = await takeNotes({ name, variants, chapters, title, notesPrompt: NOTES_PROMPT(name), report });
  if (!facts.length) return { suggestions: [], relationships: [], aliases: [], read };
  const profile = await writeProfile({
    prompt: PROFILE_PROMPT, title, name, kind: 'Location', item: location, fields: [...SHORT_FIELDS, ...LONG_FIELDS], facts, report, steps,
  });
  return {
    suggestions: fieldSuggestions(profile, location, SHORT_FIELDS, LONG_FIELDS),
    relationships: [],
    aliases: newAliases(profile.aliases, name, variants),
    read,
  };
}
