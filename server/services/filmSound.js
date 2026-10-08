import { getSAIClient, SAI_CHAT, saiMusic } from '../saiClient.js';

// A film's sound beyond its clips (the SAI Cloud Film Studio's, for book
// films): ONE voice-over over the whole film, written to the running time and
// spoken in an audiobook voice, and a music bed. The join mixes them with the
// clips' own sound, which (with the music) dips under the narration.

export const WORDS_PER_SECOND = 2.3; // calm narration
export const MAX_VOICEOVER_CHARS = 4000;
export const MAX_MUSIC_SECONDS = 180;

const NARRATION_PROMPT = `You write the voice-over for a short film made from a chapter of a novel. One narrator speaks over the pictures from start to end.
JSON only: {"narration": "the words, plain text"}
- Fit the running time: about WORDS words in all (a calm pace), never more.
- Follow the scenes in order, so the words land on the right pictures.
- Tell what the pictures cannot show: thoughts, feelings, history, what is at stake. Do not describe what is plainly on screen.
- Use the book's own voice and names. Keep any narrator lines the screenplay has, if they fit.
- End on a closing line that lands.
- No stage directions, labels, quotation marks around the whole, or sound effects. Just the words to be spoken.`;

/**
 * scenes: [{ sceneNumber, title, visualPrompt, dialogue, duration }]; seconds:
 * the film's running time; screenplay: the transcript's text (optional).
 * Returns { narration, words, targetWords }.
 */
export async function writeNarration({ title, scenes, seconds, screenplay = '' }) {
  const targetWords = Math.max(8, Math.round(seconds * WORDS_PER_SECOND * 0.85));
  const lines = scenes.map((sc, i) => `Scene ${i + 1} (${Math.round(Number(sc.duration) || 5)} s): ${String(sc.title || '').slice(0, 80)}. ${String(sc.visualPrompt || '').slice(0, 500)}${sc.dialogue ? ` Dialogue: "${String(sc.dialogue).slice(0, 200)}"` : ''}`);
  const user = `Film: ${String(title || 'Untitled').slice(0, 120)}\nRunning time: ${Math.round(seconds)} seconds\n\nScenes:\n${lines.join('\n')}${screenplay ? `\n\nThe screenplay it was made from (for the book's voice and any narrator lines):\n${String(screenplay).slice(0, 12000)}` : ''}`;
  let narration = '';
  for (let attempt = 0; attempt < 2 && !narration; attempt++) {
    const completion = await getSAIClient().chat.completions.create({
      model: SAI_CHAT,
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1500,
      messages: [{ role: 'system', content: NARRATION_PROMPT.replace('WORDS', String(targetWords)) }, { role: 'user', content: user }],
    }, { timeout: 120000, maxRetries: 1 });
    const raw = completion.choices?.[0]?.message?.content || '';
    try {
      narration = String(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).narration || '').replace(/\s+/g, ' ').trim();
    } catch {
      narration = '';
    }
  }
  if (!narration) throw new Error('The narration came back empty twice');
  // never longer than the film can hold (a little over is cut at a sentence)
  const limit = Math.round(targetWords * 1.25);
  let words = narration.split(' ');
  if (words.length > limit) {
    const cut = words.slice(0, limit).join(' ');
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    narration = end > cut.length / 2 ? cut.slice(0, end + 1) : `${cut}...`;
    words = narration.split(' ');
  }
  return { narration: narration.slice(0, MAX_VOICEOVER_CHARS), words: words.length, targetWords };
}

/** A music bed: { mp3, seconds, model }. */
export async function makeMusic({ prompt, seconds }) {
  const s = Math.max(5, Math.min(MAX_MUSIC_SECONDS, Math.round(Number(seconds) || 30)));
  return saiMusic({ prompt: String(prompt).slice(0, 300), seconds: s });
}
