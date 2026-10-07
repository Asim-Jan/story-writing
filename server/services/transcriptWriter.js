import { getSAIClient, SAI_CHAT } from '../saiClient.js';
import { plainText, nameVariants } from '../enhance/passages.js';
import { placeVariants } from '../enhance/location.js';
import { chapterHeading } from '../utils/chapters.js';
import { saiTextOf } from '../utils/saiText.js';
import { artStyleOf } from './artStyles.js';

// A chapter becomes an animation screenplay: the transcript the Animation
// Studio turns into scenes and the video model draws. It used to get the
// chapter (as HTML, with "undefined" for a missing summary) and only the NAMES
// of the cast and places, return the whole screenplay inside a JSON string,
// and guess "8-10 minutes" for 700 words. Now it gets how the people in the
// chapter look and what its places are like, must open every scene with a
// set-designer's SETTING paragraph and use the book's location names, writes
// plain text (no escaping to break), and a long chapter goes in parts.

const PART_CHARS = 24000; // ~4,000 words of prose per call
// The Studio makes about one shot per 70 words of screenplay (at most 30
// per film), each about 6 s: the estimate is the film it will make. The old
// "8-10 minutes" for 700 words was a page-a-minute guess the film never matched.
const WORDS_PER_SHOT = 70;
const SECONDS_PER_SHOT = 6;
const MAX_SHOTS = 30;

export const TRANSCRIPT_PROMPT = `You adapt one chapter of a novel into an animation screenplay. A storyboard artist and an AI video generator work from it, so everything they need to SEE must be on the page. Be thorough and faithful.

COVERAGE
- Adapt the WHOLE passage, in order: every scene, event and meaningful exchange. Do not summarise, skip or add plot. Trim only repetition.
- Keep the book's dialogue (shorten long speeches, keep their meaning). Turn inner thoughts into visible behaviour, or a short V.O. when they matter.

SCENES
- Start each scene with a heading: INT. or EXT. PLACE - TIME OF DAY. When the scene is at one of the book's locations, use its name EXACTLY as listed under Places.
- Directly under each heading write a SETTING paragraph (3 to 5 sentences) a set designer could build from: the space and its layout, materials and key set pieces, the light sources and colour palette, weather and time of day, and the background sound. Follow the book's description of the place when it has one, and describe a returning place the same way each time.
- When a character first appears in a scene, describe them in a short parenthetical: age, build, hair, face and what they are wearing, following the character notes. Keep their clothes the same within a scene unless the story changes them.
- Action lines say what the camera sees, in the present tense, concrete and physical: who moves where, expressions, props, weather. One visual beat per paragraph.
- Camera directions (WIDE, CLOSE ON, TRACKING, POV) where they help, and a transition between scenes (CUT TO:, DISSOLVE TO:, FADE OUT.).
- Sound effects and music cues in parentheses.
- No title cards or on-screen captions; text appears only where it exists in the world (a sign, a letter).
- Do not name an art style (no photorealistic, cartoon, anime, 3D): the film's style is set separately.

OUTPUT
Plain screenplay text only: no JSON, no markdown. The first line is TITLE: followed by the episode title.`;

