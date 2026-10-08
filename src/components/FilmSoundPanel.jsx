import React, { useEffect, useMemo, useState } from 'react';
import { Mic, Music, Sparkles, Loader, Trash2, Upload, Volume2 } from 'lucide-react';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { DEFAULT_VOICE, normalizeVoiceSpec, voiceKey, specFromKey, vibeVoiceLabel, languageOf } from '../utils/voices';
import { editSound, filmSeconds, DEFAULT_VOICE_OFFSET, DEFAULT_MUSIC_VOLUME } from '../utils/filmTakes';

// The film's sound beyond its clips, as in the SAI Cloud Film Studio: ONE
// voice-over over the whole film (written to its running time, spoken in any
// audiobook voice, including the author's own cloned voices) and a music bed
// (composed from a few words, or uploaded). They are mixed in when the film
// is cut: the clips' own sound and the music dip under the narration.

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const pct = (v, d = 1) => Math.round((Number.isFinite(v) ? v : d) * 100);

const Level = ({ label, value, fallback = 1, onChange, testid }) => (
  <label className="flex items-center gap-2 text-xs text-gray-700">
    <Volume2 className="w-3 h-3" />
    <span className="w-14">{label}</span>
    <input type="range" min="0" max="150" step="5" value={pct(value, fallback)} onChange={(e) => onChange(Number(e.target.value) / 100)}
      data-testid={testid} className="flex-1 max-w-[10rem]" />
    <span className="w-10 text-right mono">{pct(value, fallback)}%</span>
  </label>
);

const moodsOf = (scenes) => [...new Set(scenes.map(sc => String(sc.mood || '').trim().toLowerCase()).filter(Boolean))].slice(0, 3).join(', ');

