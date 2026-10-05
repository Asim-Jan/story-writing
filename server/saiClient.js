import OpenAI from 'openai';

/**
 * SAI API client — the single AI backend for the app.
 *
 * All chat, image and speech generation goes through the SAI gateway
 * (OpenAI-compatible) and its media bridge, billed to ONE pooled app key.
 * Per-user metering is the app's own quota system (free/basic/premium tiers),
 * NOT gateway keys — so nothing here accepts or stores user API keys.
 *
 * Models (SAI gateway, /v1/models):
 *   SAI_CHAT_FAST — short helpers, RPG tools, JSON extraction (GLM-5.3-Flash)
 *   SAI_CHAT      — long-form book/chapter generation (Qwen3.8-Flash-Next, 1M ctx)
 */

const BASE_URL = process.env.SAI_API_BASE_URL || 'https://api.solutionsai.co.uk/v1';
const API_KEY = process.env.SAI_API_KEY || process.env.OPENAI_API_KEY || '';

export const SAI_CHAT = process.env.SAI_CHAT_MODEL || 'sai-chat';
export const SAI_CHAT_FAST = process.env.SAI_CHAT_FAST_MODEL || 'sai-chat-fast';

let client = null;

export function getSAIClient() {
  if (!client) {
    if (!API_KEY) {
      throw new Error('SAI_API_KEY_NOT_CONFIGURED');
    }
    client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      maxRetries: 2,
      timeout: 120000,
    });
  }
  return client;
}

export function saiConfigured() {
  return !!API_KEY;
}

/**
 * Chat completion through the SAI gateway.
 * @param {Object} opts
 * @param {string}  opts.model        'sai-chat' (default, long-form) or 'sai-chat-fast'
 * @param {Array}   opts.messages     [{role, content}]
 * @param {number}  opts.max_tokens
 * @param {number}  opts.temperature
 * @param {Object}  opts.response_format  e.g. { type: 'json_object' }
 * @returns {Promise<{text: string, usage: Object, model: string}>}
 */
export async function saiChat({ model = SAI_CHAT, messages, max_tokens = 4096, temperature = 0.7, response_format = undefined }) {
  const openai = getSAIClient();
  const completion = await openai.chat.completions.create({
    model,
    messages,
    max_tokens,
    temperature,
    ...(response_format ? { response_format } : {}),
  });

  const msg = completion.choices?.[0]?.message || {};
  // Some SAI models park text in reasoning_content when the token budget is
  // spent before content starts — treat real content as authoritative and
  // fall back so short JSON calls never come back empty.
  const text = msg.content || msg.reasoning_content || msg.reasoning || '';

  return {
    text,
    usage: completion.usage || {},
    model: completion.model || model,
  };
}

/**
 * Generate an image via the SAI media bridge.
 * The bridge returns {data:[{url}]} pointing at a public output URL.
 * @returns {Promise<{buffer: Buffer, url: string, model: string}>}
 */
export async function saiImage({ prompt, model = 'flux2-klein-9b', size = '1024x1024', image = undefined }) {
  const openai = getSAIClient();
  const body = { model, prompt, size, n: 1 };
  if (image) body.image = image;

  const payload = await openai.post('/images/generations', { body });
  const item = payload.data?.[0];
  if (!item) throw new Error('SAI_IMAGE_NO_DATA');

  let buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`SAI_IMAGE_FETCH_${img.status}`);
    buffer = Buffer.from(await img.arrayBuffer());
  } else {
    throw new Error('SAI_IMAGE_NO_OUTPUT');
  }

  return { buffer, url: item.url || null, model: payload.model || model };
}

/**
 * Text-to-speech via the SAI media bridge.
 * Returns 24kHz mono WAV (the OpenAI SDK path would return an mp3 reader —
 * so this uses raw fetch and hands back the bytes).
 *
 * Voice ids differ from OpenAI's: the bridge serves vibevoice voices
 * (en-davis_man, en-emma_woman, ...). Map friendly names via VOICE_MAP.
 */
export const VOICE_MAP = {
  alloy: 'en-davis_man',   // neutral male
  echo: 'en-carter_man',   // clear male
  fable: 'en-frank_man',   // warm male
  onyx: 'en-mike_man',     // deep male
  nova: 'en-emma_woman',   // bright female
  shimmer: 'en-grace_woman', // soft female
};

export async function saiSpeech({ text, voice = 'en-davis_man', speed = 1.0 }) {
  if (!API_KEY) throw new Error('SAI_API_KEY_NOT_CONFIGURED');

  const res = await fetch(`${BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', voice, input: text, speed }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`SAI_SPEECH_${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Start a video generation on the SAI media bridge (async).
 * @returns {Promise<{jobId: string}>}
 */
export async function saiVideoStart({ prompt, model = 'minimax-h3-fp8', seconds = 8, image = undefined, size = undefined }) {
  if (!API_KEY) throw new Error('SAI_API_KEY_NOT_CONFIGURED');

  const body = { model, prompt, seconds, async: true };
  if (image) body.image = image;
  if (size) body.size = size;

  const res = await fetch(`${BASE_URL.replace(/\/v1$/, '')}/v1/video/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status !== 202 && !res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`SAI_VIDEO_START_${res.status}: ${detail.slice(0, 200)}`);
  }
  const payload = await res.json().catch(() => ({}));
  if (!payload.job_id) throw new Error('SAI_VIDEO_NO_JOB');
  return { jobId: payload.job_id };
}

/**
 * Poll a video job. Returns {status: 'running'|'done'|'failed', url?}.
 */
export async function saiVideoStatus(jobId) {
  if (!API_KEY) throw new Error('SAI_API_KEY_NOT_CONFIGURED');

  const res = await fetch(`${BASE_URL.replace(/\/v1$/, '')}/v1/video/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  if (res.status === 202) return { status: 'running' };
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`SAI_VIDEO_STATUS_${res.status}: ${detail.slice(0, 200)}`);
  }
  const payload = await res.json().catch(() => ({}));
  if (payload.url) return { status: 'done', url: payload.url };
  return { status: 'running' };
}

/**
 * Prettier name for a bridge voice id, for UI display.
 */
export function voiceLabel(voiceId) {
  const m = voiceId.match(/^([a-z]{2})-?(.*)$/);
  if (!m) return voiceId;
  const lang = { en: 'English', de: 'German', fr: 'French', in: 'Indonesian', it: 'Italian', jp: 'Japanese', kr: 'Korean' }[m[1]] || m[1];
  const who = m[2] || '';
  return `${lang} — ${who.replace(/_/g, ' ')}`;
}
