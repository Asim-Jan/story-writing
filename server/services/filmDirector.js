import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { saiImage } from '../saiClient.js';
import { mediaStorage } from './mediaStorage.js';
import { recordMediaOwner } from '../utils/mediaMapping.js';
import { describeCharacter, mediaUrlToDataUrl } from './characterReferences.js';
import { VideoGenerator } from './videoGenerator.js';

// Consistent films. Clips made from text alone each invent their own look:
// one scene lifelike, the next animated, the characters different every time.
// Each scene now goes through a KEYFRAME:
//   1. Qwen Image 2.1 draws the opening frame from the scene, with every
//      character's portrait as a reference image (the bridge takes several)
//      plus the previous clip's last frame, in ONE locked style for the film;
//   2. the video model animates from that keyframe (it is the clip's first
//      frame), with the same style in its prompt;
//   3. the new clip's last frame becomes the next scene's continuity reference.

export const FILM_STYLES = {
  animated: {
    label: 'Animated (3D)',
    prompt: 'stylised 3D animated feature film, expressive character design, soft cinematic lighting, rich colour',
    negative: 'photorealistic, live action, photograph, real people, 2D anime, sketch',
  },
  anime: {
    label: 'Anime',
    prompt: '2D anime film, clean cel shading, crisp line art, painted backgrounds',
    negative: 'photorealistic, live action, photograph, 3D render, CGI',
  },
  'live-action': {
    label: 'Live action',
    prompt: 'photorealistic live-action film, natural cinematic lighting, shot on 35mm, realistic skin and fabric',
    negative: 'cartoon, anime, 3D render, CGI character, illustration, painting',
  },
  storybook: {
    label: 'Storybook',
    prompt: 'painterly storybook illustration, soft watercolour and gouache textures, warm light',
    negative: 'photorealistic, live action, photograph, 3D render, anime',
  },
  comic: {
    label: 'Comic book',
    prompt: 'animated graphic novel, bold ink lines, flat colours with halftone shading',
    negative: 'photorealistic, live action, photograph, 3D render, watercolour',
  },
  painting: {
    label: 'Painted',
    prompt: 'animated digital painting, fantasy book illustration come to life, painterly brushwork, dramatic lighting',
    negative: 'photograph, photorealistic, live action, 3D render, anime, cartoon',
  },
};

export function filmStyle(key) {
  return FILM_STYLES[key] || FILM_STYLES.animated;
}

// A scene names its characters; find them in the book: full name, then first name.
export function matchCast(names = [], bookCharacters = []) {
  const found = [];
  for (const raw of names) {
    const name = String(raw || '').trim().toLowerCase();
    if (!name) continue;
    const character = bookCharacters.find(c => String(c.name || '').trim().toLowerCase() === name)
      || bookCharacters.find(c => String(c.name || '').trim().toLowerCase().split(/\s+/)[0] === name.split(/\s+/)[0]);
    if (character && !found.some(f => f.character === character)) found.push({ name: raw, character });
  }
  return found;
}

// The picture that stands for a character: the main portrait, else the newest
// portrait reference.
export function referenceImageOf(character) {
  if (character?.imageUrl) return character.imageUrl;
  const portrait = (character?.referenceImages || []).find(r => r.kind === 'portrait');
  return portrait?.imageUrl || null;
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
});

