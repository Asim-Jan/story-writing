import OpenAI from 'openai';
import { resolveChatModel } from './services/aiModels.js';

/**
 * SAI API client — the single AI backend for the app.
 *
 * All chat, image and speech generation goes through the SAI gateway
 * (OpenAI-compatible) and its media bridge, billed to ONE pooled app key.
 * Per-user metering is the app's own quota system (free/basic/premium tiers),
 * NOT gateway keys — so nothing here accepts or stores user API keys.
 *
 * Models: code names a ROLE, the admin dashboard picks the model behind it
 * (services/aiModels.js):
 *   SAI_CHAT      — the Writer: long-form book/chapter generation
 *   SAI_CHAT_FAST — the Assistant: short helpers, RPG tools, JSON extraction
 */

const BASE_URL = () => process.env.SAI_API_BASE_URL || 'https://api.solutionsai.co.uk/v1';
const API_KEY = () => process.env.SAI_API_KEY || process.env.OPENAI_API_KEY || '';

export const SAI_CHAT = process.env.SAI_CHAT_MODEL || 'sai-chat';
export const SAI_CHAT_FAST = process.env.SAI_CHAT_FAST_MODEL || 'sai-chat-fast';

let client = null;

export function getSAIClient() {
  if (!client) {
    if (!API_KEY()) {
      throw new Error('SAI_API_KEY_NOT_CONFIGURED');
    }
    client = new OpenAI({
      apiKey: API_KEY(),
      baseURL: BASE_URL(),
      maxRetries: 2,
      timeout: 120000,
    });
    // Thinking OFF by default for every chat call in the app. Left on, the
    // models spend small budgets (RPG tools: 300-600 tokens) entirely on
    // reasoning and return an empty answer, and JSON callers parse nothing.
    // The gateway turns this flag into reasoning_effort:"low" for GLM.
    // A caller that wants thinking passes its own chat_template_kwargs or
    // reasoning_effort.
    // The model: a role (SAI_CHAT = Writer, SAI_CHAT_FAST = Assistant)
    // becomes the model configured for it in the admin dashboard
    // (services/aiModels.js); any other name is used as given.
    const create = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = (params, options) => {
      const withModel = { ...params, model: resolveChatModel(params.model) };
      return create(
        withModel.chat_template_kwargs || withModel.reasoning_effort
          ? withModel
          : { ...withModel, chat_template_kwargs: { enable_thinking: false } },
        options
      );
    };
  }
  return client;
}

