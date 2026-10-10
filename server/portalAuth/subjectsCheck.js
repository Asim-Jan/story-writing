// The portal's subjects/check answer for ONE sub -> 'gone' | 'disabled' | 'ok', or a throw ("cannot tell": the
// caller postpones). Strict on purpose — anything but two real arrays must not become "ok" (which would stop an
// erasure of a person who is actually gone). Same shape Drive's receiver uses (sai-drive/app/identity-events.js).
export function parseSubjectCheck(j, sub) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.gone) || !Array.isArray(j.disabled)) throw new Error('portal answered with an unexpected body');
  return j.gone.includes(sub) ? 'gone' : j.disabled.includes(sub) ? 'disabled' : 'ok';
}
