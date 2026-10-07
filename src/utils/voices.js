// Audiobook voices: specs, labels and audio file URLs.
//
// A voice spec is { engine: 'vibevoice' | 'qwen', voice: '<preset id>' } or
// { engine: 'qwen', customVoiceId: '<uuid>' }. Older books stored a bare string
// (alloy, nova, ...): the server maps those to VibeVoice voices, and so do we,
// so the picker shows what the book will actually use.

export const LEGACY_VOICE_MAP = {
  alloy: 'en-davis_man',
  echo: 'en-carter_man',
  fable: 'en-frank_man',
  onyx: 'en-mike_man',
  nova: 'en-emma_woman',
  shimmer: 'en-grace_woman',
};

export const DEFAULT_VOICE = { engine: 'vibevoice', voice: 'en-davis_man' };

export const normalizeVoiceSpec = (value) => {
  if (!value) return DEFAULT_VOICE;
  if (typeof value === 'string') return { engine: 'vibevoice', voice: LEGACY_VOICE_MAP[value] || value };
  if (value.engine === 'qwen' && value.customVoiceId) return { engine: 'qwen', customVoiceId: value.customVoiceId };
  if ((value.engine === 'qwen' || value.engine === 'vibevoice') && value.voice) return { engine: value.engine, voice: value.voice };
  return DEFAULT_VOICE;
};

export const sameVoice = (a, b) => {
  const x = normalizeVoiceSpec(a);
  const y = normalizeVoiceSpec(b);
  return x.engine === y.engine && (x.voice || null) === (y.voice || null) && (x.customVoiceId || null) === (y.customVoiceId || null);
};

// A stable string for <select> values.
export const voiceKey = (spec) => {
  const v = normalizeVoiceSpec(spec);
  return v.customVoiceId ? `custom:${v.customVoiceId}` : `${v.engine}:${v.voice}`;
};

export const specFromKey = (key) => {
  const [kind, ...rest] = String(key).split(':');
  const id = rest.join(':');
  if (kind === 'custom') return { engine: 'qwen', customVoiceId: id };
  return { engine: kind === 'qwen' ? 'qwen' : 'vibevoice', voice: id };
};

const LANGUAGES = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  pl: 'Polish', in: 'Indian English', hi: 'Hindi', jp: 'Japanese', ja: 'Japanese', kr: 'Korean', ko: 'Korean',
  zh: 'Chinese', cn: 'Chinese', ru: 'Russian', sv: 'Swedish', tr: 'Turkish', ar: 'Arabic',
};

const titleCase = (s) => String(s || '').split(/[\s_]+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const languageOf = (id, fallback) => {
  const m = String(id || '').match(/^([a-z]{2})-/i);
  return fallback || (m ? (LANGUAGES[m[1].toLowerCase()] || m[1].toUpperCase()) : 'Other');
};

// "en-emma_woman" -> "Emma (English, woman)"; "de-Spk1_man" -> "Spk1 (German, man)".
export const vibeVoiceLabel = (id, language) => {
  const m = String(id || '').match(/^([a-z]{2})-(.+)$/i);
  if (!m) return titleCase(id);
  const parts = m[2].split('_');
  const withMusic = /^bgm$/i.test(parts[parts.length - 1]) && parts.pop();
  const gender = /^(man|woman|male|female)$/i.test(parts[parts.length - 1]) ? parts.pop().toLowerCase() : null;
  const name = titleCase(parts.join(' '));
  const lang = languageOf(id, language).replace(/\s*\(([^)]+)\)/, ', $1'); // "English (India)" -> "English, India"
  return `${name} (${[lang, gender, withMusic && 'with music'].filter(Boolean).join(', ')})`;
};

// A human label for any spec, given the loaded voice lists.
export const voiceLabel = (spec, { qwen = [], custom = [] } = {}) => {
  const v = normalizeVoiceSpec(spec);
  if (v.customVoiceId) {
    const mine = custom.find(c => c.id === v.customVoiceId);
    return mine ? `${mine.name} (my voice)` : 'Custom voice (deleted)';
  }
  if (v.engine === 'qwen') {
    const preset = qwen.find(q => q.id === v.voice);
    return `${preset?.name || titleCase(v.voice)} (Qwen)`;
  }
  return vibeVoiceLabel(v.voice);
};

// The URL a chapter's audio plays from. New files carry audioUrl; files made
// by the old queue only have storageKey / bucket / filename.
export const audioFileUrl = (file) => {
  if (!file) return null;
  if (file.audioUrl) return file.audioUrl;
  const filename = file.filename || String(file.storageKey || '').split('/').pop();
  return filename ? `/api/media/audio/${filename}` : null;
};

export const audioFileName = (file, chapter) => {
  const name = file?.filename || String(file?.storageKey || '').split('/').pop();
  if (name) return name;
  return `chapter-${chapter?.number || chapter?.id || 'audio'}.mp3`;
};
