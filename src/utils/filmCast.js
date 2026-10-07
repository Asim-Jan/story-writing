// Film consistency helpers for the Animation Studio. The server draws every
// scene's keyframe from the cast's reference images in ONE locked style; these
// mirror its rules so the UI can show who will look consistent and who won't.

// One style per film (sent as options.style on the animation job).
// `portraitStyle` is the style a "Make portrait" reference is drawn in, so a
// new portrait already matches the film it is made for.
export const FILM_STYLES = [
  { id: 'animated', label: 'Animated', description: 'Stylised 3D animated film, soft lighting and expressive characters.', portraitStyle: 'stylised 3D animated film' },
  { id: 'anime', label: 'Anime', description: '2D anime with cel shading and clean line art.', portraitStyle: '2D anime, cel shading' },
  { id: 'live-action', label: 'Live action', description: 'Photoreal, like a live-action film shot on camera.', portraitStyle: 'photoreal cinematic photograph' },
  { id: 'storybook', label: 'Storybook', description: 'Painterly illustration, like a picture book come to life.', portraitStyle: 'painterly storybook illustration' },
  { id: 'comic', label: 'Comic book', description: 'Graphic novel art in motion: bold ink lines, flat colour.', portraitStyle: 'graphic novel comic art, bold ink lines, flat colours' },
  { id: 'painting', label: 'Painted', description: 'Digital painting, like a fantasy book illustration come to life.', portraitStyle: 'digital painting, fantasy book illustration' },
];

export const DEFAULT_FILM_STYLE = 'animated';

// How each scene begins after the previous one (mirrors the server's
// services/videoAssembler.js TRANSITIONS and transitionOf).
export const FILM_TRANSITIONS = [
  { id: 'continue', label: 'Continue the shot', hint: 'Starts from the last frame of the previous scene: no jump' },
  { id: 'cut', label: 'Cut', hint: 'Same moment, new camera angle, with a soft 0.25 s blend' },
  { id: 'dissolve', label: 'Dissolve', hint: 'A short time jump or another place (0.8 s)' },
  { id: 'fade', label: 'Fade through black', hint: 'A big jump in time (1.2 s)' },
];

export const sceneTransition = (scenes, index) => {
  if (index <= 0) return null;
  const scene = scenes[index];
  const own = String(scene?.transition || '').trim().toLowerCase();
  if (FILM_TRANSITIONS.some(t => t.id === own)) return own;
  const same = scene?.location && String(scene.location).trim().toLowerCase() === String(scenes[index - 1]?.location || '').trim().toLowerCase();
  return same ? 'cut' : 'dissolve';
};

export const filmStyle = (id) => FILM_STYLES.find(s => s.id === id) || FILM_STYLES[0];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const firstName = (s) => norm(s).split(' ')[0] || '';

// A scene's characters entry is normally a name; tolerate { name } objects.
const sceneName = (entry) => (typeof entry === 'string' ? entry : entry?.name || '');

// The character's reference image: the main image, else the newest portrait
// reference. referenceImages is kept newest first, but createdAt decides when
// present.
export const characterReferenceUrl = (character) => {
  if (!character) return null;
  if (character.imageUrl) return character.imageUrl;
  const portraits = (character.referenceImages || []).filter(r => r?.kind === 'portrait' && r.imageUrl);
  if (!portraits.length) return null;
  const stamp = (r) => Date.parse(r.createdAt || '') || 0;
  return portraits.reduce((best, r) => (stamp(r) > stamp(best) ? r : best), portraits[0]).imageUrl;
};

// Match a scene name to a book character: full name (case-insensitive), then
// first name. The first character in book order wins a tie.
export const matchCharacter = (name, characters = []) => {
  const full = norm(name);
  if (!full) return null;
  const byFull = characters.find(c => norm(c?.name) === full);
  if (byFull) return byFull;
  const first = firstName(name);
  return characters.find(c => firstName(c?.name) === first) || null;
};

// Everyone named in any scene: matched book characters (once each, with the
// scene numbers they appear in) and the names that match nobody.
export const buildCast = (scenes = [], characters = []) => {
  const matched = new Map();   // character id -> { character, scenes, referenceUrl }
  const unmatched = new Map(); // normalised name -> display name
  for (const scene of scenes) {
    for (const entry of scene?.characters || []) {
      const name = sceneName(entry).trim();
      if (!name) continue;
      const character = matchCharacter(name, characters);
      if (!character) {
        if (!unmatched.has(norm(name))) unmatched.set(norm(name), name);
        continue;
      }
      const row = matched.get(character.id) || { character, scenes: [], referenceUrl: characterReferenceUrl(character) };
      if (!row.scenes.includes(scene.sceneNumber)) row.scenes.push(scene.sceneNumber);
      matched.set(character.id, row);
    }
  }
  return { matched: [...matched.values()], unmatched: [...unmatched.values()] };
};
