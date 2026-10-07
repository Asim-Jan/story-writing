import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Mic, Square, Loader, RotateCcw } from 'lucide-react';

// "Add a custom voice": a 3-30 s sample (uploaded or recorded here), a name,
// an optional transcript and the speaker's consent. POSTs multipart to
// /api/voices (field names from the audiobook contract) and hands the new
// voice back.

const MIN_SEC = 3;
const MAX_SEC = 30;
const MAX_BYTES = 15 * 1024 * 1024;

export const SUGGESTED_PARAGRAPH = 'The morning light crept slowly across the harbour, catching the edges of the old fishing boats. '
  + 'Somewhere a gull called out, and a door creaked open on the hill. I had waited a long time for this day, '
  + 'and now that it was here, I wanted to remember every small detail of it.';

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
const pickRecorderType = () => (typeof MediaRecorder !== 'undefined'
  ? RECORDER_TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) || ''
  : '');
const extensionFor = (type) => (type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm');

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// Read an audio blob's duration (seconds), or null if the browser can't tell.
const probeDuration = (blob) => new Promise((resolve) => {
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
  audio.preload = 'metadata';
  audio.onloadedmetadata = () => {
    if (Number.isFinite(audio.duration)) return done(audio.duration);
    // webm from MediaRecorder reports Infinity until it is seeked to the end
    audio.currentTime = 1e7;
    audio.ontimeupdate = () => { audio.ontimeupdate = null; done(Number.isFinite(audio.duration) ? audio.duration : null); };
  };
  audio.onerror = () => done(null);
  audio.src = url;
});

const CustomVoiceDialog = ({ onClose, onCreated }) => {
  const [mode, setMode] = useState('upload'); // 'upload' | 'record'
  const [name, setName] = useState('');
  const [transcript, setTranscript] = useState('');
  const [consent, setConsent] = useState(false);
  const [sample, setSample] = useState(null); // { blob, filename, durationSec, url }
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const startedRef = useRef(0);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    clearInterval(timerRef.current);
  };

  useEffect(() => () => {
    stopStream();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  useEffect(() => () => { if (sample?.url) URL.revokeObjectURL(sample.url); }, [sample]);

  const takeSample = async (blob, filename, knownSec) => {
    const durationSec = knownSec ?? await probeDuration(blob);
    if (blob.size > MAX_BYTES) return setError('That file is over 15 MB. Use a shorter clip.');
    if (durationSec !== null && durationSec < MIN_SEC) return setError(`The sample is ${durationSec.toFixed(1)} s; it needs at least ${MIN_SEC} s of speech.`);
    if (durationSec !== null && durationSec > MAX_SEC + 0.5) return setError(`The sample is ${Math.round(durationSec)} s; keep it to ${MAX_SEC} s or less.`);
    setError(null);
    setSample({ blob, filename, durationSec, url: URL.createObjectURL(blob) });
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^audio\//.test(file.type) && !/\.(wav|mp3|m4a|ogg|webm)$/i.test(file.name)) {
      setError('Choose an audio file: WAV, MP3, M4A, OGG or WebM.');
      return;
    }
    takeSample(file, file.name);
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio here. Upload a file instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const type = pickRecorderType();
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const elapsed = (Date.now() - startedRef.current) / 1000;
        stopStream();
        setRecording(false);
        const mime = recorder.mimeType || type || 'audio/webm';
        const blob = new Blob(chunks, { type: mime });
        takeSample(blob, `recording.${extensionFor(mime)}`, Math.min(elapsed, MAX_SEC));
      };
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setRecordSec(0);
      setSample(null);
      recorder.start(250);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const sec = (Date.now() - startedRef.current) / 1000;
        setRecordSec(sec);
        if (sec >= MAX_SEC && recorder.state === 'recording') recorder.stop();
      }, 200);
    } catch (err) {
      stopStream();
      setError(err?.name === 'NotAllowedError'
        ? 'Microphone access was refused. Allow it in the browser, or upload a file instead.'
        : `Could not start recording: ${err?.message || err}`);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const canSave = !!sample && name.trim().length > 0 && consent && !saving && !recording;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('sample', sample.blob, sample.filename);
      form.append('name', name.trim());
      form.append('consent', 'true');
      if (transcript.trim()) form.append('transcript', transcript.trim());
      const token = localStorage.getItem('token');
      const response = await fetch('/api/voices', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.voice) throw new Error(body?.error || `Upload failed (${response.status})`);
      onCreated(body.voice);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="custom-voice-title" data-testid="custom-voice-dialog">
      <div className="card bg-[var(--bg2)] w-full max-w-xl max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 id="custom-voice-title" className="text-lg font-bold text-[var(--ink)]">Add a custom voice</h3>
            <p className="text-sm text-[var(--dim)]">A 3 to 30 second sample is enough. Qwen clones the voice from it.</p>
          </div>
          <button type="button" onClick={onClose} className="iconb" title="Close" aria-label="Close"><X size={18} /></button>
        </div>

        <label className="block mb-4">
          <span className="lbl block mb-1">Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Narrator - Asim" className="w-full" maxLength={60} data-testid="voice-name" />
        </label>

        <div className="tabs mb-3">
          <button type="button" className={mode === 'upload' ? 'on' : ''} onClick={() => { if (!recording) setMode('upload'); }}>Upload a file</button>
          <button type="button" className={mode === 'record' ? 'on' : ''} onClick={() => setMode('record')} data-testid="mode-record">Record</button>
        </div>

        <div className="text-sm text-[var(--dim)] mb-3">
          Read a natural paragraph in a quiet room, at your normal pace, about 10 to 20 seconds. Avoid music, echo and other voices.
        </div>

        {mode === 'upload' ? (
          <label className="btn sm cursor-pointer mb-3">
            <Upload size={14} />
            Choose audio file
            <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" onChange={onFile} className="hidden" data-testid="voice-file" />
          </label>
        ) : (
          <div className="mb-3">
            <p className="lbl mb-1">Suggested paragraph</p>
            <p className="text-sm text-[var(--ink)] border border-[var(--line)] px-3 py-2 mb-3" data-testid="suggested-paragraph">{SUGGESTED_PARAGRAPH}</p>
            <div className="flex items-center gap-3">
              {recording ? (
                <button type="button" onClick={stopRecording} className="btn sm" data-testid="record-stop">
                  <Square size={14} className="text-[var(--red)]" />
                  Stop
                </button>
              ) : (
                <button type="button" onClick={startRecording} className="btn sm" data-testid="record-start">
                  <Mic size={14} />
                  {sample ? 'Record again' : 'Start recording'}
                </button>
              )}
              <span className={`mono text-sm ${recording ? 'text-[var(--red)]' : 'text-[var(--dim)]'}`} data-testid="record-timer">
                {fmt(recordSec)} / {fmt(MAX_SEC)}
              </span>
              {recording && recordSec < MIN_SEC && <span className="text-xs text-[var(--dim)]">keep going, at least {MIN_SEC} s</span>}
            </div>
          </div>
        )}

        {sample && (
          <div className="flex items-center gap-3 mb-3" data-testid="voice-sample">
            <audio src={sample.url} controls className="flex-1 h-9" />
            <span className="pill">{sample.durationSec ? `${sample.durationSec.toFixed(1)} s` : 'length unknown'}</span>
            <button type="button" onClick={() => setSample(null)} className="btn ghost sm" title="Discard sample"><RotateCcw size={14} /></button>
          </div>
        )}

        <label className="block mb-4">
          <span className="lbl block mb-1">Transcript (optional)</span>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} className="w-full text-sm" placeholder="What the sample says. Leave empty and we'll transcribe it." data-testid="voice-transcript" />
        </label>

        <label className="flex items-start gap-2 mb-4 text-sm text-[var(--ink)]">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" data-testid="voice-consent" />
          <span>This is my voice, or I have the speaker's permission to clone it.</span>
        </label>

        {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 mb-3" role="alert">{error}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn sm">Cancel</button>
          <button type="button" onClick={save} disabled={!canSave} className="btn pri sm" data-testid="voice-save">
            {saving ? <Loader size={14} className="animate-spin" /> : null}
            {saving ? 'Saving...' : 'Save voice'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomVoiceDialog;
