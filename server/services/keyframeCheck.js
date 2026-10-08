import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';

// A film keyframe sometimes shows one character TWICE: the image model is
// handed a portrait (her in one outfit) and a scene that dresses her in
// another, and draws both. A clip animated from that frame keeps both, so
// each keyframe is looked at before it is animated (sai-chat-fast sees
// images) and redrawn once when someone appears twice.

const PROMPT = `You check the opening frame of a film scene before it is animated. Look at the picture.
JSON only: {"figures": number of separate people visible, "duplicated": true or false, "note": "one short sentence"}
"duplicated" is true when two or more figures are clearly the SAME person drawn twice (same face, hair and build, even in different clothes or poses), like a clone or twin that the scene does not call for. Different people who merely look alike in the art style are not duplicated.`;

// a small JPEG for the model: a 1280x720 PNG is ~1-2 MB of tokens for nothing
export function smallJpeg(pngBuffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-'));
  const src = path.join(dir, 'in.png');
  const out = path.join(dir, 'out.jpg');
  fs.writeFileSync(src, pngBuffer);
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=640:-2', '-q:v', '4', out], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('exit', code => {
      try {
        if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.slice(-200)}`));
        resolve(fs.readFileSync(out));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

/**
 * pngBuffer: the keyframe. cast: the scene's named characters [{name, look}].
 * Returns { figures, duplicated, note } or null when the check could not run
 * (the keyframe is then used as it is).
 */
export async function checkKeyframe({ pngBuffer, scene, cast }) {
  try {
    const jpeg = await smallJpeg(pngBuffer);
    const who = cast.length
      ? cast.map(c => `- ${c.name}${c.look ? `: ${c.look}` : ''}`).join('\n')
      : '- (no named characters)';
    const completion = await getSAIClient().chat.completions.create({
      model: SAI_CHAT_FAST,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: [
          { type: 'text', text: `The scene: ${String(scene.visualPrompt || scene.title || '').slice(0, 1200)}\n\nIts named characters, each of whom should appear at most once:\n${who}` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
        ] },
      ],
    }, { timeout: 60000, maxRetries: 1 });
    const raw = completion.choices?.[0]?.message?.content || '';
    const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    return { figures: Number.isFinite(Number(out.figures)) ? Number(out.figures) : null, duplicated: out.duplicated === true, note: String(out.note || '').slice(0, 200) };
  } catch (err) {
    console.warn(`Film: keyframe check for scene ${scene?.sceneNumber} skipped:`, err.message);
    return null;
  }
}
