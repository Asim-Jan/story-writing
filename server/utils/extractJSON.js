export function extractJSON(text) {
  if (typeof text !== 'string') throw new Error('extractJSON: not a string');
  // 1. direct parse after stripping code fences
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, (ch) => (ch === '\n' || ch === '\t' ? ' ' : ''));
  // NOTE: \n inside JSON strings was historically stripped by the control-char removal;
  // that corrupts real content. Strip only control chars, keep \n.
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  // 2. first balanced {...} or [...] block via raw_decode-style scanning
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = cleaned.indexOf(open);
    if (start === -1) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { break; } } }
    }
  }
  throw new Error(`No parsable JSON in response (${text.slice(0, 60)}...)`);
}