// The author's optional direction for a transcript. Each choice becomes a
// concrete instruction for the writer and is kept on the transcript, so the
// shot breakdown follows it too (videoSceneParser: a slow pace = longer takes).
export const GUIDANCE = {
  pace: {
    slow: 'Slow and lingering: let moments breathe. Hold on faces, places and silences; give quiet beats their own action lines; favour long takes and gentle camera moves.',
    brisk: 'Brisk: keep it moving. Enter scenes late and leave early, cut between beats, keep action lines short and energetic.',
  },
  dialogue: {
    little: 'Little dialogue: tell the story visually. Keep only the lines that matter most, shortened; show the rest through action, looks and behaviour.',
    lots: 'Plenty of dialogue: keep most of the book\'s spoken lines, with reactions between them.',
  },
  shots: {
    cinematic: 'Cinematic: sweeping establishing shots, dramatic light and silhouettes, crane and dolly moves, strong composition and scale.',
    intimate: 'Intimate: close-ups and medium shots, faces and hands, small gestures, shallow focus, quiet light.',
    action: 'Action-driven: dynamic camera, tracking and handheld moves, impacts and motion in every shot.',
    documentary: 'Observational: naturalistic, handheld feel, available light, the camera watching rather than staging.',
  },
  narration: {
    none: 'No narrator and no voice-over: everything is shown or spoken in the scene.',
    narrator: 'A narrator: add a short voice-over (NARRATOR (V.O.)) that carries the book\'s voice between scenes and over key moments.',
  },
};
export const GUIDANCE_NOTES_MAX = 600;

/** The author's direction as cleaned values (unknown keys dropped), or null. */
export function cleanGuidance(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const key of Object.keys(GUIDANCE)) if (GUIDANCE[key][input[key]]) out[key] = input[key];
  const notes = String(input.notes || '').replace(/\s+/g, ' ').trim().slice(0, GUIDANCE_NOTES_MAX);
  if (notes) out.notes = notes;
  return Object.keys(out).length ? out : null;
}

/** The direction block for the writer's prompt ('' when there is none). */
export function guidanceText(guidance) {
  if (!guidance) return '';
  const lines = Object.keys(GUIDANCE).filter(k => guidance[k]).map(k => `- ${GUIDANCE[k][guidance[k]]}`);
  if (guidance.notes) lines.push(`- The author's notes: ${guidance.notes}`);
  return lines.length ? `DIRECTION FROM THE AUTHOR (follow it; it overrides the defaults above, but never drop story events):\n${lines.join('\n')}` : '';
}

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, variants) => variants.some(v => v.length >= 3 && new RegExp(`(^|[^\\p{L}])${escape(v)}($|[^\\p{L}])`, 'iu').test(text));