// The clip's last frame, as a data: URL for the next keyframe.
async function lastFrame(videoBuffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  try {
    const clip = path.join(dir, 'clip.mp4');
    const frame = path.join(dir, 'last.png');
    fs.writeFileSync(clip, videoBuffer);
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-sseof', '-0.25', '-i', clip, '-frames:v', '1', frame]);
    return `data:image/png;base64,${fs.readFileSync(frame).toString('base64')}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function keyframePrompt({ scene, style, cast, hasPrevious, previous }) {
  const lines = [`${style.prompt}.`, `Opening frame of a film scene: ${scene.visualPrompt || scene.title || ''}`];
  if (scene.cameraDirection) lines.push(`Camera: ${scene.cameraDirection}.`);
  if (scene.location) lines.push(`Setting: ${scene.location}.`);
  if (scene.mood) lines.push(`Mood: ${scene.mood}.`);
  cast.forEach((c, i) => {
    lines.push(c.ref
      ? `The person in image ${i + 1} is ${c.character.name} (${describeCharacter(c.character)}).`
      : `${c.character.name}: ${describeCharacter(c.character)}.`);
  });
  if (cast.some(c => c.ref)) {
    lines.push('Keep every character exactly as in their reference image: same face, hair, body, clothes and colours.');
  }
  if (hasPrevious) {
    const n = cast.filter(c => c.ref).length + 1;
    const sameSetting = previous?.location && scene.location && previous.location === scene.location;
    lines.push(sameSetting
      ? `Image ${n} is the previous shot: this continues straight from it, in the same place, lighting and time of day.`
      : `Image ${n} is the previous shot: match its art style, colour palette and character designs.`);
  }
  if (previous?.action || previous?.title) lines.push(`Just before this: ${previous.action || previous.title}.`);
  lines.push('No text, captions or watermarks.');
  return lines.join(' ').slice(0, 2400);
}

/**
 * Render every scene with keyframes and continuity. onProgress gets
 * { stage: 'keyframe' | 'generating' | 'scene-complete' | 'scene-failed', sceneNumber, ... }.
 * Returns one result per scene (status 'completed' with videoUrl, keyframeUrl,
 * cast; or 'failed' with error).
 */
export async function directFilm({ user, bookId, book, scenes, styleKey, onProgress = () => {} }) {
  const style = filmStyle(styleKey);
  const generator = new VideoGenerator(null, bookId);
  const results = [];
  let previousFrame = null;
  let previousScene = null;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const base = { sceneNumber: scene.sceneNumber, current: i + 1, total: scenes.length };
    // the scene's cast with their portraits, at most 4 (the bridge takes 6
    // references; one is kept for the previous shot)
    const cast = matchCast(scene.characters || [], book.characters || []).slice(0, 4);
    for (const c of cast) {
      const url = referenceImageOf(c.character);
      if (!url) continue;
      try {
        c.ref = await mediaUrlToDataUrl(user, url);
      } catch (err) {
        console.warn(`Film: no usable portrait for ${c.character.name}:`, err.message);
      }
    }

    let keyframe = null;
    let keyframeUrl = null;
    try {
      await onProgress({ stage: 'keyframe', ...base });
      const refs = [...cast.filter(c => c.ref).map(c => c.ref), ...(previousFrame ? [previousFrame] : [])];
      const prompt = keyframePrompt({ scene, style, cast, hasPrevious: Boolean(previousFrame), previous: previousScene });
      const image = await saiImage({
        model: 'qwen-image-2.1',
        size: '1280x720',
        canvas: 'size', // 16:9 whatever the portraits' shape
        prompt,
        negative: style.negative,
        ...(refs.length === 1 ? { image: refs[0] } : {}),
        ...(refs.length > 1 ? { images: refs } : {}),
      });
      const filename = `keyframe-${uuidv4()}.png`;
      await mediaStorage.upload('images', image.buffer, filename, { 'x-amz-meta-type': 'film-keyframe' });
      await recordMediaOwner('images', filename, { ownerId: user.id || user.userId, bookId });
      keyframe = `data:image/png;base64,${image.buffer.toString('base64')}`;
      keyframeUrl = `/api/media/images/${filename}`;
    } catch (err) {
      // no keyframe: the clip is still drawn, from text, in the film's style
      console.warn(`Film: keyframe for scene ${scene.sceneNumber} failed, animating from text:`, err.message);
    }

    try {
      await onProgress({ stage: 'generating', ...base, keyframeUrl });
      // one retry: a render can fail on a transient Station error (seen
      // 2026-10-06: "weight is on cpu ... cuda:0"), and the next try usually works
      let clip;
      try {
        clip = await generator.generateSceneVideo(scene, { image: keyframe || undefined, stylePrompt: style.prompt, keepBuffer: true });
      } catch (err) {
        console.warn(`Film: scene ${scene.sceneNumber} clip failed, retrying once:`, err.message);
        await onProgress({ stage: 'generating', ...base, keyframeUrl, retry: true });
        clip = await generator.generateSceneVideo(scene, { image: keyframe || undefined, stylePrompt: style.prompt, keepBuffer: true });
      }
      const { buffer, ...stored } = clip;
      try {
        previousFrame = await lastFrame(buffer);
      } catch (err) {
        console.warn(`Film: could not take scene ${scene.sceneNumber}'s last frame:`, err.message);
        previousFrame = keyframe;
      }
      previousScene = scene;
      const result = { ...scene, ...stored, status: 'completed', keyframeUrl, cast: cast.map(c => c.character.name) };
      results.push(result);
      await onProgress({ stage: 'scene-complete', ...base, keyframeUrl, result });
    } catch (err) {
      results.push({ sceneNumber: scene.sceneNumber, status: 'failed', error: err.message, keyframeUrl });
      await onProgress({ stage: 'scene-failed', ...base, keyframeUrl, error: err.message });
    }
  }
  return results;
}
