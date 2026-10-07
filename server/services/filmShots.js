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

// The author's direction for the transcript, as shot-making instructions.
const SHOT_DIRECTION = {
  pace: {
    slow: 'Slow pace: longer takes (7 to 8 seconds), gentle camera moves, and "continue" where a moment carries on.',
    brisk: 'Brisk pace: shorter takes (4 to 5 seconds) and more cuts.',
  },
  shots: {
    cinematic: 'Cinematic: wide establishing shots, crane and dolly moves, dramatic light and scale.',
    intimate: 'Intimate: mostly close-ups and medium shots of faces and hands, shallow focus.',
    action: 'Action-driven: tracking and handheld shots with motion in every take.',
    documentary: 'Observational: handheld, naturalistic framing and available light.',
  },
};
export function shotDirection(guidance) {
  if (!guidance || typeof guidance !== 'object') return '';
  const lines = Object.keys(SHOT_DIRECTION).map(k => SHOT_DIRECTION[k][guidance[k]]).filter(Boolean);
  if (guidance.notes) lines.push(`The author's notes on this screenplay: ${String(guidance.notes).slice(0, 600)}`);
  return lines.length ? `Direction from the author:\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}
