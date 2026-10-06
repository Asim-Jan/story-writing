import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { saiImage } from '../saiClient.js';
import { mediaStorage } from './mediaStorage.js';
import { canAccessMedia, recordMediaOwner } from '../utils/mediaMapping.js';

// Character reference images on the SAI media bridge.
//
// The turnaround sheets use the bridge's character-sheet recipes: FLUX.2 Klein
// edit + the TripleView / QuadView LoRA. They EDIT a picture of the character
// (front-facing, full body, plain background) into one composite sheet, so a
// sheet always needs a portrait first. Qwen Image 2.1 does the expression sheet
// and an alternative turnaround; it edits when given an image and draws from
// the description otherwise.

export const REFERENCE_KINDS = ['portrait', 'turnaround', 'turnaround-quad', 'expressions', 'qwen-sheet'];

const NEGATIVE = 'blurry, low detail, deformed hands, extra limbs, cropped figure, text, labels, watermark, signature, multiple different characters';

// "Elena, 32-year-old woman, olive skin, long black hair, green eyes, tall, athletic build, ..."
export function describeCharacter(character = {}) {
  const parts = [];
  const age = character.age ? `${character.age}-year-old` : '';
  const who = [age, character.gender].filter(Boolean).join(' ');
  parts.push([character.name, who].filter(Boolean).join(', ') || 'the character');
  if (character.skinColor) parts.push(`${character.skinColor} skin`);
  if (character.hairColor) parts.push(`${character.hairColor} hair`);
  if (character.eyeColor) parts.push(`${character.eyeColor} eyes`);
  if (character.height) parts.push(String(character.height));
  if (character.build) parts.push(`${character.build} build`);
  for (const field of ['appearance', 'clothing', 'outfit', 'distinguishingFeatures']) {
    if (character[field]) parts.push(String(character[field]));
  }
  if (character.role) parts.push(`(${character.role})`);
  return parts.join(', ').slice(0, 900);
}

/**
 * The prompt, model and size for one kind of reference. Pure: no AI call.
 * The copy-prompt route returns this as is, so it is also the "premade
 * prompt" a user can take to Qwen Image elsewhere.
 */
export function buildReferencePrompt(kind, character = {}, style = 'cinematic illustration', hasSourceImage = false) {
  const look = describeCharacter(character);
  const styled = (style || 'cinematic illustration').slice(0, 120);
  switch (kind) {
    case 'portrait':
      return {
        kind, model: 'flux2-klein-9b', size: '1024x1024', needsSourceImage: false, negative: NEGATIVE,
        prompt: `${styled}. Full body character concept art of ${look}, standing straight facing the camera, arms relaxed at their sides, the whole figure in frame from head to feet, plain flat light grey background, even studio lighting, clean character reference, sharp detail.`,
      };
    case 'turnaround':
      // The recipe's verified prompt (manifests/sai-media-bridge workflows):
      // the LoRA does the rest. Extra words make it drift from the input.
      return {
        kind, model: 'character-sheet', size: '1536x1024', needsSourceImage: true, negative: '',
        prompt: 'Convert the character in the image to a Character Sheet showing front, side and back full body views',
      };
    case 'turnaround-quad':
      return {
        kind, model: 'character-sheet-quad', size: '1536x1024', needsSourceImage: true, negative: '',
        prompt: 'Convert the character in the image to a Character Sheet showing front, three-quarter, side and back full body views',
      };
    case 'expressions':
      return {
        kind, model: 'qwen-image-2.1', size: '1536x1024', needsSourceImage: true, negative: NEGATIVE,
        prompt: `Create an expression sheet of the character in the image: six head-and-shoulders portraits in a 3x2 grid showing neutral, happy, sad, angry, surprised and determined expressions. Keep exactly the same face, hairstyle, skin tone, eye colour and outfit in every portrait. Plain light grey background, even lighting, ${styled}, no text.`,
      };
    case 'qwen-sheet':
      return {
        kind, model: 'qwen-image-2.1', size: '1536x1024', needsSourceImage: false, negative: NEGATIVE,
        prompt: hasSourceImage
          ? `Turn the character in the image into a character reference sheet: three full-body views side by side, front, side profile and back. The same character in every view with identical face, hair, outfit and proportions, neutral standing pose, plain light grey background, even studio lighting, ${styled}, no text, no labels.`
          : `Character reference sheet of ${look}. Three full-body views side by side: front, side profile and back. Identical face, hair, outfit and proportions in every view, neutral standing pose, plain light grey background, even studio lighting, ${styled}, no text, no labels.`,
      };
    default:
      return null;
  }
}