/** Split prose into parts of at most max characters, at paragraph breaks. */
export function splitChapter(text, max = PART_CHARS) {
  const paragraphs = String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const parts = [];
  let cur = '';
  for (const p of paragraphs) {
    if (cur && cur.length + p.length + 2 > max) { parts.push(cur); cur = ''; }
    if (p.length > max) {
      // one huge paragraph: cut at sentence ends
      for (const s of p.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) || [p]) {
        if (cur && cur.length + s.length > max) { parts.push(cur); cur = ''; }
        cur += s;
      }
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const LOOKS = [['age', 'age '], ['gender', ''], ['height', ''], ['build', 'build: '], ['skinColor', 'skin: '], ['hairColor', 'hair: '], ['eyeColor', 'eyes: ']];

/** Notes on the people in the text: how they look, from the book's profiles. */
export function castNotes(characters = [], text = '') {
  return (characters || [])
    .filter(c => c?.name && mentions(text, nameVariants(c.name, c.aliases)))
    .slice(0, 15)
    .map(c => {
      const looks = LOOKS.map(([f, label]) => (String(c[f] || '').trim() ? `${label}${String(c[f]).trim()}` : '')).filter(Boolean);
      const more = String(c.appearance || '').trim();
      return `- ${c.name}${c.role ? ` (${c.role})` : ''}: ${[looks.join(', '), more].filter(Boolean).join('. ').slice(0, 400) || 'no description in the book'}`;
    });
}

/** Notes on the places: the ones the text mentions in full, every name listed. */
export function placeNotes(locations = [], text = '') {
  const all = (locations || []).filter(l => l?.name);
  const here = all.filter(l => mentions(text, placeVariants(l.name, l.aliases))).slice(0, 12);
  const lines = here.map(l => `- ${l.name}${l.type ? ` (${l.type})` : ''}: ${[l.description, l.atmosphere].map(s => String(s || '').trim()).filter(Boolean).join(' ').slice(0, 500) || 'no description in the book'}`);
  const others = all.filter(l => !here.includes(l)).map(l => l.name).slice(0, 60);
  if (others.length) lines.push(`Other places in the book: ${others.join(', ')}`);
  return lines;
}

/** Scene count, words, and the length of the film the Studio will make from it. */
export function screenplayStats(screenplay) {
  const sceneCount = (String(screenplay || '').match(/^\s*(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/gim) || []).length;
  const w = words(screenplay);
  const shots = Math.min(MAX_SHOTS, Math.max(3, Math.round(w / WORDS_PER_SHOT)));
  const seconds = shots * SECONDS_PER_SHOT;
  const film = seconds < 90 ? `${Math.round(seconds / 5) * 5} seconds` : `${Math.round(seconds / 30) / 2} minutes`;
  return { sceneCount, words: w, shots, estimatedDuration: `about ${film} of film (${shots} shots)` };
}

/**
 * Write the transcript for one chapter of a book (the saved book).
 * report({ message, current, total }) per part. Returns the transcript record
 * fields: { title, transcript, sceneCount, estimatedDuration, parts }.
 */
export async function writeTranscript({ chapter, book, guidance = null, report = () => {} }) {
  const prose = plainText(chapter.content).trim();
  if (!prose) throw Object.assign(new Error('This chapter has no text to adapt yet'), { status: 400 });
  const heading = chapterHeading(chapter);
  const art = artStyleOf(book);
  const style = art ? (art.id === 'custom' ? art.prompt : art.label) : null;
  const parts = splitChapter(prose);
  const out = [];
  let title = '';
  for (let i = 0; i < parts.length; i++) {
    await report({ message: parts.length > 1 ? `Writing part ${i + 1} of ${parts.length}...` : 'Writing the screenplay...', current: i, total: parts.length });
    const cast = castNotes(book.characters, parts[i]);
    const places = placeNotes(book.locations, parts[i]);
    const previous = out.length ? out[out.length - 1].slice(-1500) : '';
    const user = [
      `Book: ${book.title || 'Untitled'}`,
      style ? `The film is drawn as: ${style} (fit the settings and lighting to it, but do not name it).` : '',
      `Chapter: ${heading}`,
      guidanceText(guidance),
      chapter.summary ? `Chapter summary: ${String(chapter.summary).slice(0, 800)}` : '',
      cast.length ? `Characters in this passage (how they look):\n${cast.join('\n')}` : '',
      places.length ? `Places:\n${places.join('\n')}` : '',
      parts.length > 1 ? `This is part ${i + 1} of ${parts.length} of the chapter.${previous ? ` The screenplay so far ends:\n"""\n${previous}\n"""\nContinue from there without repeating it, and with no TITLE line.` : ''}` : '',
      `Passage to adapt:\n"""\n${parts[i]}\n"""`,
    ].filter(Boolean).join('\n\n');
    const completion = await getSAIClient().chat.completions.create({
      model: SAI_CHAT,
      temperature: 0.5,
      max_tokens: 16000,
      messages: [{ role: 'system', content: TRANSCRIPT_PROMPT }, { role: 'user', content: user }],
    }, { timeout: 600000, maxRetries: 1 });
    let text = saiTextOf(completion.choices?.[0]).replace(/^```[a-z]*\n?|```\s*$/gim, '').trim();
    if (!text) throw new Error(`The model wrote nothing for part ${i + 1}`);
    const t = text.match(/^\s*TITLE:\s*(.+)$/im);
    if (t) {
      if (!title) title = t[1].trim().slice(0, 160);
      text = text.replace(t[0], '').trim();
    }
    out.push(text);
  }
  const transcript = out.join('\n\n');
  return { title: title || heading, transcript, ...screenplayStats(transcript), parts: parts.length, ...(guidance ? { guidance } : {}) };
}