const FilmSoundPanel = ({ data, setData, transcriptId, scenes, bookId }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [presets, setPresets] = useState({ vibevoice: [], qwen: [], custom: [] });
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const draft = data.metadata?.animationDrafts?.[transcriptId] || {};
  const sound = draft.sound || {};
  const vo = sound.voiceover || {};
  const music = sound.music || {};
  const seconds = filmSeconds(scenes);
  const voice = normalizeVoiceSpec(vo.voice || data.metadata?.audiobook?.voice || DEFAULT_VOICE);
  const musicPrompt = music.prompt ?? `cinematic film score, ${moodsOf(scenes) || 'emotional'}, instrumental`;

  const jobs = jobsFor('animation').filter(j => String(j.target?.id) === String(transcriptId) && ['film-narration', 'film-voice', 'film-music'].includes(j.type));
  const busy = (type) => jobs.some(j => j.type === type && j.status === 'running');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/audiobook/voices', { headers: authHeaders(), credentials: 'include' });
        const body = await response.json().catch(() => null);
        if (!cancelled && response.ok && body) setPresets({ vibevoice: body.vibevoice || [], qwen: body.qwen || [], custom: body.custom || [] });
      } catch { /* the select still shows the current voice */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const vibeGroups = useMemo(() => {
    const groups = new Map();
    for (const v of presets.vibevoice) {
      const lang = languageOf(v.id, v.language);
      if (!groups.has(lang)) groups.set(lang, []);
      groups.get(lang).push(v);
    }
    return [...groups.entries()].sort((a, b) => (a[0] === 'English' ? -1 : b[0] === 'English' ? 1 : a[0].localeCompare(b[0])));
  }, [presets.vibevoice]);

  const edit = (part, patch) => setData(prev => editSound(prev, transcriptId, part, patch));
  const target = { type: 'animation', id: transcriptId };
  const start = async (type, params) => {
    setError(null);
    try {
      await startJob(type, target, params);
    } catch (err) {
      setError(err.message);
    }
  };

  const writeNarration = () => start('film-narration', {
    scenes: scenes.map(sc => ({ title: sc.title, visualPrompt: sc.visualPrompt, dialogue: sc.dialogue, duration: sc.duration })),
    seconds,
  });
  const speakIt = () => start('film-voice', { text: String(vo.text || '').trim(), voice });
  const compose = () => start('film-music', { prompt: musicPrompt.trim(), seconds: Math.min(180, Math.max(10, seconds + 2)) });

  const uploadMusic = async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('bucketType', 'audio');
      if (bookId) form.append('bookId', bookId);
      const response = await fetch('/api/media/upload', { method: 'POST', headers: authHeaders(), credentials: 'include', body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.url) throw new Error(body?.error || `Upload failed (${response.status})`);
      edit('music', { url: body.url, filename: body.url.split('/').pop(), source: 'uploaded', name: file.name, duration: null });
    } catch (err) {
      setError(`Could not upload the music: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const words = String(vo.text || '').trim().split(/\s+/).filter(Boolean).length;
  const spokenSeconds = Math.round(words / 2.3);
  const stale = vo.filename && vo.spokenText && vo.spokenText.trim() !== String(vo.text || '').trim();

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 mb-4" data-testid="film-sound">
      <p className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2"><Volume2 className="w-4 h-4" />Sound</p>
      <p className="text-xs text-gray-600 mb-3">
        A narrator over the whole film and a music bed, mixed in when you cut the film. The clips' own sound and the music dip under the narration; set each scene's clip sound on its card.
      </p>
      <MediaJobList jobs={jobs} className="mb-3" />
      {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 mb-3" role="alert">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* the voice-over */}
        <div data-testid="film-voiceover">
          <p className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1"><Mic className="w-3 h-3" />Voice-over</p>
          <textarea
            value={vo.text || ''}
            onChange={(e) => edit('voiceover', { text: e.target.value })}
            placeholder="What the narrator says over the film. Write it, or let SAI write it to the film's length."
            rows="5"
            data-testid="voiceover-text"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <p className="text-xs text-gray-500 mt-1" data-testid="voiceover-fit">
            {words ? `${words} words, about ${spokenSeconds} s spoken; the film runs about ${seconds} s.` : `The film runs about ${seconds} s (about ${Math.round(seconds * 2.3 * 0.85)} words of narration).`}
            {words && spokenSeconds > seconds ? ' Too long: it will be cut off at the end.' : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="button" onClick={writeNarration} disabled={busy('film-narration')} data-testid="voiceover-write"
              className="px-2 py-1 bg-white border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-50 text-xs rounded flex items-center gap-1">
              {busy('film-narration') ? <Loader className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {vo.text ? 'Write it again' : 'Write it for me'}
            </button>
            <select value={voiceKey(voice)} onChange={(e) => edit('voiceover', { voice: specFromKey(e.target.value) })} data-testid="voiceover-voice"
              className="text-xs border border-gray-300 rounded px-1 py-1 bg-white max-w-[14rem]" aria-label="Narrator's voice">
              {!presets.vibevoice.some(v => `vibevoice:${v.id}` === voiceKey(voice)) && !presets.qwen.some(v => `qwen:${v.id}` === voiceKey(voice))
                && !presets.custom.some(v => `custom:${v.id}` === voiceKey(voice)) && <option value={voiceKey(voice)}>{voice.voice ? vibeVoiceLabel(voice.voice) : 'Current voice'}</option>}
              {vibeGroups.map(([lang, list]) => (
                <optgroup key={lang} label={`VibeVoice: ${lang}`}>
                  {list.map(v => <option key={v.id} value={`vibevoice:${v.id}`}>{vibeVoiceLabel(v.id, v.language)}</option>)}
                </optgroup>
              ))}
              {presets.qwen.length > 0 && (
                <optgroup label="Qwen voices">
                  {presets.qwen.map(v => <option key={v.id} value={`qwen:${v.id}`}>{v.name || v.id}</option>)}
                </optgroup>
              )}
              {presets.custom.length > 0 && (
                <optgroup label="My voices">
                  {presets.custom.map(v => <option key={v.id} value={`custom:${v.id}`}>{v.name}</option>)}
                </optgroup>
              )}
            </select>
            <button type="button" onClick={speakIt} disabled={!String(vo.text || '').trim() || busy('film-voice')} data-testid="voiceover-speak"
              className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded flex items-center gap-1">
              {busy('film-voice') ? <Loader className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
              {vo.filename ? 'Speak it again' : 'Speak it'}
            </button>
          </div>
          {vo.filename && (
            <div className="mt-2 space-y-1">
              <audio src={vo.url} controls preload="metadata" className="w-full max-w-sm" data-testid="voiceover-audio" />
              {stale && <p className="text-xs text-amber-700">The text has changed since it was spoken: speak it again to use the new words.</p>}
              <Level label="Level" value={vo.volume} onChange={(v) => edit('voiceover', { volume: v })} testid="voiceover-volume" />
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <span className="w-[4.5rem] pl-5">Starts at</span>
                <input type="number" min="0" max="60" step="0.5" value={vo.offset ?? DEFAULT_VOICE_OFFSET}
                  onChange={(e) => edit('voiceover', { offset: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                  data-testid="voiceover-offset" className="w-16 border border-gray-300 rounded px-1 py-0.5" />
                <span>seconds into the film</span>
              </label>
              <button type="button" onClick={() => edit('voiceover', { url: null, filename: null, duration: null, spokenText: null })}
                className="text-xs text-gray-600 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3 h-3" />Remove the recording</button>
            </div>
          )}
        </div>

        {/* the music */}
        <div data-testid="film-music">
          <p className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1"><Music className="w-3 h-3" />Music</p>
          <input
            type="text"
            value={musicPrompt}
            onChange={(e) => edit('music', { prompt: e.target.value })}
            maxLength={300}
            data-testid="music-prompt"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            aria-label="What the music should sound like"
          />
          <p className="text-xs text-gray-500 mt-1">A few style words: instruments, mood, tempo. Composed to the film's length (about {Math.min(180, Math.max(10, seconds + 2))} s).</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="button" onClick={compose} disabled={!musicPrompt.trim() || busy('film-music')} data-testid="music-compose"
              className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded flex items-center gap-1">
              {busy('film-music') ? <Loader className="w-3 h-3 animate-spin" /> : <Music className="w-3 h-3" />}
              {music.filename ? 'Compose again' : 'Compose music'}
            </button>
            <label className={`px-2 py-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs rounded flex items-center gap-1 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? <Loader className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Upload music
              <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" className="hidden" disabled={uploading}
                onChange={(e) => { uploadMusic(e.target.files?.[0]); e.target.value = ''; }} data-testid="music-upload" />
            </label>
          </div>
          {music.filename && (
            <div className="mt-2 space-y-1">
              <audio src={music.url} controls preload="metadata" className="w-full max-w-sm" data-testid="music-audio" />
              {music.source === 'uploaded' && music.name && <p className="text-xs text-gray-500">Uploaded: {music.name}</p>}
              <Level label="Level" value={music.volume} fallback={DEFAULT_MUSIC_VOLUME} onChange={(v) => edit('music', { volume: v })} testid="music-volume" />
              <button type="button" onClick={() => edit('music', { url: null, filename: null, duration: null, source: null, name: null })}
                className="text-xs text-gray-600 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3 h-3" />Remove the music</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilmSoundPanel;
