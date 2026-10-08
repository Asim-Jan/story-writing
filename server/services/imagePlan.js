import { hasFeature } from '../config/tierQuotas.js';

// Which picture models a user's plan draws with. Qwen Image 2.1 is the premium image model: the Premium plan (tier
// feature `premium_images`, and admins) draws NEW pictures with it and EDITS pictures with it (one model for both,
// and it takes several reference pictures at once: the cast + the place + the previous shot of a film).
// Every other plan draws new pictures with FLUX.2 klein 9B and edits with the FLUX.2 klein edit recipe, which takes
// ONE reference picture.
// The character-sheet recipes (a FLUX.2 Klein LoRA) are the same for everyone and are not decided here.
export const QWEN_IMAGE = 'qwen-image-2.1';
export const FLUX_DRAW = 'flux2-klein-9b';
export const FLUX_EDIT = 'flux2-klein-9b-edit';

/** @returns {{premium: boolean, draw: string, edit: string, multiRef: boolean}} */
export function imagePlan(user) {
  const premium = !!user && (user.role === 'admin' || hasFeature(user.tier, 'premium_images'));
  return premium
    ? { premium, draw: QWEN_IMAGE, edit: QWEN_IMAGE, multiRef: true }
    : { premium, draw: FLUX_DRAW, edit: FLUX_EDIT, multiRef: false };
}

/** The model for one picture: an edit when it starts from a picture, else a new drawing. */
export const imageModelFor = (user, { fromPicture = false } = {}) => (fromPicture ? imagePlan(user).edit : imagePlan(user).draw);
