import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/postgres.js';
import { mediaStorage } from './mediaStorage.js';
import { recordMediaOwner } from '../utils/mediaMapping.js';
import { saiSpeech, saiTranscribe, saiVoices, VOICE_MAP } from '../saiClient.js';
import { chunkText, mergeWav } from '../utils/speech.js';

// Audiobook voices on the SAI media bridge:
//   VibeVoice  — 25 preset voices, fast, no cloning (recipe vibevoice-tts)
//   Qwen3-TTS  — 9 presets and CUSTOM voices cloned from the user's own sample
//                (recipe qwen3-tts, on the Station; the sample and its transcript
//                travel with each request, so no voice lives on the shared engine)
// A voice spec is { engine: 'vibevoice'|'qwen', voice } or { engine: 'qwen', customVoiceId }.

export const ENGINES = { vibevoice: 'vibevoice-tts', qwen: 'qwen3-tts' };
const DEFAULT_SPEC = { engine: 'vibevoice', voice: 'en-emma_woman' };

// Old books stored a bare OpenAI-style name ('alloy', 'nova', ...)
export function normaliseSpec(spec) {
  if (!spec) return { ...DEFAULT_SPEC };
  if (typeof spec === 'string') return { engine: 'vibevoice', voice: VOICE_MAP[spec] || spec };
  if (spec.customVoiceId) return { engine: 'qwen', customVoiceId: String(spec.customVoiceId) };
  const engine = ENGINES[spec.engine] ? spec.engine : 'vibevoice';
  return { engine, voice: String(spec.voice || (engine === 'qwen' ? 'Ryan' : DEFAULT_SPEC.voice)) };
}

