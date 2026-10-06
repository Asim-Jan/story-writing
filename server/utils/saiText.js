// saiTextOf — the ONE place that decides what a SAI completion's text is.
//
// content is authoritative. reasoning_content / reasoning are the model's
// CHAIN OF THOUGHT and must never be served as answer text — the old
// `content || reasoning_content` fallbacks (30+ sites) shipped reasoning to
// users whenever the token budget ran out mid-content, and JSON callers then
// parsed the chain-of-thought as data (the 'No parsable JSON' bug class).
//
// Returns '' when the model produced no answer text. Callers that need to
// distinguish "empty answer" from "model only thought" can use saiMetaOf.
export function saiTextOf(messageOrChoice) {
  const msg = messageOrChoice?.message || messageOrChoice || {};
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.filter(p => p?.type === 'text').map(p => p.text).join('');
  }
  return '';
}

export function saiMetaOf(choice) {
  const msg = choice?.message || choice || {};
  const text = saiTextOf(msg);
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : (typeof msg.reasoning === 'string' ? msg.reasoning : '');
  return {
    text,
    reasoning,
    reasoningOnly: !text.trim() && !!reasoning.trim(),
    finishReason: choice?.finish_reason || null,
    truncated: (choice?.finish_reason) === 'length',
  };
}