const MEDIA_URL = /^\/api\/media\/(images|comics)\/([A-Za-z0-9._-]+)$/;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * Read one of the app's own images (an /api/media/... URL) as a data: URL the
 * bridge accepts, after the same access check the media route applies. The
 * bridge refuses http URLs, and these files are private anyway.
 */
export async function mediaUrlToDataUrl(user, url) {
  const m = MEDIA_URL.exec(String(url || '').split('?')[0]);
  if (!m) throw Object.assign(new Error('Reference image must be one of this app\'s images'), { status: 400 });
  const [, bucketType, filename] = m;
  const mime = MIME[path.extname(filename).toLowerCase()];
  if (!mime) throw Object.assign(new Error('Reference image must be PNG, JPEG or WebP'), { status: 400 });
  if (!(await canAccessMedia(user, bucketType, filename, 'read'))) {
    throw Object.assign(new Error('Reference image not found'), { status: 404 });
  }
  const stream = await mediaStorage.getStream(mediaStorage.buckets[bucketType], filename);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (buffer.length > 12 * 1024 * 1024) throw Object.assign(new Error('Reference image is larger than 12 MB'), { status: 400 });
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function renderAndStore({ user, bookId, spec, prompt, image, sourceImageUrl, characterId }) {
  const result = await saiImage({
    model: spec.model,
    prompt,
    size: spec.size,
    image,
    negative: spec.negative || undefined,
  });
  const filename = `charref-${spec.kind}-${uuidv4()}.png`;
  await mediaStorage.upload('images', result.buffer, filename, {
    'x-amz-meta-type': `character-${spec.kind}`,
    'x-amz-meta-character-id': String(characterId || ''),
  });
  await recordMediaOwner('images', filename, { ownerId: user.id || user.userId, bookId });
  return {
    id: `ref-${uuidv4()}`,
    kind: spec.kind,
    imageUrl: `/api/media/images/${filename}`,
    model: result.model || spec.model,
    prompt,
    sourceImageUrl: sourceImageUrl || null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Make one reference. Kinds that edit a portrait use sourceImageUrl, else the
 * character's main image; with neither, a portrait is made first and returned
 * too (the caller stores both).
 */
export async function generateReference({ user, bookId, kind, character, sourceImageUrl, style, prompt: promptOverride }) {
  let source = sourceImageUrl || character.imageUrl || null;
  let portrait = null;

  let spec = buildReferencePrompt(kind, character, style, Boolean(source));
  if (spec.needsSourceImage && !source) {
    const portraitSpec = buildReferencePrompt('portrait', character, style);
    portrait = await renderAndStore({ user, bookId, spec: portraitSpec, prompt: portraitSpec.prompt, characterId: character.id });
    source = portrait.imageUrl;
    spec = buildReferencePrompt(kind, character, style, true);
  }

  // The portrait itself is drawn from the description; every other kind edits
  // the source picture when there is one.
  const image = kind !== 'portrait' && source ? await mediaUrlToDataUrl(user, source) : undefined;
  const reference = await renderAndStore({
    user, bookId, spec,
    prompt: (promptOverride || spec.prompt).slice(0, 2000),
    image,
    sourceImageUrl: image ? source : null,
    characterId: character.id,
  });
  return { reference, portrait };
}
