// How film shots join, with no imports (the test runner loads it directly).

export const TRANSITIONS = {
  continue: { xfade: 'fade', seconds: 0.12 },
  cut: { xfade: 'fade', seconds: 0.25 },
  dissolve: { xfade: 'fade', seconds: 0.8 },
  fade: { xfade: 'fadeblack', seconds: 1.2 },
};
export const TRANSITION_IDS = Object.keys(TRANSITIONS);

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * How a scene begins after the previous one. The scene's own transition when
 * it has a valid one; otherwise inferred: the same place is a cut, a new
 * place a dissolve. The first scene has none (the film fades in).
 */
export function transitionOf(scene, previous) {
  if (!previous) return null;
  const own = String(scene?.transition || '').trim().toLowerCase();
  if (TRANSITIONS[own]) return own;
  return scene?.location && sameText(scene.location, previous.location) ? 'cut' : 'dissolve';
}

// A "continue" starts from the previous clip's last frame, so it keeps that
// framing: a wide shot cannot "continue" into a close-up (the model did that)
// unless the new shot is a camera move that gets there.
const shotSize = (camera) => {
  const c = String(camera || '').toLowerCase();
  if (/extreme close|insert|macro/.test(c)) return 'xcu';
  if (/close/.test(c)) return 'cu';
  if (/medium|mid|waist|over-the-shoulder|two-shot/.test(c)) return 'ms';
  if (/wide|long|establishing|aerial|full/.test(c)) return 'ws';
  return '';
};
const CAMERA_MOVE = /track|pan|tilt|push|pull|dolly|crane|follow|zoom|continu|handheld|steadicam/i;
export const canContinue = (scene, previous) => {
  const a = shotSize(previous?.cameraDirection);
  const b = shotSize(scene?.cameraDirection);
  return !a || !b || a === b || CAMERA_MOVE.test(String(scene?.cameraDirection || ''));
};

// Every scene gets a valid transition: the model's when it is one of ours,
// else the same place is a cut and a new place a dissolve.
export function normaliseTransitions(scenes) {
  if (!Array.isArray(scenes)) return scenes;
  return scenes.map((scene, i) => {
    if (!scene || typeof scene !== 'object') return scene;
    if (i === 0) return { ...scene, transition: 'fade' };
    const transition = transitionOf(scene, scenes[i - 1]);
    return { ...scene, transition: transition === 'continue' && !canContinue(scene, scenes[i - 1]) ? 'cut' : transition };
  });
}

