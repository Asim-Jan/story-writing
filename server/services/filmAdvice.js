import { getSAIClient, SAI_CHAT, SAI_CHAT_FAST } from '../saiClient.js';
import { smallJpeg } from './keyframeCheck.js';
import { TRANSITIONS } from './filmShots.js';

// AI help on the Animation Studio's workbench (the SAI Cloud Film Studio's
// "Advise" and "Review"):
//   - the shot doctor looks at a scene's still (and the shot before it) and
//     says what is wrong with the picture, with a better scene description;
//   - the director reads the whole scene list and suggests pacing: scene
//     lengths, transitions, and a note per scene.
// Both only suggest; the author applies what they like.

const json = (raw) => JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));

const SHOT_PROMPT = `You are a film director checking the opening frame of one scene before it is animated.
Image 1 is that frame. Image 2, when given, is the previous shot.
JSON only: {"verdict": "good" or "fix", "notes": ["short, concrete observations: what works, what is wrong"], "prompt": "an improved scene description"}
- Compare the picture with what the scene should show: the people (how many, who, how they look), the place, the action, the camera, the mood.
- Name real problems: wrong number of people, someone drawn twice, wrong place or time of day, the action not visible, a framing that does not suit the camera direction, a jarring jump from the previous shot.
- "prompt": the scene description rewritten (50 to 90 words, one continuous moment) so the next drawing fixes the problems; keep the story content. If the frame is good, return the description unchanged.
- At most 5 notes.`;

/**
 * scene: { title, visualPrompt, cameraDirection, location, characters, mood };
 * still / previous: PNG/JPEG buffers. Returns { verdict, notes, prompt }.
 */
export async function adviseShot({ scene, still, previous = null }) {
  const images = [await smallJpeg(still), ...(previous ? [await smallJpeg(previous)] : [])];
  const text = `The scene: ${String(scene.title || '').slice(0, 120)}
What it should show: ${String(scene.visualPrompt || '').slice(0, 1200)}
Camera: ${String(scene.cameraDirection || 'not given').slice(0, 200)}
Place: ${String(scene.location || 'not given').slice(0, 200)}
People in it: ${(Array.isArray(scene.characters) ? scene.characters : []).slice(0, 8).join(', ') || 'none named'}
Mood: ${String(scene.mood || 'not given').slice(0, 120)}`;
  const completion = await getSAIClient().chat.completions.create({
    model: SAI_CHAT_FAST,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 900,
    messages: [
      { role: 'system', content: SHOT_PROMPT },
      { role: 'user', content: [{ type: 'text', text }, ...images.map(b => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}` } }))] },
    ],
  }, { timeout: 90000, maxRetries: 1 });
  const out = json(completion.choices?.[0]?.message?.content || '{}');
  const notes = (Array.isArray(out.notes) ? out.notes : []).map(n => String(n || '').trim()).filter(Boolean).slice(0, 5).map(n => n.slice(0, 300));
  const prompt = String(out.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return { verdict: out.verdict === 'good' ? 'good' : 'fix', notes, prompt: prompt || String(scene.visualPrompt || '') };
}

const REVIEW_PROMPT = `You are a film director reviewing the cut of a short film made from a chapter of a novel, scene by scene, before it is finished.
JSON only: {"overall": "two or three sentences on the film as a whole: pacing, flow, what to fix first", "scenes": [{"sceneNumber": n, "note": "one short, concrete suggestion", "duration": seconds or null, "transition": "cut" | "dissolve" | "fade" | "continue" | null}]}
- Pacing: a quiet or emotional moment may need longer (up to 10 s); quick action or a passing beat shorter (3 to 5 s). Suggest a duration only when it should change.
- Transitions (how a scene begins): "continue" carries on the same shot; "cut" is the same moment from a new angle; "dissolve" is a short jump in time or place; "fade" (through black) a big jump. Suggest one only when the current one is wrong for the story.
- A note for every scene that needs one; skip scenes that are fine. At most one entry per scene.`;

/**
 * scenes: [{ sceneNumber, title, visualPrompt, duration, transition, clipSeconds }].
 * Returns { overall, scenes: [{ sceneNumber, note, duration?, transition? }] }.
 */
export async function reviewFilm({ title, scenes }) {
  const lines = scenes.map((sc, i) => `Scene ${sc.sceneNumber} (${i === 0 ? 'opens the film' : `begins with: ${sc.transition || 'cut'}`}; planned ${Math.round(Number(sc.duration) || 5)} s${sc.clipSeconds ? `, its clip runs ${Math.round(sc.clipSeconds)} s` : ', no clip yet'}): ${String(sc.title || '').slice(0, 80)}. ${String(sc.visualPrompt || '').slice(0, 400)}`);
  const completion = await getSAIClient().chat.completions.create({
    model: SAI_CHAT,
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 2500,
    messages: [{ role: 'system', content: REVIEW_PROMPT }, { role: 'user', content: `Film: ${String(title || 'Untitled').slice(0, 120)}\n\n${lines.join('\n')}` }],
  }, { timeout: 120000, maxRetries: 1 });
  const out = json(completion.choices?.[0]?.message?.content || '{}');
  const known = new Set(scenes.map(sc => Number(sc.sceneNumber)));
  const seen = new Set();
  const rows = [];
  for (const row of Array.isArray(out.scenes) ? out.scenes : []) {
    const n = Number(row?.sceneNumber);
    if (!known.has(n) || seen.has(n)) continue;
    seen.add(n);
    const duration = Number(row.duration);
    const transition = TRANSITIONS[row.transition] ? row.transition : null;
    const first = Number(scenes[0]?.sceneNumber) === n;
    rows.push({
      sceneNumber: n,
      note: String(row.note || '').trim().slice(0, 300),
      ...(Number.isFinite(duration) && duration >= 2 && duration <= 10 ? { duration: Math.round(duration) } : {}),
      ...(transition && !first ? { transition } : {}),
    });
  }
  return { overall: String(out.overall || '').trim().slice(0, 800), scenes: rows.filter(r => r.note || r.duration || r.transition) };
}
