import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { saiImage } from '../saiClient.js';
import { mediaStorage } from './mediaStorage.js';
import { recordMediaOwner, canAccessMedia } from '../utils/mediaMapping.js';
import { describeCharacter, mediaUrlToDataUrl } from './characterReferences.js';
import { VideoGenerator } from './videoGenerator.js';
import { transitionOf } from './filmShots.js';
import { matchLocation, describeLocation } from './filmLocations.js';
import { checkKeyframe } from './keyframeCheck.js';

// Consistent films. Clips made from text alone each invent their own look:
// one scene lifelike, the next animated, the characters different every time.
// Each scene now goes through a KEYFRAME:
//   1. Qwen Image 2.1 draws the opening frame from the scene, with every
//      character's portrait as a reference image (the bridge takes several)
//      plus the previous clip's last frame, in ONE locked style for the film;
//   2. the video model animates from that keyframe (it is the clip's first
//      frame), with the same style in its prompt;
//   3. the new clip's last frame becomes the next scene's continuity reference.
// A scene whose transition is "continue" skips the keyframe: its clip starts
// from the previous clip's exact last frame, so the shot carries on with no
// jump. At most MAX_CONTINUES in a row (each generation from a last frame
// softens the picture and lets faces drift), and never from a dark frame.

const MAX_CONTINUES = 2;
const DARK_LUMA = 24; // mean brightness (0-255) below which a frame is "faded out"

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

// A scene names its characters; find them in the book: full name, an "also
// known as" name, then first name. One person is one portrait: two forms of a
// name ("Olive", "Olive Smith"), even as two entries in the book, match once
// (the entry with a picture wins), or the keyframe draws her twice.
const lowerName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const nameWords = (s) => lowerName(s).replace(/[^\p{L}\p{N}' -]/gu, ' ').split(/\s+/).filter(w => w.length > 1);
const formsOf = (c) => [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])].map(lowerName).filter(Boolean);
// "olive" and "olive smith" (or "dr. olive smith"): one's words are all in the other's
const sameNameForm = (a, b) => {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every(w => long.includes(w));
};

export function matchCast(names = [], bookCharacters = []) {
  const found = [];
  for (const raw of names) {
    const name = lowerName(raw);
    if (!name) continue;
    const character = bookCharacters.find(c => lowerName(c.name) === name)
      || bookCharacters.find(c => formsOf(c).includes(name))
      || bookCharacters.find(c => lowerName(c.name).split(' ')[0] === name.split(' ')[0]);
    if (!character) continue;
    const same = found.findIndex(f => f.character === character
      || formsOf(f.character).some(a => formsOf(character).some(b => sameNameForm(a, b))));
    if (same === -1) found.push({ name: raw, character });
    else if (!referenceImageOf(found[same].character) && referenceImageOf(character)) found[same] = { name: raw, character };
  }
  return found;
}

// The picture that stands for a character: one picture of ONE person. A
// reference sheet (turnaround, expressions) shows them several times over and
// the keyframe copies that, so a portrait is preferred over a sheet, even when
// the sheet is the main picture.
const SHEET_KINDS = new Set(['turnaround', 'turnaround-quad', 'expressions', 'qwen-sheet']);
export function castReference(character) {
  const refs = Array.isArray(character?.referenceImages) ? character.referenceImages : [];
  const portrait = refs.find(r => r.kind === 'portrait' && r.imageUrl);
  const main = character?.imageUrl || null;
  const mainIsSheet = Boolean(main && refs.some(r => r.imageUrl === main && SHEET_KINDS.has(r.kind)));
  if (main && !mainIsSheet) return { url: main, sheet: false };
  if (portrait) return { url: portrait.imageUrl, sheet: false };
  return main ? { url: main, sheet: true } : null;
}
export function referenceImageOf(character) {
  return castReference(character)?.url || null;
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
});