export function saiConfigured() {
  return !!API_KEY();
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
export async function saiChat({ model = SAI_CHAT, messages, max_tokens = 4096, temperature = 0.7, response_format = undefined, timeoutMs = 120000, jsonMode = false }) {
  const openai = getSAIClient();

  const params = {
    model,
    messages,
    max_tokens,
    temperature,
    ...(response_format ? { response_format } : {}),
    // JSON calls get thinking explicitly disabled — the reasoning stream was
    // parking JSON fragments in reasoning_content and the caller parsed the
    // chain-of-thought as data ('No parsable JSON' / prompt-leak bugs).
    ...(jsonMode ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    // maxRetries 0: the SDK's default 2 retries × 120s timeout turned one hung
    // generation into a 6-minute request that had already burned its SSE stage.
    // Long generations get their own generous timeoutMs instead.
    timeout: timeoutMs,
    maxRetries: 0,
  };

  const completion = await openai.chat.completions.create(params);

  const choice = completion.choices?.[0] || {};
  const msg = choice.message || {};

  // content is authoritative. reasoning_content is the model's CHAIN OF
  // THOUGHT — it must NEVER be served as answer text. The old
  // content || reasoning_content fallback shipped reasoning to users whenever
  // the budget ran out mid-content (the 'prompt-leak' bug class).
  let text = typeof msg.content === 'string' ? msg.content : '';
  let reasoningOnly = false;
  if (!text.trim() && (msg.reasoning_content || msg.reasoning)) {
    // The model spent the whole budget thinking and produced no answer:
    // honest empty result + a signal the caller can retry/escalate on,
    // rather than silently returning the chain-of-thought.
    text = '';
    reasoningOnly = true;
  }

  const finish = choice.finish_reason || choice.finish_reason;

  return {
    text,
    reasoningOnly,
    finishReason: finish,
    truncated: finish === 'length',
    usage: completion.usage || {},
    model: completion.model || model,
  };
}

/**
 * Generate an image via the SAI media bridge.
 * The bridge returns {data:[{url}]} pointing at a public output URL.
 * @returns {Promise<{buffer: Buffer, url: string, model: string}>}
 */
export async function saiImage({ prompt, model = 'flux2-klein-9b', size = '1024x1024', image = undefined, images = undefined, negative = undefined, seed = undefined, canvas = undefined }) {
  const openai = getSAIClient();
  // `image` (a data: URL) turns any recipe into an EDIT of that picture; the
  // character-sheet recipes require it. Send `size` explicitly: without it
  // the bridge resizes edits to the input's aspect.
  const body = { model, prompt, size, n: 1 };
  if (image) body.image = image;
  // several references at once (qwen-image-2.1 only): characters + the previous shot
  if (Array.isArray(images) && images.length) body.images = images;
  if (negative) body.negative = negative;
  // canvas:'size' — a Qwen edit draws at `size` instead of the reference's shape
  if (canvas) body.canvas = canvas;
  if (seed !== undefined) body.seed = seed;

  // Sheets and Qwen edits take 30 s warm and up to ~3 min cold. No SDK
  // retries: a retry would start a second render of the same image.
  const payload = await openai.post('/images/generations', { body, timeout: 300000, maxRetries: 0 });
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

export async function saiSpeech({ text, voice = 'en-davis_man', speed = undefined, model = undefined, ref_audio = undefined, ref_text = undefined }) {
  if (!API_KEY()) throw new Error('SAI_API_KEY_NOT_CONFIGURED');
  // model: a bridge speech recipe ('vibevoice-tts' default, 'qwen3-tts');
  // ref_audio + ref_text clone a voice from a sample (Qwen3-TTS only)
  const body = { voice, input: text, response_format: 'wav' };
  if (model) body.model = model;
  if (speed) body.speed = speed;
  if (ref_audio) body.ref_audio = ref_audio;
  if (ref_text) body.ref_text = ref_text;

  const res = await fetch(`${BASE_URL()}/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`SAI_SPEECH_${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Speech to text (the bridge's ASR): a WAV buffer → its transcript. */
export async function saiTranscribe(wav) {
  if (!API_KEY()) throw new Error('SAI_API_KEY_NOT_CONFIGURED');
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'sample.wav');
  form.append('model', 'whisper-1');
  const res = await fetch(`${BASE_URL()}/audio/transcriptions`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY()}` }, body: form,
  });
  if (!res.ok) throw new Error(`SAI_TRANSCRIBE_${res.status}`);
  const payload = await res.json();
  return String(payload.text || '');
}

const LANGUAGES = { de: 'German', en: 'English', fr: 'French', in: 'Indonesian', it: 'Italian', jp: 'Japanese', kr: 'Korean', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese', sp: 'Spanish' };

/** A speech recipe's voices as [{ id, name, language }]. */
export async function saiVoices(model) {
  if (!API_KEY()) throw new Error('SAI_API_KEY_NOT_CONFIGURED');
  const res = await fetch(`${BASE_URL()}/audio/voices?model=${encodeURIComponent(model)}`, {
    headers: { 'Authorization': `Bearer ${API_KEY()}` },
  });
  if (!res.ok) throw new Error(`SAI_VOICES_${res.status}`);
  const payload = await res.json();
  if (Array.isArray(payload.data)) {
    // Qwen3-TTS: presets only (registered clones on the shared engine are not ours to list)
    return payload.data.filter(v => !v.kind || v.kind === 'preset').map(v => ({ id: v.id, name: v.name || v.id, language: v.language || '' }));
  }
  // VibeVoice: ids like 'en-emma_woman' → "Emma (English, woman)"
  return (payload.voices || []).map(id => {
    const [lang, rest = ''] = String(id).split('-');
    const [who, gender] = rest.split('_');
    const name = who.startsWith('spk') ? `Speaker ${Number(who.slice(3)) + 1}` : who.charAt(0).toUpperCase() + who.slice(1);
    return { id, name: `${name} (${LANGUAGES[lang] || lang}${gender ? `, ${gender}` : ''})`, language: LANGUAGES[lang] || lang };
  });
}

/**
 * Start a video generation on the SAI media bridge (async).
 * @returns {Promise<{jobId: string}>}
 */
export async function saiVideoStart({ prompt, model = 'minimax-h3-fp8', seconds = 8, image = undefined, size = undefined }) {
  if (!API_KEY()) throw new Error('SAI_API_KEY_NOT_CONFIGURED');

  const body = { model, prompt, seconds, async: true };
  if (image) body.image = image;
  if (size) body.size = size;

  const res = await fetch(`${BASE_URL().replace(/\/v1$/, '')}/v1/video/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY()}`,
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
  if (!API_KEY()) throw new Error('SAI_API_KEY_NOT_CONFIGURED');

  const res = await fetch(`${BASE_URL().replace(/\/v1$/, '')}/v1/video/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'Authorization': `Bearer ${API_KEY()}` },
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
