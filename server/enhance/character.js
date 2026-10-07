import { nameVariants } from './passages.js';
import { norm, same, cap, takeNotes, writeProfile, fieldSuggestions, newAliases } from './common.js';

// Enhance a character from the book (a book media job, type 'enhance'): find
// the passages that mention them, take notes per batch with sai-chat-fast, then
// write the profile from the notes (shared steps: enhance/common.js). The
// result is a list of SUGGESTIONS, one per field that would change; the client
// shows them for the author to accept or skip. Nothing is written to the book.

export const SHORT_FIELDS = ['role', 'age', 'gender', 'skinColor', 'hairColor', 'eyeColor', 'height', 'weight', 'build'];
export const LONG_FIELDS = ['appearance', 'background', 'personality', 'arc', 'motivations', 'fears', 'quirks'];
export const RELATIONSHIP_TYPES = ['Family', 'Friend', 'Sibling', 'Parent', 'Child', 'Spouse', 'Partner', 'Love interest', 'Rival', 'Enemy', 'Mentor', 'Student', 'Colleague', 'Other'];

const NOTES_PROMPT = (name) => `You read excerpts from a novel and note everything they reveal about ONE character: ${name}.
JSON only: {"facts": [{"about": "looks|age|gender|history|personality|change|wants|fears|habits|name|relationship", "fact": "one short statement", "chapter": the number after # in the excerpt's [#N ...] header, "with": "the other person's name, for relationships only"}]}
Only facts the text states or clearly shows about ${name}, not about other people. Nothing invented. "change" is how they change or what happens to them over the story. "name" is another name or nickname that people call ${name} (not a name ${name} calls someone else).`;

const PROFILE_PROMPT = `You write a character profile for a novel from notes taken while reading it. JSON only:
{"role": "", "age": "", "gender": "", "skinColor": "", "hairColor": "", "eyeColor": "", "height": "", "weight": "", "build": "",
 "appearance": "", "background": "", "personality": "", "arc": "", "motivations": "", "fears": "", "quirks": "",
 "aliases": [], "relationships": [{"name": "", "type": "${RELATIONSHIP_TYPES.join('|')}", "description": ""}],
 "sources": {"hairColor": [3], "personality": [2, 5, 9]}}
Rules:
- Use only what the notes support. Leave a field "" when the book does not say; never guess.
- role, age, gender, skinColor, hairColor, eyeColor, height, weight, build: a few words each.
- appearance (other physical details: face, clothes, marks), background, personality, arc (how they change over the story), motivations, fears, quirks (habits, mannerisms, ways of speaking): 2 to 5 sentences each, specific to this book, naming people and events.
- The CURRENT profile was written by the author: keep what it says unless the notes contradict it, and add to it.
- relationships: only people from the cast list, by the name used there.
- aliases: other names or nicknames people call THIS character. Not their full name with a title added, not names they call others.
- relationships: Spouse only when married; Partner for a couple; Love interest for an attraction or a romance that has not settled.
- sources: for EVERY field you filled, the chapter numbers of the notes it came from (as in the example).`;


// who in the cast a name points at: the full name, or a unique first name / surname / alias
export function matchCast(name, cast, selfId) {
  const n = norm(name).toLowerCase();
  if (!n) return null;
  const others = (cast || []).filter(c => c?.name && String(c.id) !== String(selfId));
  const exact = others.filter(c => norm(c.name).toLowerCase() === n);
  if (exact.length === 1) return exact[0];
  const loose = others.filter(c => nameVariants(c.name, c.aliases).some(v => v.toLowerCase() === n) || n.split(' ').length > 1 && nameVariants(name).some(v => same(v, c.name)));
  return loose.length === 1 ? loose[0] : null;
}

/**
 * character: the profile as the author has it now. chapters: the saved book's
 * [{number, title, content}]. cast: the book's characters (for relationships).
 * Returns { suggestions: [{field, value, current, chapters}], relationships: [...],
 *           aliases: [...], read: {mentions, chapters, passages, sampled} }.
 */
export async function enhanceCharacter({ character, chapters, cast, title, report = async () => {} }) {
  const name = norm(character.name);
  const variants = nameVariants(name, character.aliases);
  const { facts, read, steps } = await takeNotes({ name, variants, chapters, title, notesPrompt: NOTES_PROMPT(name), report });
  if (!facts.length) return { suggestions: [], relationships: [], aliases: [], read };

  const castNames = (cast || []).filter(c => c?.name && String(c.id) !== String(character.id)).map(c => norm(c.name)).slice(0, 120);
  const profile = await writeProfile({
    prompt: PROFILE_PROMPT, title, name, kind: 'Character', item: character, fields: [...SHORT_FIELDS, ...LONG_FIELDS],
    extra: [`Cast: ${castNames.join(', ') || 'none'}`], facts, report, steps,
  });

  const have = new Set((character.relationships || []).map(r => String(r.characterId)));
  const relationships = [];
  for (const rel of Array.isArray(profile.relationships) ? profile.relationships : []) {
    const who = matchCast(rel?.name, cast, character.id);
    if (!who || have.has(String(who.id))) continue;
    have.add(String(who.id));
    const type = RELATIONSHIP_TYPES.find(t => same(t, rel.type)) || 'Other';
    relationships.push({ characterId: who.id, name: who.name, type, description: cap(rel.description, 300) });
  }

  return {
    suggestions: fieldSuggestions(profile, character, SHORT_FIELDS, LONG_FIELDS),
    relationships,
    aliases: newAliases(profile.aliases, name, variants),
    read,
  };
}
