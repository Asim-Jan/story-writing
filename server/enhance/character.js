import { askJson } from '../import/analyze.js';
import { nameVariants, findPassages, batchPassages } from './passages.js';

// Enhance a character from the book (a book media job, type 'enhance'): find
// the passages that mention them, take notes per batch with sai-chat-fast, then
// write the profile from the notes. The result is a list of SUGGESTIONS, one
// per field that would change; the client shows them for the author to accept
// or skip. Nothing is written to the book here.

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

const BLANK = /^(n\/?a|none|unknown|not (stated|specified|mentioned|given)|unspecified|-)\.?$/i;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const cap = (s, n) => (norm(s).length > n ? `${norm(s).slice(0, n - 1).replace(/\s+\S*$/, '')}...` : norm(s));
const chapterList = (v) => [...new Set((Array.isArray(v) ? v : [v]).map(x => String(x ?? '').match(/\d+/)?.[0]).filter(Boolean).map(Number))].slice(0, 12);

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
  const found = findPassages(chapters, nameVariants(name, character.aliases));
  const read = { mentions: found.mentions, chapters: found.chapters.length, passages: found.passages.length, sampled: found.sampled };
  if (!found.passages.length) {
    throw Object.assign(new Error(`"${name}" is not mentioned in the saved chapters`), { status: 422 });
  }

  const batches = batchPassages(found.passages);
  const facts = [];
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    await report({ message: `Reading the passages about ${name} (${i + 1} of ${batches.length})`, current: i, total: batches.length + 1 });
    try {
      const out = await askJson(NOTES_PROMPT(name), `Book: ${title || 'Untitled'}\n\n${batches[i]}`, 3000);
      for (const f of Array.isArray(out.facts) ? out.facts : []) {
        if (f?.fact) facts.push(`- [${f.about || 'other'}${f.with ? ` with ${f.with}` : ''}] ${cap(f.fact, 300)}${f.chapter ? ` (${cap(f.chapter, 40)})` : ''}`);
      }
    } catch (err) {
      failed++;
      console.warn(`enhance: notes batch ${i + 1} for "${name}" failed:`, err.message);
    }
  }
  if (failed === batches.length) throw new Error('The model could not read the passages');
  if (!facts.length) return { suggestions: [], relationships: [], aliases: [], read };

  await report({ message: `Writing ${name}'s profile`, current: batches.length, total: batches.length + 1 });
  const current = Object.fromEntries([...SHORT_FIELDS, ...LONG_FIELDS].map(f => [f, norm(character[f])]).filter(([, v]) => v));
  const castNames = (cast || []).filter(c => c?.name && String(c.id) !== String(character.id)).map(c => norm(c.name)).slice(0, 120);
  const profile = await askJson(PROFILE_PROMPT, [
    `Book: ${title || 'Untitled'}`,
    `Character: ${name}`,
    `CURRENT profile: ${JSON.stringify(current)}`,
    `Cast: ${castNames.join(', ') || 'none'}`,
    `Notes (${facts.length}):`,
    facts.slice(0, 600).join('\n'),
  ].join('\n\n'), 4000);

  const sources = profile.sources && typeof profile.sources === 'object' ? profile.sources : {};
  const suggestions = [];
  for (const field of [...SHORT_FIELDS, ...LONG_FIELDS]) {
    const raw = profile[field];
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const value = cap(raw, SHORT_FIELDS.includes(field) ? 80 : 1500);
    if (!value || BLANK.test(value) || same(value, character[field])) continue;
    suggestions.push({ field, value, current: norm(character[field]), chapters: chapterList(sources[field]) });
  }

  const have = new Set((character.relationships || []).map(r => String(r.characterId)));
  const relationships = [];
  for (const rel of Array.isArray(profile.relationships) ? profile.relationships : []) {
    const who = matchCast(rel?.name, cast, character.id);
    if (!who || have.has(String(who.id))) continue;
    have.add(String(who.id));
    const type = RELATIONSHIP_TYPES.find(t => same(t, rel.type)) || 'Other';
    relationships.push({ characterId: who.id, name: who.name, type, description: cap(rel.description, 300) });
  }

  const known = new Set(nameVariants(name, character.aliases).map(v => v.toLowerCase()));
  const aliases = [...new Set((Array.isArray(profile.aliases) ? profile.aliases : [])
    .map(a => cap(a, 60))
    // not the name again with a title ("Dr. Adam Carlsen"), not a note about someone else ("Kalamata (what he calls Olive)")
    .filter(a => a && !known.has(a.toLowerCase()) && !a.toLowerCase().includes(name.toLowerCase()) && !/[()]/.test(a)))].slice(0, 8);

  return { suggestions, relationships, aliases, read };
}