const run = (args, input) => new Promise((resolve, reject) => {
  const p = spawn(ffmpegPath, ['-loglevel', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const out = []; let err = '';
  p.stdout.on('data', d => out.push(d));
  p.stderr.on('data', d => { err += d; });
  p.on('error', reject);
  p.on('exit', code => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
  if (input) p.stdin.end(input); else p.stdin.end();
});

/** WAV → MP3 (mono 64 kbps: speech, about a tenth of the WAV). */
export async function wavToMp3(wav) {
  return run(['-i', 'pipe:0', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], wav);
}

/** Any audio the user uploads or records → mono 24 kHz WAV, and its length in seconds. */
export async function normaliseSample(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  try {
    const src = path.join(dir, 'in');
    fs.writeFileSync(src, buffer);
    const wav = await run(['-i', src, '-ac', '1', '-ar', '24000', '-f', 'wav', 'pipe:1']);
    // ffmpeg writing to a pipe cannot seek back to fill in the data size (it
    // leaves 0xFFFFFFFF), so measure the PCM that actually follows the header
    const dataIdx = wav.indexOf('data', 12, 'ascii');
    const pcm = dataIdx >= 0 ? wav.length - (dataIdx + 8) : wav.length - 44;
    return { wav: fixWavSizes(wav), durationSec: pcm / (24000 * 2) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Write the real RIFF and data sizes into a WAV whose header has placeholders.
function fixWavSizes(wav) {
  const out = Buffer.from(wav);
  const dataIdx = out.indexOf('data', 12, 'ascii');
  if (dataIdx < 0) return out;
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(out.length - (dataIdx + 8), dataIdx + 4);
  return out;
}

function wavSeconds(wav) {
  const dataIdx = wav.indexOf('data', 12, 'ascii');
  if (dataIdx < 0) return null;
  const rate = wav.readUInt32LE(24);
  const blockAlign = wav.readUInt16LE(32);
  return rate && blockAlign ? wav.readUInt32LE(dataIdx + 4) / (rate * blockAlign) : null;
}

// ── custom voices (per user) ──────────────────────────────────────────────

const toVoice = (row) => ({
  id: row.id,
  name: row.name,
  transcript: row.transcript,
  durationSec: Number(row.duration_sec),
  createdAt: row.created_at,
  sampleUrl: `/api/media/audio/${row.sample_filename}`,
});

export async function listCustomVoices(userId) {
  const { rows } = await query('SELECT * FROM custom_voices WHERE owner_id = $1 ORDER BY created_at DESC', [userId]);
  return rows.map(toVoice);
}

export async function getCustomVoice(userId, id) {
  const { rows } = await query('SELECT * FROM custom_voices WHERE id = $1 AND owner_id = $2', [id, userId]);
  return rows[0] || null;
}

/** Store a sample, transcribe it if no transcript was given, and record the voice. */
export async function createCustomVoice({ userId, name, sample, transcript, consent }) {
  if (!consent) throw Object.assign(new Error('Please confirm you own this voice or have permission to clone it'), { status: 400 });
  const cleanName = String(name || '').trim().slice(0, 60);
  if (!cleanName) throw Object.assign(new Error('Give the voice a name'), { status: 400 });
  let normalised;
  try {
    normalised = await normaliseSample(sample);
  } catch {
    throw Object.assign(new Error('That file is not audio we can read (try WAV, MP3, M4A, OGG or WebM)'), { status: 400 });
  }
  const { wav, durationSec } = normalised;
  if (durationSec < 3) throw Object.assign(new Error('The sample is too short: record at least 3 seconds (10–20 is best)'), { status: 400 });
  if (durationSec > 30.5) throw Object.assign(new Error('The sample is too long: keep it under 30 seconds'), { status: 400 });

  let text = String(transcript || '').trim();
  if (!text) {
    try {
      text = (await saiTranscribe(wav)).trim();
    } catch (err) {
      console.warn('Voice sample transcription failed:', err.message);
      text = '';
    }
  }
  const filename = `voice-sample-${uuidv4()}.wav`;
  await mediaStorage.upload('audio', wav, filename, { 'x-amz-meta-type': 'voice-sample' });
  await recordMediaOwner('audio', filename, { ownerId: userId });
  const { rows } = await query(
    `INSERT INTO custom_voices (owner_id, name, sample_filename, transcript, duration_sec, consent_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
    [userId, cleanName, filename, text || null, durationSec.toFixed(2)]
  );
  return toVoice(rows[0]);
}

export async function deleteCustomVoice(userId, id) {
  const row = await getCustomVoice(userId, id);
  if (!row) return false;
  await query('DELETE FROM custom_voices WHERE id = $1', [id]);
  await mediaStorage.delete('audio', row.sample_filename).catch(() => {});
  return true;
}

// ── speaking ──────────────────────────────────────────────────────────────

/** The bridge request fields for a voice spec (loads a custom voice's sample). */
export async function speechOptions(userId, spec) {
  const s = normaliseSpec(spec);
  if (s.customVoiceId) {
    const row = await getCustomVoice(userId, s.customVoiceId);
    if (!row) throw Object.assign(new Error('That custom voice no longer exists'), { status: 404 });
    const sample = await mediaStorage.getFile('audio', row.sample_filename);
    return {
      model: ENGINES.qwen,
      voice: 'Ryan',
      ref_audio: `data:audio/wav;base64,${Buffer.from(sample).toString('base64')}`,
      ...(row.transcript ? { ref_text: row.transcript } : {}),
      spec: s,
    };
  }
  return { model: ENGINES[s.engine], voice: s.voice, spec: s };
}

/**
 * Speak text of any length in a voice → { mp3, durationSec, spec }.
 * Chunks stay under VibeVoice's 3000-character cut-off (and Qwen's limits),
 * the WAVs merge into one, and the result is encoded to MP3.
 */
export async function speak(userId, spec, text, { onChunk, speed } = {}) {
  const opts = await speechOptions(userId, spec);
  const chunks = chunkText(String(text || ''));
  if (chunks.length === 0) throw Object.assign(new Error('There is no text to speak'), { status: 400 });
  const wavs = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onChunk) await onChunk(i, chunks.length);
    wavs.push(await saiSpeech({
      text: chunks[i], voice: opts.voice, model: opts.model,
      ref_audio: opts.ref_audio, ref_text: opts.ref_text,
      ...(opts.spec.engine === 'qwen' && speed ? { speed } : {}),
    }));
  }
  const wav = mergeWav(wavs);
  return { mp3: await wavToMp3(wav), durationSec: wavSeconds(wav), spec: opts.spec };
}

export async function storeAudio(userId, bookId, mp3, label) {
  const filename = `${label}-${uuidv4()}.mp3`;
  await mediaStorage.upload('audio', mp3, filename, { 'x-amz-meta-type': 'audiobook' });
  await recordMediaOwner('audio', filename, { ownerId: userId, bookId });
  return { filename, audioUrl: `/api/media/audio/${filename}` };
}

/** Every voice the user can pick: both engines' presets and their own clones. */
export async function availableVoices(userId) {
  const [vibe, qwen, custom] = await Promise.all([
    saiVoices(ENGINES.vibevoice).catch(() => []),
    saiVoices(ENGINES.qwen).catch(() => []),
    listCustomVoices(userId).catch(() => []),
  ]);
  return { vibevoice: vibe, qwen, custom };
}
