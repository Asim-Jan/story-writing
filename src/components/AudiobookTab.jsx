import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Volume2, Play, Pause, Download, Loader, Sparkles, BookOpen, CheckCircle, RefreshCw, Plus, Trash2, Mic, Square, AlertCircle, Clock } from 'lucide-react';
import { useAudioPlayer } from '../contexts/AudioPlayerContext';
import { useMediaJobsContext, MediaJobStatus } from '../contexts/MediaJobsContext';
import CustomVoiceDialog from './CustomVoiceDialog';
import {
  DEFAULT_VOICE, normalizeVoiceSpec, voiceKey, specFromKey, vibeVoiceLabel, languageOf, voiceLabel,
  audioFileUrl, audioFileName,
} from '../utils/voices';

// Audiobook: pick a voice (VibeVoice presets, Qwen presets, or a voice cloned
// from the user's own sample), then generate chapters as an `audiobook` book
// media job. The job runs on the server; its per-chapter progress comes from
// the job list (so it survives leaving the tab) and the finished files are
// merged into data.audioFiles by the book-level jobs hook.

const SPEEDS = [0.8, 0.9, 1.0, 1.1, 1.25];

const authHeaders = (json = false) => {
  const token = localStorage.getItem('token');
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const formatDuration = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const CHAPTER_STATUS = {
  pending: { label: 'Waiting', icon: Clock, cls: 'text-[var(--dim)]' },
  speaking: { label: 'Speaking', icon: Loader, cls: 'text-[var(--blue)]', spin: true },
  done: { label: 'Done', icon: CheckCircle, cls: 'text-[var(--ok)]' },
  failed: { label: 'Failed', icon: AlertCircle, cls: 'text-[var(--red)]' },
};

const byNumber = (a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);

const AudiobookTab = ({ chapters, bookTitle, data, setData, bookId, autosave }) => {
  const { play, pause, currentTrack, isPlaying } = useAudioPlayer();
  const { jobsFor, startJob } = useMediaJobsContext();

  const [presets, setPresets] = useState({ vibevoice: [], qwen: [] });
  const [customVoices, setCustomVoices] = useState([]);
  const [voicesError, setVoicesError] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [listening, setListening] = useState(null); // 'preview' | 'sample:<id>' while playing
  const [previewLoading, setPreviewLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [starting, setStarting] = useState(null); // 'all' | chapter id
  const auditionRef = useRef(null);
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;

  const settings = data.metadata?.audiobook || {};
  const spec = normalizeVoiceSpec(settings.voice);
  const speed = SPEEDS.includes(settings.speed) ? settings.speed : 1.0;
  const audioFiles = data.audioFiles || {};
  const sortedChapters = useMemo(() => [...chapters].sort(byNumber), [chapters]);

  const writeSettings = (patch) => setData(prev => ({
    ...prev,
    metadata: { ...(prev.metadata || {}), audiobook: { ...(prev.metadata?.audiobook || {}), ...patch } },
  }));
  const setVoice = (voice) => writeSettings({ voice });

  // ---- voices ----
  const loadCustomVoices = useCallback(async () => {
    try {
      const response = await fetch('/api/voices', { headers: authHeaders(), credentials: 'include' });
      if (!response.ok) return;
      const body = await response.json().catch(() => null);
      setCustomVoices(Array.isArray(body?.voices) ? body.voices : []);
    } catch { /* offline: keep the list */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/audiobook/voices', { headers: authHeaders(), credentials: 'include' });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !body) throw new Error(body?.error || `voices ${response.status}`);
        setPresets({ vibevoice: body.vibevoice || [], qwen: body.qwen || [] });
        if (Array.isArray(body.custom)) setCustomVoices(body.custom);
      } catch (err) {
        if (!cancelled) setVoicesError(`Could not load the voice list: ${err.message}`);
      }
    })();
    loadCustomVoices();
    return () => { cancelled = true; };
  }, [loadCustomVoices]);

  const vibeGroups = useMemo(() => {
    const groups = new Map();
    for (const v of presets.vibevoice) {
      const lang = languageOf(v.id, v.language);
      if (!groups.has(lang)) groups.set(lang, []);
      groups.get(lang).push(v);
    }
    // English first, then alphabetical
    return [...groups.entries()].sort((a, b) => (a[0] === 'English' ? -1 : b[0] === 'English' ? 1 : a[0].localeCompare(b[0])));
  }, [presets.vibevoice]);

  const lists = { qwen: presets.qwen, custom: customVoices };
  const currentLabel = voiceLabel(spec, lists);

  const switchEngine = (engine) => {
    if (engine === spec.engine) return;
    if (engine === 'qwen') setVoice({ engine: 'qwen', voice: presets.qwen[0]?.id || 'Ryan' });
    else setVoice(DEFAULT_VOICE);
  };

  // ---- listening: preview and samples share one player ----
  const stopListening = () => {
    const a = auditionRef.current;
    if (a) {
      a.pause();
      if (a.dataset.objectUrl) URL.revokeObjectURL(a.dataset.objectUrl);
    }
    auditionRef.current = null;
    setListening(null);
  };
  useEffect(() => () => stopListening(), []);
  // a preview belongs to the voice it was made for
  const selectedKey = voiceKey(spec);
  useEffect(() => { if (auditionRef.current && listening === 'preview') stopListening(); }, [selectedKey]);

  const listen = (src, key, objectUrl = false) => {
    stopListening();
    if (isPlaying) pause();
    const audio = new Audio(src);
    if (objectUrl) audio.dataset.objectUrl = src;
    audio.onended = () => { if (auditionRef.current === audio) stopListening(); };
    auditionRef.current = audio;
    setListening(key);
    audio.play().catch((err) => {
      if (auditionRef.current === audio) stopListening();
      if (err?.name !== 'AbortError') setNotice(`Could not play the audio: ${err.message}`);
    });
  };

  const preview = async () => {
    if (listening === 'preview') { stopListening(); return; }
    setNotice(null);
    setPreviewLoading(true);
    try {
      const response = await fetch('/api/audiobook/preview', {
        method: 'POST', headers: authHeaders(true), credentials: 'include', body: JSON.stringify({ voice: spec }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Preview failed (${response.status})`);
      }
      const blob = await response.blob();
      listen(URL.createObjectURL(blob), 'preview', true);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const playSample = (voice) => {
    const key = `sample:${voice.id}`;
    if (listening === key) stopListening();
    else listen(voice.sampleUrl, key);
  };

  const deleteVoice = async (voice) => {
    if (!confirm(`Delete the voice "${voice.name}"? Chapters already generated with it keep their audio.`)) return;
    try {
      const response = await fetch(`/api/voices/${voice.id}`, { method: 'DELETE', headers: authHeaders(), credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Delete failed (${response.status})`);
      }
      setCustomVoices(prev => prev.filter(v => v.id !== voice.id));
      if (spec.customVoiceId === voice.id) setVoice(DEFAULT_VOICE);
    } catch (err) {
      setNotice(err.message);
    }
  };

  const onVoiceCreated = (voice) => {
    setShowDialog(false);
    setCustomVoices(prev => [voice, ...prev.filter(v => v.id !== voice.id)]);
    setVoice({ engine: 'qwen', customVoiceId: voice.id });
    loadCustomVoices();
  };

  // ---- generation (audiobook media jobs) ----
  const audiobookJobs = jobsFor('audiobook');
  const runningJobs = audiobookJobs.filter(j => j.status === 'running');

  // The chapter's row in the newest running job that includes it.
  const chapterProgress = (chapterId) => {
    for (const job of runningJobs) {
      const row = job.progress?.chapters?.find(c => String(c.chapterId) === String(chapterId));
      if (row) return row;
    }
    return null;
  };

  const generate = async (list, key) => {
    setNotice(null);
    setStarting(key);
    try {
      // The server speaks the SAVED chapter text: save pending edits first.
      if (autosave?.saveNow && autosave.status && autosave.status !== 'saved') {
        await autosave.saveNow();
        await new Promise(resolve => setTimeout(resolve, 0)); // let the saved ids render
      }
      // A new chapter's id becomes the server's after its first save; re-read.
      const current = chaptersRef.current;
      const ids = list
        .map(ch => (current.find(c => c.id === ch.id) || current.find(c => String(c.number) === String(ch.number)))?.id)
        .filter(Boolean);
      if (!ids.length) throw new Error('No chapters to read');
      const params = { voice: spec, chapterIds: ids };
      if (spec.engine === 'qwen' && speed !== 1.0) params.speed = speed;
      const label = ids.length === 1
        ? `Audiobook: Chapter ${list[0].number || ''} ${list[0].title || ''}`.replace(/\s+/g, ' ').trim()
        : `Audiobook: ${ids.length} chapters`;
      await startJob('audiobook', { type: 'audiobook', id: null }, params, label);
    } catch (err) {
      setNotice(err.message === 'Save conflict' || err.message === 'Session expired'
        ? 'Save the book first: the audiobook reads the saved chapter text.'
        : `Could not start the audiobook: ${err.message}`);
    } finally {
      setStarting(null);
    }
  };

  const withContent = sortedChapters.filter(ch => ch.content);
  const generateAll = () => {
    if (!withContent.length) { setNotice('No chapters have content to read yet.'); return; }
    generate(withContent, 'all');
  };

  // ---- playback ----
  const trackFor = (ch) => ({
    url: audioFileUrl(audioFiles[ch.id]),
    title: `Chapter ${ch.number}: ${ch.title}`,
    subtitle: bookTitle || 'Audiobook',
    chapterId: ch.id,
  });
  const playlist = sortedChapters.filter(ch => audioFileUrl(audioFiles[ch.id])).map(trackFor);

  const togglePlay = (ch) => {
    const track = trackFor(ch);
    if (currentTrack?.url === track.url && isPlaying) { pause(); return; }
    stopListening();
    play(track, playlist);
  };

  const anyRunning = runningJobs.length > 0;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header + voice */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Volume2 className="w-8 h-8 text-indigo-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Audiobook Generator</h2>
            <p className="text-gray-600">Read your chapters aloud with VibeVoice or Qwen, or in a voice cloned from your own sample</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Voice picker */}
          <div data-testid="voice-picker">
            <span className="lbl block mb-2">Engine</span>
            <div className="tabs mb-3" role="tablist">
              <button type="button" role="tab" aria-selected={spec.engine === 'vibevoice'} className={spec.engine === 'vibevoice' ? 'on' : ''} onClick={() => switchEngine('vibevoice')} data-testid="engine-vibevoice">VibeVoice</button>
              <button type="button" role="tab" aria-selected={spec.engine === 'qwen'} className={spec.engine === 'qwen' ? 'on' : ''} onClick={() => switchEngine('qwen')} data-testid="engine-qwen">Qwen</button>
            </div>
            <p className="text-xs text-[var(--dim)] mb-2">
              {spec.engine === 'vibevoice'
                ? 'Fast, natural narration in 25 voices across many languages.'
                : 'Qwen3-TTS presets, plus voices cloned from your own samples.'}
            </p>

            <label className="block">
              <span className="lbl block mb-1">Voice</span>
              <select value={voiceKey(spec)} onChange={(e) => setVoice(specFromKey(e.target.value))} className="w-full" data-testid="voice-select">
                {spec.engine === 'vibevoice' ? (
                  <>
                    {!presets.vibevoice.some(v => v.id === spec.voice) && <option value={voiceKey(spec)}>{vibeVoiceLabel(spec.voice)}</option>}
                    {vibeGroups.map(([lang, list]) => (
                      <optgroup key={lang} label={lang}>
                        {list.map(v => <option key={v.id} value={`vibevoice:${v.id}`}>{vibeVoiceLabel(v.id, v.language)}</option>)}
                      </optgroup>
                    ))}
                  </>
                ) : (
                  <>
                    {spec.customVoiceId && !customVoices.some(v => v.id === spec.customVoiceId) && <option value={voiceKey(spec)}>{currentLabel}</option>}
                    {spec.voice && !presets.qwen.some(v => v.id === spec.voice) && <option value={voiceKey(spec)}>{currentLabel}</option>}
                    <optgroup label="Qwen voices">
                      {presets.qwen.map(v => <option key={v.id} value={`qwen:${v.id}`}>{v.name || v.id}{v.language ? ` (${v.language})` : ''}</option>)}
                    </optgroup>
                    {customVoices.length > 0 && (
                      <optgroup label="My voices">
                        {customVoices.map(v => <option key={v.id} value={`custom:${v.id}`}>{v.name}</option>)}
                      </optgroup>
                    )}
                  </>
                )}
              </select>
            </label>

            <div className="flex items-center gap-2 mt-3">
              <button type="button" onClick={preview} disabled={previewLoading} className="btn sm" data-testid="voice-preview">
                {previewLoading ? <Loader size={14} className="animate-spin" /> : listening === 'preview' ? <Square size={14} /> : <Play size={14} />}
                {previewLoading ? 'Preparing...' : listening === 'preview' ? 'Stop preview' : 'Preview'}
              </button>
              <span className="text-xs text-[var(--dim)] truncate" data-testid="voice-current">{currentLabel}</span>
            </div>

            {spec.engine === 'qwen' && (
              <label className="block mt-3">
                <span className="lbl block mb-1">Speaking speed</span>
                <select value={speed} onChange={(e) => writeSettings({ speed: Number(e.target.value) })} className="w-full" data-testid="voice-speed">
                  {SPEEDS.map(s => <option key={s} value={s}>{s.toFixed(2).replace(/0$/, '')}x{s === 1 ? ' (normal)' : ''}</option>)}
                </select>
              </label>
            )}
            {voicesError && <p className="text-xs text-[var(--red)] mt-2">{voicesError}</p>}
          </div>

          {/* Custom voices */}
          <div data-testid="custom-voices">
            <div className="flex items-center justify-between mb-2">
              <span className="lbl">My voices</span>
              <button type="button" onClick={() => setShowDialog(true)} className="btn sm" data-testid="add-voice">
                <Plus size={14} />
                Add a custom voice
              </button>
            </div>
            {customVoices.length === 0 ? (
              <p className="text-sm text-[var(--dim)] border border-dashed border-[var(--line2)] px-3 py-4 text-center">
                <Mic size={16} className="inline mr-1 align-[-3px]" />
                Clone a voice from a 3 to 30 second sample: yours, or a speaker who has agreed.
              </p>
            ) : (
              <ul className="space-y-2">
                {customVoices.map(v => {
                  const selected = spec.customVoiceId === v.id;
                  return (
                    <li key={v.id} className={`card flex items-center gap-2 px-3 py-2 ${selected ? 'border-[var(--blue)]' : ''}`} data-testid="custom-voice" data-voice-id={v.id}>
                      <button type="button" onClick={() => playSample(v)} disabled={!v.sampleUrl} className="btn ghost sm" title="Play sample" aria-label={`Play sample of ${v.name}`}>
                        {listening === `sample:${v.id}` ? <Square size={14} /> : <Play size={14} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--ink)] truncate">{v.name}</p>
                        <p className="text-xs text-[var(--dim)] mono">
                          {v.durationSec ? `${Number(v.durationSec).toFixed(1)} s sample` : 'sample'}
                          {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      {selected ? (
                        <span className="pill">In use</span>
                      ) : (
                        <button type="button" onClick={() => setVoice({ engine: 'qwen', customVoiceId: v.id })} className="btn sm" data-testid="use-voice">Use</button>
                      )}
                      <button type="button" onClick={() => deleteVoice(v)} className="btn ghost sm" title="Delete voice" aria-label={`Delete ${v.name}`} data-testid="delete-voice">
                        <Trash2 size={14} className="text-[var(--red)]" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {notice && <div className="mt-4 border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2" role="alert">{notice}</div>}

        {/* Generate all */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={generateAll}
            disabled={starting === 'all' || anyRunning || withContent.length === 0}
            data-testid="generate-all"
            className="w-full py-3 px-6 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
          >
            {starting === 'all' || anyRunning ? <Loader className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {anyRunning ? 'Generating audiobook...' : `Generate Full Audiobook (${withContent.length} chapters)`}
          </button>
          <p className="text-xs text-[var(--dim)] mt-2">Reads the saved text of each chapter in {currentLabel}. It keeps going if you leave this tab.</p>
        </div>
      </div>

      {/* Running and failed jobs, with per-chapter progress */}
      {audiobookJobs.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-6 space-y-4" data-testid="audiobook-jobs">
          {audiobookJobs.map(job => (
            <div key={job.jobId}>
              <MediaJobStatus job={job} />
              {job.status === 'running' && job.progress?.chapters?.length > 0 && (
                <ol className="mt-2 grid sm:grid-cols-2 gap-1">
                  {job.progress.chapters.map(row => {
                    const ch = chapters.find(c => String(c.id) === String(row.chapterId));
                    const st = CHAPTER_STATUS[row.status] || CHAPTER_STATUS.pending;
                    const Icon = st.icon;
                    return (
                      <li key={row.chapterId} className="flex items-center gap-2 text-sm" data-testid="job-chapter" data-status={row.status}>
                        <Icon size={14} className={`${st.cls} ${st.spin ? 'animate-spin' : ''} flex-shrink-0`} />
                        <span className="flex-1 truncate">{ch ? `Chapter ${ch.number}: ${ch.title}` : 'Chapter'}</span>
                        <span className={`text-xs mono ${st.cls}`}>{st.label}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Chapters */}
      <div className="space-y-4">
        {sortedChapters.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-700 mb-2">No Chapters Yet</h3>
            <p className="text-gray-500">Add chapters to your book to generate audiobook</p>
          </div>
        ) : (
          sortedChapters.map((chapter, idx) => {
            const file = audioFiles[chapter.id];
            const url = audioFileUrl(file);
            const progress = chapterProgress(chapter.id);
            const busy = starting === chapter.id || (progress && progress.status !== 'done' && progress.status !== 'failed');
            const isCurrentTrack = !!url && currentTrack?.url === url;
            const isCurrentlyPlaying = isCurrentTrack && isPlaying;
            const st = progress ? CHAPTER_STATUS[progress.status] || CHAPTER_STATUS.pending : null;
            const length = formatDuration(file?.durationSec);

            return (
              <div key={chapter.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow" data-testid="audiobook-chapter" data-chapter-id={chapter.id}>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <span className="text-lg font-bold text-indigo-700">{chapter.number || idx + 1}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-gray-800 mb-1">{chapter.title}</h3>
                    {chapter.summary && <p className="text-sm text-gray-600 mb-2">{chapter.summary}</p>}

                    {st && (
                      <p className={`text-sm mono flex items-center gap-1 ${st.cls}`} data-testid="chapter-progress">
                        <st.icon size={14} className={st.spin ? 'animate-spin' : ''} />
                        {st.label}{progress.error ? `: ${progress.error}` : ''}
                      </p>
                    )}

                    {url && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg" data-testid="chapter-audio">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <button
                            onClick={() => togglePlay(chapter)}
                            data-testid="chapter-play"
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors ${isCurrentlyPlaying ? 'bg-purple-500 text-white hover:bg-purple-600' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                          >
                            {isCurrentlyPlaying ? <><Pause className="w-4 h-4" />Pause</> : <><Play className="w-4 h-4" />{isCurrentTrack ? 'Resume' : 'Play'}</>}
                          </button>
                          <a href={url} download={audioFileName(file, chapter)} className="btn sm" data-testid="chapter-download">
                            <Download className="w-4 h-4" />
                            Download MP3
                          </a>
                          <button type="button" onClick={() => generate([chapter], chapter.id)} disabled={busy || !chapter.content} className="btn sm" data-testid="chapter-regenerate">
                            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                            Regenerate
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>Audio ready{isCurrentTrack ? ' (loaded in player)' : ''}</span>
                          {length && <span className="pill">{length}</span>}
                          {file?.voice && <span className="pill">{voiceLabel(file.voice, lists)}</span>}
                        </div>
                      </div>
                    )}

                    {!chapter.content && (
                      <div className="mt-2 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">This chapter has no content yet</div>
                    )}
                  </div>

                  {!url && chapter.content && (
                    <button
                      onClick={() => generate([chapter], chapter.id)}
                      disabled={busy}
                      data-testid="chapter-generate"
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {busy ? <><Loader className="w-4 h-4 animate-spin" />Generating...</> : <><Volume2 className="w-4 h-4" />Generate Audio</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">About Audiobook Generation</h4>
        <ul className="text-sm text-blue-800 space-y-1 list-disc pl-5">
          <li>VibeVoice: 25 natural voices in many languages, the fastest engine</li>
          <li>Qwen: 9 preset voices, plus custom voices cloned from your own sample</li>
          <li>Generate one chapter or the whole book; it carries on if you leave the tab</li>
          <li>Download each chapter as an MP3, or play the book from start to end in the player</li>
        </ul>
      </div>

      {showDialog && <CustomVoiceDialog onClose={() => setShowDialog(false)} onCreated={onVoiceCreated} />}
    </div>
  );
};

export default AudiobookTab;