const luma = (file) => new Promise((resolve) => {
  const p = spawn(ffmpegPath, ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('exit', () => resolve(Number((err.match(/YAVG=([\d.]+)/) || [])[1])));
});

/**
 * The clip's closing frame, as a data: URL for the next scene. The very last
 * frame when it is lit (exact = true: a "continue" can start from it); when
 * the clip fades out, a frame from a second earlier (exact = false), and when
 * that is dark too, null (the caller falls back to the keyframe). A faded
 * black frame was being handed on as "the previous shot".
 */
async function closingFrame(videoBuffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  try {
    const clip = path.join(dir, 'clip.mp4');
    const last = path.join(dir, 'last.png');
    const earlier = path.join(dir, 'earlier.png');
    fs.writeFileSync(clip, videoBuffer);
    // -update 1 keeps overwriting, so the file ends as the final frame
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', clip, '-update', '1', last]);
    const dataUrl = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    if (!((await luma(last)) < DARK_LUMA)) return { frame: dataUrl(last), exact: true };
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-sseof', '-1.2', '-i', clip, '-frames:v', '1', earlier]);
    if (!((await luma(earlier)) < DARK_LUMA)) return { frame: dataUrl(earlier), exact: false };
    return { frame: null, exact: false };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function keyframePrompt({ scene, style, cast, hasPrevious, previous, transition, place, continuing = false }) {
  const lines = [`${style.prompt}.`, `Opening frame of a film scene: ${scene.visualPrompt || scene.title || ''}`];
  if (scene.cameraDirection) lines.push(`Camera: ${scene.cameraDirection}.`);
  // the book's own description of the place (it was the bare name)
  if (place) lines.push(`Setting (the wider place): ${describeLocation(place.location)}.`);
  else if (scene.location) lines.push(`Setting: ${scene.location}.`);
  if (scene.mood) lines.push(`Mood: ${scene.mood}.`);
  // the image numbers follow the references actually sent
  let n = 0;
  cast.forEach((c) => {
    if (!c.ref) {
      lines.push(`${c.character.name}: ${describeCharacter(c.character)}.`);
      return;
    }
    n += 1;
    lines.push(c.sheet
      ? `Image ${n} is a character sheet of ${c.character.name} (${describeCharacter(c.character)}): ONE person shown from several angles; draw them once.`
      : `The person in image ${n} is ${c.character.name} (${describeCharacter(c.character)}).`);
  });
  if (cast.some(c => c.ref)) {
    // clothes from the scene: a portrait in a lab coat and a scene in a wrap
    // dress made the model draw her twice, once in each
    lines.push('Keep each character\'s face, hair, skin and build exactly as in their reference image. Dress them as this scene describes; where it does not say, as in their reference image.');
  }
  if (cast.length) {
    lines.push(`Each named character (${cast.map(c => c.character.name).join(', ')}) appears in the frame exactly once: never two copies of the same person.`);
  }
  const castRefs = n;
  if (place?.ref) {
    // the shot may be a corner or an inside of the place (a workshop in the
    // Undergrid), so its look, not its layout
    lines.push(`Image ${castRefs + 1} shows ${place.location.name}, where this shot takes place (this may be a different part of it, closer in or inside): match its look, materials, lighting style and colour palette.`);
  }
  if (hasPrevious) {
    const m = castRefs + (place?.ref ? 1 : 0) + 1;
    const sameSetting = previous?.location && scene.location && previous.location === scene.location;
    // a new shot of the same moment must not repeat the framing: the same
    // angle with the character in a new pose is a jump cut
    if (continuing) {
      // a storyboard still for a shot that carries on: the next moment of the
      // same shot (the clip itself starts from the previous clip's last frame)
      lines.push(`Image ${m} is the previous shot: this is the SAME shot a moment later; keep its framing, lighting and where everyone stands, and show the next moment.`);
    } else if (sameSetting && (transition === 'cut' || transition === 'continue')) {
      lines.push(`Image ${m} is the previous shot. This is a NEW camera angle on the same moment, in the same place, lighting and time of day: use a clearly different shot size and angle from image ${m} (for example wide to close-up, or a reverse angle); do not repeat its framing.`);
    } else if (sameSetting) {
      lines.push(`Image ${m} is the previous shot: a little later, in the same place; keep its lighting, art style and character designs, with a different framing.`);
    } else {
      lines.push(`Image ${m} is the previous shot: match its art style, colour palette and character designs.`);
    }
    if (cast.length) lines.push(`The people in image ${m} are the same characters, not additional ones.`);
  }
  if (previous?.action || previous?.title) lines.push(`Just before this: ${previous.action || previous.title}.`);
  lines.push('No text, captions or watermarks.');
  return lines.join(' ').slice(0, 2800);
}

// The scene's cast with their portraits (at most 4: the bridge takes 6
// references, one kept for the place and one for the previous shot).
async function prepareCast(user, book, scene) {
  const cast = matchCast(scene.characters || [], book.characters || []).slice(0, 4);
  for (const c of cast) {
    const pick = castReference(c.character);
    if (!pick) continue;
    try {
      c.ref = await mediaUrlToDataUrl(user, pick.url);
      c.sheet = pick.sheet;
    } catch (err) {
      console.warn(`Film: no usable portrait for ${c.character.name}:`, err.message);
    }
  }
  return cast;
}

// The scene's place in the book, with its picture as a reference.
async function preparePlace(user, book, scene, withPicture) {
  const location = matchLocation(scene.location, book.locations);
  const place = location ? { location, ref: null } : null;
  if (place && location.imageUrl && withPicture) {
    try {
      place.ref = await mediaUrlToDataUrl(user, location.imageUrl);
    } catch (err) {
      console.warn(`Film: no usable picture for ${location.name}:`, err.message);
    }
  }
  return place;
}

const storeImage = async (user, bookId, buffer) => {
  const filename = `keyframe-${uuidv4()}.png`;
  await mediaStorage.upload('images', buffer, filename, { 'x-amz-meta-type': 'film-keyframe' });
  await recordMediaOwner('images', filename, { ownerId: user.id || user.userId, bookId });
  return `/api/media/images/${filename}`;
};

/**
 * Draw one scene's opening frame (Qwen Image 2.1) from its cast, place and the
 * previous shot, look at it, and redraw once if someone appears twice.
 * Returns { buffer, url, check }.
 */
async function drawKeyframe({ user, bookId, style, scene, cast, place, previousFrame, previousScene, transition, continuing = false, onRedraw = async () => {} }) {
  const refs = [...cast.filter(c => c.ref).map(c => c.ref), ...(place?.ref ? [place.ref] : []), ...(previousFrame ? [previousFrame] : [])];
  const prompt = keyframePrompt({ scene, style, cast, hasPrevious: Boolean(previousFrame), previous: previousScene, transition, place, continuing });
  const draw = (extra = '') => saiImage({
    model: 'qwen-image-2.1',
    size: '1280x720',
    canvas: 'size', // 16:9 whatever the portraits' shape
    prompt: `${extra}${prompt}`,
    negative: `${style.negative}, the same person twice, duplicated person, clone, twins`,
    ...(refs.length === 1 ? { image: refs[0] } : {}),
    ...(refs.length > 1 ? { images: refs } : {}),
  });
  let image = await draw();
  let keyframeCheck = null;
  // someone drawn twice: redraw once, saying so (keyframeCheck.js)
  if (cast.length) {
    const castLooks = cast.map(c => ({ name: c.character.name, look: describeCharacter(c.character).slice(0, 200) }));
    let check = await checkKeyframe({ pngBuffer: image.buffer, scene, cast: castLooks });
    keyframeCheck = check ? { ...check, redrawn: false } : null;
    if (check?.duplicated) {
      await onRedraw();
      image = await draw(`IMPORTANT: draw each person ONCE. A first attempt showed the same person twice (${check.note || 'a duplicate'}). `);
      check = await checkKeyframe({ pngBuffer: image.buffer, scene, cast: castLooks });
      keyframeCheck = { ...(check || {}), redrawn: true };
    }
  }
  const url = await storeImage(user, bookId, image.buffer);
  return { buffer: image.buffer, url, check: keyframeCheck };
}

const dataUrlOf = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

/**
 * The storyboard: every scene's opening frame as a still, in order, each drawn
 * with the previous scene's still as "the previous shot", and no video. A
 * still takes seconds where a clip takes minutes, so the author fixes the
 * pictures first. scenes[i].previousStill: the still before the first scene
 * drawn here (when the batch starts mid-film). onProgress gets
 * { stage: 'still' | 'still-done' | 'still-failed', sceneNumber, ... }.
 * Returns [{ sceneNumber, status, url, check, error }].
 */
export async function drawStoryboard({ user, bookId, book, scenes, styleKey, onProgress = () => {} }) {
  const style = filmStyle(styleKey);
  const results = [];
  let previousFrame = null;
  let previousScene = null;
  if (scenes[0]?.previousStill) {
    try {
      previousFrame = await mediaUrlToDataUrl(user, scenes[0].previousStill);
      previousScene = scenes[0].previousScene || null;
    } catch (err) {
      console.warn('Storyboard: the still before this batch is not usable:', err.message);
    }
  }
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const base = { sceneNumber: scene.sceneNumber, current: i + 1, total: scenes.length };
    try {
      await onProgress({ stage: 'still', ...base });
      const cast = await prepareCast(user, book, scene);
      const transition = transitionOf(scene, previousScene);
      const continuing = transition === 'continue' && Boolean(previousFrame);
      const place = await preparePlace(user, book, scene, !continuing);
      const drawn = await drawKeyframe({ user, bookId, style, scene, cast, place, previousFrame, previousScene, transition, continuing });
      previousFrame = dataUrlOf(drawn.buffer);
      previousScene = scene;
      const row = { sceneNumber: scene.sceneNumber, status: 'completed', url: drawn.url, ...(drawn.check ? { check: drawn.check } : {}) };
      results.push(row);
      await onProgress({ stage: 'still-done', ...base, result: row });
    } catch (err) {
      results.push({ sceneNumber: scene.sceneNumber, status: 'failed', error: err.message });
      await onProgress({ stage: 'still-failed', ...base, error: err.message });
    }
  }
  return results;
}

/**
 * Render every scene with keyframes and continuity. onProgress gets
 * { stage: 'keyframe' | 'generating' | 'scene-complete' | 'scene-failed', sceneNumber, ... }.
 * A scene may bring:
 *   still      the storyboard still to animate (instead of drawing one); a
 *              "continue" still starts from the previous clip's last frame
 *   reuseTake  { filename, videoUrl, keyframeUrl, duration }: a clip already
 *              made, kept as it is (not rendered again); the next scene can
 *              still continue from its last frame
 * Returns one result per scene (status 'completed' with videoUrl, keyframeUrl,
 * cast; or 'failed' with error).
 */
export async function directFilm({ user, bookId, book, scenes, styleKey, onProgress = () => {} }) {
  const style = filmStyle(styleKey);
  const generator = new VideoGenerator(null, bookId);
  const results = [];
  let previousFrame = null;
  let previousExact = false; // previousFrame is the clip's true last frame
  let previousScene = null;
  let continues = 0; // "continue" shots in a row

  const carryOn = async (buffer, keyframe) => {
    try {
      const closing = await closingFrame(buffer);
      previousFrame = closing.frame || keyframe;
      previousExact = closing.exact;
    } catch (err) {
      console.warn('Film: could not take the last frame:', err.message);
      previousFrame = keyframe;
      previousExact = false;
    }
  };

  for (let i = 0; i < scenes.length; i++) {
    const { still, reuseTake, previousStill, previousScene: _ps, ...scene } = scenes[i];
    const base = { sceneNumber: scene.sceneNumber, current: i + 1, total: scenes.length };

    // a take kept from before: no render; its last frame carries on
    if (reuseTake?.filename) {
      try {
        if (!(await canAccessMedia(user, 'videos', reuseTake.filename, 'read'))) throw new Error('That clip is not one of yours');
        const buffer = await mediaStorage.getFile('videos', reuseTake.filename);
        await carryOn(buffer, null);
        const transition = transitionOf(scene, previousScene);
        continues = transition === 'continue' ? continues + 1 : 0;
        previousScene = scene;
        const result = { ...scene, videoUrl: reuseTake.videoUrl || `/api/media/videos/${reuseTake.filename}`, filename: reuseTake.filename,
          ...(reuseTake.duration ? { duration: reuseTake.duration } : {}), status: 'completed', keyframeUrl: reuseTake.keyframeUrl || null, reused: true };
        results.push(result);
        await onProgress({ stage: 'scene-complete', ...base, keyframeUrl: result.keyframeUrl, result });
      } catch (err) {
        results.push({ sceneNumber: scene.sceneNumber, status: 'failed', error: err.message });
        previousExact = false;
        await onProgress({ stage: 'scene-failed', ...base, error: err.message });
      }
      continue;
    }

    const cast = await prepareCast(user, book, scene);

    // what this scene actually gets: a "continue" needs the previous clip's
    // true last frame and a short enough run, else it becomes a cut
    let transition = transitionOf(scene, previousScene);
    const canContinue = transition === 'continue' && previousFrame && previousExact && continues < MAX_CONTINUES;
    if (transition === 'continue' && !canContinue) transition = 'cut';
    continues = canContinue ? continues + 1 : 0;

    // the scene's place in the book, with its picture as a reference (the
    // bridge takes 6 images: up to 4 portraits, the place, the previous shot)
    const location = matchLocation(scene.location, book.locations);
    const place = canContinue ? (location ? { location, ref: null } : null) : await preparePlace(user, book, scene, true);

    let keyframe = null;
    let keyframeUrl = null;
    let keyframeCheck = null; // { figures, duplicated, note, redrawn }
    if (canContinue) {
      keyframe = previousFrame;
      try {
        keyframeUrl = await storeImage(user, bookId, Buffer.from(previousFrame.split(',')[1], 'base64'));
      } catch (err) {
        console.warn(`Film: could not store scene ${scene.sceneNumber}'s opening frame:`, err.message);
      }
    } else {
      // the author's storyboard still, when they chose one
      if (still) {
        try {
          keyframe = await mediaUrlToDataUrl(user, still);
          keyframeUrl = still;
        } catch (err) {
          console.warn(`Film: scene ${scene.sceneNumber}'s still is not usable, drawing one:`, err.message);
        }
      }
      if (!keyframe) {
        try {
          await onProgress({ stage: 'keyframe', ...base });
          const drawn = await drawKeyframe({ user, bookId, style, scene, cast, place, previousFrame, previousScene, transition,
            onRedraw: () => onProgress({ stage: 'keyframe', ...base, redraw: true }) });
          keyframe = dataUrlOf(drawn.buffer);
          keyframeUrl = drawn.url;
          keyframeCheck = drawn.check;
        } catch (err) {
          // no keyframe: the clip is still drawn, from text, in the film's style
          console.warn(`Film: keyframe for scene ${scene.sceneNumber} failed, animating from text:`, err.message);
        }
      }
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
      await carryOn(buffer, keyframe);
      previousScene = scene;
      const result = { ...scene, ...stored, status: 'completed', keyframeUrl, cast: cast.map(c => c.character.name), ...(keyframeCheck ? { keyframeCheck } : {}), ...(transition ? { transition } : {}), ...(location ? { place: location.name } : {}) };
      results.push(result);
      await onProgress({ stage: 'scene-complete', ...base, keyframeUrl, result });
    } catch (err) {
      results.push({ sceneNumber: scene.sceneNumber, status: 'failed', error: err.message, keyframeUrl });
      // the next scene cannot carry on from a shot that does not exist
      previousExact = false;
      await onProgress({ stage: 'scene-failed', ...base, keyframeUrl, error: err.message });
    }
  }
  return results;
}
