import { saiSpeech, VOICE_MAP } from '../saiClient.js';

// Text-to-speech for text of any length. The bridge takes one request per
// call, so long text is split at sentence boundaries, each piece is spoken,
// and the WAVs are merged into ONE valid file: the first file's header plus
// the PCM data of every piece. (Buffer.concat of whole WAV files left a
// header mid-stream; most players stop at the first one.)

export function chunkText(text, maxChars = 4000) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxChars) {
      current += sentence;
      continue;
    }
    if (current) chunks.push(current.trim());
    current = '';
    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }
    // a single sentence longer than the limit: split by words
    for (const word of sentence.split(' ')) {
      if ((current + ' ' + word).length > maxChars && current) {
        chunks.push(current.trim());
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Offset of the PCM data. The bridge's WAVs may carry extra chunks (LIST),
// so walk the chunks instead of assuming a 44-byte header.
function wavDataStart(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 44;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return off + 8;
    off += 8 + size + (size % 2);
  }
  return 44;
}

export function mergeWav(buffers) {
  if (buffers.length === 1) return buffers[0];
  const firstStart = wavDataStart(buffers[0]);
  const header = Buffer.from(buffers[0].subarray(0, firstStart));
  const pcm = buffers.map((b, i) => b.subarray(i === 0 ? firstStart : wavDataStart(b)));
  const pcmLength = pcm.reduce((n, p) => n + p.length, 0);
  header.writeUInt32LE(header.length - 8 + pcmLength, 4); // RIFF size = file size - 8
  const dataIdx = header.lastIndexOf('data', header.length - 4, 'ascii');
  if (dataIdx >= 0) header.writeUInt32LE(pcmLength, dataIdx + 4);
  return Buffer.concat([header, ...pcm]);
}

/**
 * Speak text of any length. `voice` may be a friendly name (alloy, nova...) or
 * a bridge voice id (en-emma_woman). onChunk(i, n) reports progress.
 */
export async function speakLongText(text, { voice = 'alloy', onChunk } = {}) {
  const selectedVoice = VOICE_MAP[voice] || voice;
  const chunks = chunkText(text);
  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onChunk) await onChunk(i, chunks.length);
    buffers.push(await saiSpeech({ text: chunks[i], voice: selectedVoice }));
  }
  return { buffer: mergeWav(buffers), voice: selectedVoice, chunks: chunks.length };
}
