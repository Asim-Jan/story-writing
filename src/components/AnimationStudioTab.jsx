import React, { useState, useEffect, useRef } from 'react';
import { Film, Play, Download, Trash2, Loader, CheckCircle2, Video, Users, UserPlus, Palette, Image as ImageIcon, Scissors, Clapperboard, Share2 } from 'lucide-react';
import { getMediaUrl } from '../utils/mediaUrl';
import { useMediaJobsContext, MediaJobList, MediaJobStatus } from '../contexts/MediaJobsContext';
import { characterFields } from './CharacterReferences';
import { FILM_STYLES, DEFAULT_FILM_STYLE, filmStyle, buildCast, sceneTransition } from '../utils/filmCast';
import { chosenStill, chosenTake, chooseStill, chooseTake, removeStill, removeTake, storyboardScenes, renderScenes, cutScenes, sceneListLabel, scenesInLabel, soundForServer, addStill, setTrim, moveScene, dismissAdvice, takeReviewSuggestion, dismissReview, sceneForServer } from '../utils/filmTakes';
import FilmSoundPanel from './FilmSoundPanel';
import FilmSceneCard from './FilmSceneCard';

// Rendering a film is a book media job (type "animation", target the
// transcript): it runs on the server whether or not this tab is open, its
// per-scene progress comes from the job list, and the finished project is
// added to the book by the book-level jobs hook. Parsed scenes are kept in the
// book at metadata.animationDrafts[transcriptId], so leaving the tab (or
// reloading) does not lose them.

const formatDuration = (seconds) => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
};

// finalVideo carries a storageKey (older projects) or a videoUrl (media jobs).
const videoSrc = (finalVideo) => getMediaUrl(finalVideo, 'videos') || finalVideo?.videoUrl || null;

const RENDER_OPTIONS = {};

// Any film with rendered clips can be joined again: films joined before
// 2.23.55 were a plain concat (hard cuts, uneven sound), and a newer one picks
// up transitions changed on the scene list since it was made.
const canRejoin = (project) => (project.scenes || []).some(sc => sc?.filename && sc.status === 'completed');

// The scenes a running job is busy with: its progress rows that are not
// finished, else (before it reports) the scenes its label names.
const busyIn = (job) => {
  const rows = job.progress?.scenes;
  if (Array.isArray(rows) && rows.length) return rows.filter(r => r.status !== 'completed' && r.status !== 'failed').map(r => Number(r.sceneNumber));
  return scenesInLabel(job.label);
};

// A small keyframe picture (16:9), opening full size in a new tab.
const KeyframeThumb = ({ url, sceneNumber, className = '' }) => (url ? (
  <a href={url} target="_blank" rel="noreferrer" title={`Scene ${sceneNumber} keyframe`} className={`block flex-shrink-0 ${className}`}>
    <img src={url} alt={`Scene ${sceneNumber} keyframe`} data-testid="keyframe-thumb" className="w-16 h-9 object-cover rounded border border-gray-200 bg-gray-100" />
  </a>
) : null);

// One locked style per film; persisted on the draft and sent as options.style.
const FilmStylePicker = ({ value, onChange }) => (
  <div className="mb-4" data-testid="film-style-picker">
    <p className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
      <Palette className="w-4 h-4" />
      Film style
      <span className="font-normal text-gray-500">(every scene is drawn in this one style)</span>
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2" role="radiogroup" aria-label="Film style">
      {FILM_STYLES.map(style => {
        const selected = style.id === value;
        return (
          <button
            key={style.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`film-style-${style.id}`}
            onClick={() => onChange(style.id)}
            className={`text-left p-3 rounded-lg border-2 transition-colors ${selected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
          >
            <span className="block font-semibold text-gray-900 text-sm">{style.label}</span>
            <span className="block text-xs text-gray-600 mt-0.5">{style.description}</span>
          </button>
        );
      })}
    </div>
  </div>
);

// Who appears in the parsed scenes, matched to the book's characters the way
// the server matches them. A character with no portrait is drawn from text
// only and drifts between scenes, so offer to make one (a reference job).
const FilmCastPanel = ({ scenes, characters, styleId }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [starting, setStarting] = useState(() => new Set());
  const [error, setError] = useState(null);
  const { matched, unmatched } = buildCast(scenes, characters);

  const portraitJobs = (id) => jobsFor('character', id).filter(j => j.type === 'reference');
  const busy = (id) => starting.has(id) || portraitJobs(id).some(j => j.status === 'running');
  const missing = matched.filter(row => !row.referenceUrl);

  const makePortrait = async (character) => {
    setStarting(prev => new Set(prev).add(character.id));
    try {
      await startJob('reference', { type: 'character', id: character.id }, {
        kind: 'portrait',
        character: characterFields(character),
        style: filmStyle(styleId).portraitStyle,
      }, `Portrait: ${character.name || 'character'}`);
    } catch (err) {
      setError(`Could not start a portrait for ${character.name}: ${err.message}`);
    } finally {
      setStarting(prev => { const next = new Set(prev); next.delete(character.id); return next; });
    }
  };

  const makeAllMissing = async () => {
    setError(null);
    for (const row of missing) {
      if (!busy(row.character.id)) await makePortrait(row.character);
    }
  };

  if (!matched.length && !unmatched.length) return null;
  const missingIdle = missing.filter(row => !busy(row.character.id));

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 mb-4" data-testid="film-cast">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Users className="w-4 h-4" />
          Cast ({matched.length})
          <span className="font-normal text-gray-500">portraits keep each character the same in every scene</span>
        </p>
        {missing.length > 0 && (
          <button
            type="button"
            onClick={makeAllMissing}
            disabled={!missingIdle.length}
            data-testid="make-all-portraits"
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <UserPlus className="w-3 h-3" />
            Make all missing portraits ({missing.length})
          </button>
        )}
      </div>

      {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 mb-3" role="alert">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {matched.map(({ character, scenes: inScenes, referenceUrl }) => (
          <div
            key={character.id}
            data-testid="cast-member"
            data-character={character.name}
            data-has-portrait={referenceUrl ? 'yes' : 'no'}
            className={`flex items-start gap-3 p-2 rounded border ${referenceUrl ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}
          >
            {referenceUrl ? (
              <img src={referenceUrl} alt={character.name} className="w-12 h-12 object-cover rounded flex-shrink-0 bg-gray-100" />
            ) : (
              <div className="w-12 h-12 rounded flex-shrink-0 bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center">
                <Users className="w-5 h-5 text-gray-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{character.name}</p>
              <p className="text-xs text-gray-500">Scene{inScenes.length === 1 ? '' : 's'} {inScenes.join(', ')}</p>
              {!referenceUrl && (
                <>
                  <p className="text-xs text-amber-800 mt-1">No portrait: this character will be drawn from text only and may change between scenes.</p>
                  <button
                    type="button"
                    onClick={() => { setError(null); makePortrait(character); }}
                    disabled={busy(character.id)}
                    data-testid="make-portrait"
                    className="mt-1 px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors flex items-center gap-1"
                  >
                    {busy(character.id) ? <Loader className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                    {busy(character.id) ? 'Making portrait...' : 'Make portrait'}
                  </button>
                </>
              )}
              <MediaJobList jobs={portraitJobs(character.id)} compact className="mt-1 text-xs" />
            </div>
          </div>
        ))}
      </div>

      {unmatched.length > 0 && (
        <div className="mt-3" data-testid="cast-unmatched">
          <p className="text-xs font-semibold text-gray-700">Not in your cast</p>
          <p className="text-xs text-gray-600">{unmatched.join(', ')}. Drawn from the scene text only; add them on the Characters tab to keep them consistent.</p>
        </div>
      )}
    </div>
  );
};

const AnimationStudioTab = ({ data, bookId, setData, saveBook }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const transcripts = data.transcripts || [];
  const animationProjects = data.animationProjects || [];
  const drafts = data.metadata?.animationDrafts || {};
  // renders and rejoins both target the transcript; only renders drive the steps
  const animationJobs = jobsFor('animation').filter(j => j.type === 'animation');
  const joinJobs = jobsFor('animation').filter(j => j.type === 'film-join');
  const [joining, setJoining] = useState(null); // project id while its rejoin is starting

  // Coming back to the tab opens what the user was working on: a transcript
  // that is rendering (or failed), else the most recently parsed one.
  const pickInitial = () => {
    const job = animationJobs.find(j => j.status === 'running') || animationJobs[0];
    if (job) return String(job.target?.id ?? '');
    const latest = Object.entries(drafts)
      .filter(([, d]) => d?.scenes?.length)
      .sort((a, b) => String(b[1].parsedAt || '').localeCompare(String(a[1].parsedAt || '')))[0];
    return latest ? latest[0] : '';
  };

  const [selectedTranscript, setSelectedTranscript] = useState(pickInitial);
  const [view, setView] = useState(() => (pickInitial() ? 'scenes' : 'select'));
  const [parsing, setParsing] = useState(false);
  const [starting, setStarting] = useState(null); // 'film' | scene number while a job is being created
  const [actionError, setActionError] = useState(null);
  const [editingScene, setEditingScene] = useState(null);
  const [videoDurations, setVideoDurations] = useState({}); // project id -> seconds, from the video element
  const chosenRef = useRef(!!selectedTranscript); // the user (or the first pick) chose; stop auto-picking

  // The job list can arrive after the tab mounted: pick then, once.
  const draftCount = Object.keys(drafts).length;
  useEffect(() => {
    if (chosenRef.current) return;
    const initial = pickInitial();
    if (initial) {
      chosenRef.current = true;
      setSelectedTranscript(initial);
      setView('scenes');
    }
  }, [animationJobs.length, draftCount]);

  const transcriptTitle = (id) => transcripts.find(t => String(t.id) === String(id))?.title || 'Untitled transcript';
  const draft = selectedTranscript ? drafts[selectedTranscript] : null;
  const parsedScenes = draft?.scenes?.length ? draft.scenes : null;
  // a film's own style, else the book's art style when it is one of the film styles
  const bookFilmStyle = FILM_STYLES.some(st => st.id === data.metadata?.artStyle?.id) ? data.metadata.artStyle.id : DEFAULT_FILM_STYLE;
  const styleId = FILM_STYLES.some(st => st.id === draft?.style) ? draft.style : bookFilmStyle;

  // every job on this transcript: storyboards, takes, whole films, cuts
  const jobsHere = jobsFor('animation').filter(j => String(j.target?.id) === String(selectedTranscript));
  const runningHere = jobsHere.filter(j => j.status === 'running');
  const failedHere = jobsHere.filter(j => j.status === 'failed');
  const elsewhere = animationJobs.filter(j => String(j.target?.id) !== String(selectedTranscript));
  const busyWith = (types) => new Set(runningHere.filter(j => types.includes(j.type)).flatMap(busyIn));
  const stillBusySet = busyWith(['storyboard']);
  const takeBusySet = busyWith(['animation']);
  const cutting = runningHere.some(j => j.type === 'film-join');
  // the newest word on a scene from a running (or failed) job
  const progressFor = (n) => {
    for (const j of [...runningHere, ...failedHere]) {
      const row = (j.progress?.scenes || []).find(r => Number(r.sceneNumber) === Number(n));
      if (row && row.status !== 'completed') return row;
    }
    return null;
  };
  const writeDraft = (transcriptId, change) => {
    setData(prev => {
      const all = prev.metadata?.animationDrafts || {};
      const next = change(all[transcriptId]);
      if (!next) return prev;
      return { ...prev, metadata: { ...(prev.metadata || {}), animationDrafts: { ...all, [transcriptId]: next } } };
    });
  };

  const choose = (transcriptId, nextView) => {
    chosenRef.current = true;
    setActionError(null);
    setSelectedTranscript(transcriptId);
    setView(nextView);
  };

  const handleParseTranscript = async () => {
    if (!selectedTranscript) return;
    const transcriptId = selectedTranscript;
    setParsing(true);
    setActionError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/video/parse-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          transcriptId,
          bookId,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || result?.message || 'Failed to parse transcript');
      }
      if (!Array.isArray(result?.scenes) || !result.scenes.length) throw new Error('No scenes were found in this transcript');

      // Saved in the book (autosave persists it), so the scenes survive
      // leaving the tab or reloading.
      writeDraft(transcriptId, (old) => ({ ...(old?.style ? { style: old.style } : {}), scenes: result.scenes, parsedAt: new Date().toISOString() }));
      choose(transcriptId, 'scenes');
    } catch (error) {
      setActionError('Failed to parse transcript: ' + error.message);
    } finally {
      setParsing(false);
    }
  };

  const updateScene = (sceneNumber, updates) => {
    writeDraft(selectedTranscript, (d) => d && ({
      ...d,
      scenes: d.scenes.map(s => (s.sceneNumber === sceneNumber ? { ...s, ...updates } : s)),
    }));
  };

  const setFilmStyle = (style) => writeDraft(selectedTranscript, (d) => d && ({ ...d, style }));

  const target = () => ({ type: 'animation', id: selectedTranscript });
  const run = async (key, fn, what) => {
    setStarting(key);
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      setActionError(`${what}: ${error.message}`);
    } finally {
      setStarting(null);
    }
  };

  // stills only (seconds each): the storyboard
  const drawStills = (numbers) => run(`still:${numbers.join(',')}`, () => startJob('storyboard', target(),
    { scenes: storyboardScenes(parsedScenes, numbers), style: styleId }, sceneListLabel('Storyboard', numbers)), 'Could not draw the stills');

  // new takes from the chosen stills (no film is joined)
  const renderTakes = (numbers) => run(`take:${numbers.join(',')}`, () => startJob('animation', target(),
    { scenes: renderScenes(parsedScenes, numbers), options: { ...RENDER_OPTIONS, style: styleId, takesOnly: true } }, sceneListLabel('Takes', numbers)), 'Could not render');

  // render every scene without a take, then cut the film with the kept ones
  const makeFilm = (numbers) => run('film', () => startJob('animation', target(),
    { scenes: renderScenes(parsedScenes, numbers, { wholeFilm: true }), options: { ...RENDER_OPTIONS, style: styleId, sound: soundForServer(draft?.sound) } }, sceneListLabel('Film', numbers)), 'Could not make the film');

  // the film from the chosen takes: free, no rendering
  const cutFilm = () => run('cut', () => startJob('film-join', target(),
    { cut: { scenes: cutScenes(parsedScenes), title: transcriptTitle(selectedTranscript), style: styleId, sound: soundForServer(draft?.sound) } }, 'Cutting the film'), 'Could not cut the film');

  const handleRejoin = async (project) => {
    setJoining(project.id);
    setActionError(null);
    try {
      // the scene list's transitions (as edited there) for the film's scenes
      const draftScenes = drafts[project.transcriptId]?.scenes || [];
      const transitions = {};
      draftScenes.forEach((sc, i) => { if (i > 0) transitions[sc.sceneNumber] = sceneTransition(draftScenes, i); });
      await startJob('film-join', { type: 'animation', id: project.transcriptId ?? 'film' }, { projectId: project.id, transitions }, `Rejoining: ${project.title || 'film'}`);
    } catch (error) {
      setActionError(`Could not rejoin the film: ${error.message}`);
    } finally {
      setJoining(null);
    }
  };

  const draftEdit = (fn) => setData(prev => fn(prev));
  const [uploadingStill, setUploadingStill] = useState(null); // scene number

  // the shot doctor on a scene's chosen still (and the still before it)
  const adviseStill = (scene, idx) => run(`advice:${scene.sceneNumber}`, () => startJob('film-advice', target(), {
    scene: sceneForServer(scene), still: chosenStill(scene), previousStill: idx > 0 ? chosenStill(parsedScenes[idx - 1]) || undefined : undefined,
  }, `Notes on scene ${scene.sceneNumber}'s still`), 'Could not get notes');
  const adviceBusy = (n) => starting === `advice:${n}` || runningHere.some(j => j.type === 'film-advice' && j.label === `Notes on scene ${n}'s still`);
  const takeAdvice = (scene, redraw) => {
    const prompt = scene.advice?.prompt;
    if (!prompt) return;
    draftEdit(b => dismissAdvice(b, selectedTranscript, scene.sceneNumber));
    updateScene(scene.sceneNumber, { visualPrompt: prompt });
    if (redraw) {
      const scenes = parsedScenes.map(sc => (sc.sceneNumber === scene.sceneNumber ? { ...sc, visualPrompt: prompt } : sc));
      run(`still:${scene.sceneNumber}`, () => startJob('storyboard', target(), { scenes: storyboardScenes(scenes, [scene.sceneNumber]), style: styleId },
        sceneListLabel('Storyboard', [scene.sceneNumber])), 'Could not redraw the still');
    }
  };

  // change something in the chosen still ("make it night")
  const editStill = (scene, instruction) => run(`still:${scene.sceneNumber}`, () => startJob('storyboard', target(), {
    scenes: [{ ...sceneForServer(scene), edit: { from: chosenStill(scene), instruction } }], style: styleId,
  }, sceneListLabel('Storyboard', [scene.sceneNumber])), 'Could not edit the still');

  // the author's own picture as the scene's opening frame
  const uploadStill = async (scene, file) => {
    if (!file) return;
    setUploadingStill(scene.sceneNumber);
    setActionError(null);
    try {
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('file', file);
      form.append('bucketType', 'images');
      if (bookId) form.append('bookId', bookId);
      const response = await fetch('/api/media/upload', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include', body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.url) throw new Error(body?.error || `Upload failed (${response.status})`);
      draftEdit(b => addStill(b, selectedTranscript, scene.sceneNumber, body.url, 'uploaded'));
    } catch (error) {
      setActionError(`Could not upload the still: ${error.message}`);
    } finally {
      setUploadingStill(null);
    }
  };

  // the director: pacing, lengths and transitions for the whole list
  const reviewing = runningHere.some(j => j.type === 'film-review') || starting === 'review';
  const reviewFilm = () => run('review', () => startJob('film-review', target(), {
    scenes: parsedScenes.map((sc, i) => ({ sceneNumber: sc.sceneNumber, title: sc.title, visualPrompt: sc.visualPrompt, duration: sc.duration,
      transition: i > 0 ? sceneTransition(parsedScenes, i) : undefined, clipSeconds: chosenTake(sc)?.duration || undefined })),
  }, 'Director\'s review'), 'Could not review the film');
  const review = draft?.review;

  // a finished film as WhatsApp MP4 / GIF
  const exportJobs = jobsFor('animation').filter(j => j.type === 'film-export');
  const EXPORT_LABEL = { whatsapp: 'WhatsApp', gif: 'GIF' };
  const exportLabel = (project, format) => `${EXPORT_LABEL[format]} version [${project.id}]`;
  const exporting = (project, format) => exportJobs.some(j => j.status === 'running' && j.label === exportLabel(project, format));
  const exportFilm = (project, format) => run(`export:${project.id}:${format}`, () => startJob('film-export', { type: 'animation', id: project.transcriptId ?? 'film' },
    { projectId: project.id, filename: project.finalVideo?.filename, format }, exportLabel(project, format)), 'Could not convert the film');
  const showScenes = view === 'scenes' && !!parsedScenes;
  const showStep1 = !showScenes;
  const noStill = (parsedScenes || []).filter(sc => !chosenStill(sc)).map(sc => sc.sceneNumber);
  const noTake = (parsedScenes || []).filter(sc => !chosenTake(sc)).map(sc => sc.sceneNumber);
  const withTake = (parsedScenes || []).length - noTake.length;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Film className="w-8 h-8" />
          <h2 className="text-3xl font-bold">Animation Studio</h2>
        </div>
        <p className="text-purple-100">
          Transform your transcripts into AI-generated animated films with SAI video
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Transcripts</p>
          <p className="text-2xl font-bold text-gray-900">{transcripts.length}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Animations</p>
          <p className="text-2xl font-bold text-purple-600" data-testid="animation-count">{animationProjects.length}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Parsed Scenes</p>
          <p className="text-2xl font-bold text-blue-600" data-testid="parsed-scene-count">{parsedScenes?.length || 0}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Est. Duration</p>
          <p className="text-2xl font-bold text-green-600">
            {parsedScenes ? `${Math.floor(parsedScenes.reduce((sum, s) => sum + (s.duration || 8), 0) / 60)}m` : '0m'}
          </p>
        </div>
      </div>

      {/* Renders of other transcripts keep going; say so and offer a way back */}
      {elsewhere.length > 0 && (
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200 space-y-2">
          <p className="text-sm font-semibold text-gray-900">Other renders</p>
          {elsewhere.map(job => (
            <div key={job.jobId} className="flex items-start gap-3">
              <MediaJobStatus job={job} className="flex-1" />
              <button onClick={() => choose(String(job.target?.id ?? ''), 'scenes')} className="btn sm flex-shrink-0">Show</button>
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2" role="alert">{actionError}</div>
      )}

      {/* Step 1: Select Transcript */}
      {showStep1 && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Step 1: Select Transcript</h3>

          {transcripts.length === 0 ? (
            <div className="text-center py-8">
              <Film className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No transcripts available</p>
              <p className="text-gray-500 text-sm mt-2">
                Go to the Transcripts tab to generate a screenplay from a chapter first
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <select
                value={selectedTranscript}
                onChange={(e) => choose(e.target.value, 'select')}
                data-testid="transcript-select"
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="">Choose a transcript...</option>
                {transcripts.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title} - {t.sceneCount} scenes ({t.estimatedDuration}){drafts[String(t.id)]?.scenes?.length ? ' - parsed' : ''}
                  </option>
                ))}
              </select>

              {parsedScenes && (
                <button
                  onClick={() => setView('scenes')}
                  className="w-full px-6 py-3 bg-white border-2 border-purple-300 text-purple-700 hover:bg-purple-50 rounded-lg transition-all font-semibold flex items-center justify-center gap-2"
                >
                  <Film className="w-5 h-5" />
                  Open parsed scenes ({parsedScenes.length})
                </button>
              )}

              <button
                onClick={handleParseTranscript}
                disabled={!selectedTranscript || parsing}
                data-testid="parse-transcript"
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-semibold flex items-center justify-center gap-2"
              >
                {parsing ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Parsing Transcript...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    {parsedScenes ? 'Parse again (replaces the saved scenes)' : 'Parse into Video Scenes'}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: the scene list as a workbench: stills, takes, the cut */}
      {showScenes && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200" data-testid="animation-scenes">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-xl font-bold text-gray-900">
              Step 2: Storyboard, takes and the cut ({parsedScenes.length} scenes)
              <span className="block text-sm font-normal text-gray-500">{transcriptTitle(selectedTranscript)}</span>
            </h3>
            <button
              onClick={() => setView('select')}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors flex-shrink-0"
            >
              Back to Selection
            </button>
          </div>

          <MediaJobList jobs={[...runningHere.filter(j => j.type !== 'film-join'), ...failedHere]} className="mb-4"
            hint="This runs on the server; you can leave this tab and come back." />

          <FilmCastPanel scenes={parsedScenes} characters={data.characters || []} styleId={styleId} />
          <FilmStylePicker value={styleId} onChange={setFilmStyle} />

          <div className="border-2 border-purple-200 bg-purple-50 rounded-lg p-4 mb-4" data-testid="film-workflow">
            <p className="text-sm text-purple-900 mb-3">
              <strong>1.</strong> Draw the storyboard (a still per scene, seconds each) and redraw any that look wrong.{' '}
              <strong>2.</strong> Render clips from the stills (a few minutes each); render another take of any scene you don't like.{' '}
              <strong>3.</strong> Cut the film from the takes you chose (free).
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => drawStills(noStill.length ? noStill : parsedScenes.map(sc => sc.sceneNumber))}
                disabled={stillBusySet.size > 0 || String(starting || '').startsWith('still')} data-testid="draw-storyboard"
                className="px-3 py-2 bg-white border-2 border-purple-400 text-purple-800 hover:bg-purple-100 disabled:opacity-50 rounded-lg text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                {noStill.length === parsedScenes.length ? `Draw the storyboard (${noStill.length} stills)`
                  : noStill.length ? `Draw ${noStill.length} missing still${noStill.length === 1 ? '' : 's'}` : 'Redraw every still'}
              </button>
              <button type="button" onClick={() => renderTakes(noTake)}
                disabled={!noTake.length || takeBusySet.size > 0 || String(starting || '').startsWith('take')} data-testid="render-missing"
                title="Animate each scene that has no clip yet from its chosen still"
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-2">
                <Video className="w-4 h-4" />
                {noTake.length ? `Render ${noTake.length} clip${noTake.length === 1 ? '' : 's'}` : 'Every scene has a clip'}
              </button>
              <button type="button" onClick={cutFilm} disabled={!withTake || cutting || starting === 'cut'} data-testid="cut-film"
                title="Join the chosen take of every scene with its transition and levelled sound. No clip is rendered again, and it is free."
                className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-2">
                {cutting ? <Loader className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                {cutting ? 'Cutting the film...' : `Cut the film (${withTake} of ${parsedScenes.length} scenes)`}
              </button>
            </div>
            {withTake > 0 && noTake.length > 0 && (
              <p className="text-xs text-purple-800 mt-2">Scenes without a clip are left out of the cut.</p>
            )}
          </div>

          <div className="mb-4" data-testid="film-review">
            <button type="button" onClick={reviewFilm} disabled={reviewing} data-testid="review-film"
              title="SAI reads the scene list as a director: pacing, scene lengths and transitions"
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 rounded text-sm flex items-center gap-2">
              {reviewing ? <Loader className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
              {reviewing ? 'Reviewing...' : review ? 'Review the film again' : "Director's review"}
            </button>
            {review && (
              <div className="mt-2 p-3 border border-blue-200 bg-blue-50 rounded text-sm" data-testid="review-panel">
                {review.overall && <p className="text-gray-900">{review.overall}</p>}
                {review.scenes?.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {review.scenes.map(r => (
                      <li key={r.sceneNumber} className="flex flex-wrap items-start gap-2 text-xs" data-testid="review-row">
                        <span className="font-semibold">Scene {r.sceneNumber}:</span>
                        <span className="flex-1 min-w-[12rem]">{r.note}{r.duration ? ` (${r.duration} s)` : ''}{r.transition ? ` (begin with: ${r.transition})` : ''}</span>
                        {(r.duration || r.transition) && (
                          <button type="button" onClick={() => draftEdit(b => takeReviewSuggestion(b, selectedTranscript, r.sceneNumber))} data-testid="review-apply"
                            className="px-1.5 py-0.5 bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100">Apply</button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-gray-600 mt-1">No changes suggested.</p>}
                <div className="flex gap-2 mt-2">
                  {review.scenes?.some(r => r.duration || r.transition) && (
                    <button type="button" onClick={() => draftEdit(b => takeReviewSuggestion(b, selectedTranscript, null))} data-testid="review-apply-all"
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded">Apply all lengths and transitions</button>
                  )}
                  <button type="button" onClick={() => draftEdit(b => dismissReview(b, selectedTranscript))} className="px-2 py-1 text-xs text-gray-600 hover:underline">Dismiss</button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">A new length takes effect when the scene is rendered again.</p>
              </div>
            )}
          </div>

          <div className="space-y-4 max-h-[75vh] overflow-y-auto mb-6 pr-1">
            {parsedScenes.map((scene, idx) => (
              <FilmSceneCard
                key={scene.sceneNumber}
                scene={scene}
                index={idx}
                scenes={parsedScenes}
                editing={editingScene === scene.sceneNumber}
                onToggleEdit={() => setEditingScene(editingScene === scene.sceneNumber ? null : scene.sceneNumber)}
                onUpdate={(updates) => updateScene(scene.sceneNumber, updates)}
                progress={progressFor(scene.sceneNumber)}
                stillBusy={stillBusySet.has(Number(scene.sceneNumber)) || starting === `still:${scene.sceneNumber}`}
                takeBusy={takeBusySet.has(Number(scene.sceneNumber)) || starting === `take:${scene.sceneNumber}` || starting === 'film'}
                onDrawStill={() => drawStills([scene.sceneNumber])}
                onRenderTake={() => renderTakes([scene.sceneNumber])}
                onChooseStill={(url) => draftEdit(b => chooseStill(b, selectedTranscript, scene.sceneNumber, url))}
                onRemoveStill={(url) => draftEdit(b => removeStill(b, selectedTranscript, scene.sceneNumber, url))}
                onChooseTake={(id) => draftEdit(b => chooseTake(b, selectedTranscript, scene.sceneNumber, id))}
                onRemoveTake={(id) => { if (confirm('Delete this take?')) draftEdit(b => removeTake(b, selectedTranscript, scene.sceneNumber, id)); }}
                onMove={(by) => draftEdit(b => moveScene(b, selectedTranscript, scene.sceneNumber, by))}
                canMoveUp={idx > 0}
                canMoveDown={idx < parsedScenes.length - 1}
                onAdvise={() => adviseStill(scene, idx)}
                adviceBusy={adviceBusy(scene.sceneNumber)}
                onUseAdvice={(redraw) => takeAdvice(scene, redraw)}
                onDismissAdvice={() => draftEdit(b => dismissAdvice(b, selectedTranscript, scene.sceneNumber))}
                onEditStill={(instruction) => editStill(scene, instruction)}
                onUploadStill={(file) => uploadStill(scene, file)}
                uploadBusy={uploadingStill === scene.sceneNumber}
                onTrim={(takeId, patch) => draftEdit(b => setTrim(b, selectedTranscript, scene.sceneNumber, takeId, patch))}
              />
            ))}
          </div>

          <FilmSoundPanel data={data} setData={setData} transcriptId={selectedTranscript} scenes={parsedScenes} bookId={bookId} />

          <p className="text-xs text-gray-600 mb-2">
            In one go: render every scene that has no clip yet (each from its still, or a new one), then cut the film. About {Math.max(1, Math.ceil(noTake.length * 1.5))} to {Math.max(2, Math.ceil(noTake.length * 3))} minutes; it keeps going if you leave this tab.
          </p>
          <button
            onClick={() => (noTake.length ? makeFilm(noTake) : cutFilm())}
            disabled={starting === 'film' || takeBusySet.size > 0 || cutting}
            data-testid="generate-film"
            className="w-full px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-bold text-lg flex items-center justify-center gap-3"
          >
            {starting === 'film' ? <Loader className="w-6 h-6 animate-spin" /> : <Film className="w-6 h-6" />}
            {noTake.length ? `Make the ${filmStyle(styleId).label} film (render ${noTake.length} clip${noTake.length === 1 ? '' : 's'}, then cut)` : 'Cut the film from the chosen takes'}
          </button>
        </div>
      )}

      {/* Existing Animation Projects */}
      {animationProjects.length > 0 && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Your Animation Films</h3>
          <MediaJobList jobs={[...joinJobs, ...exportJobs.filter(j => j.status === 'failed')]} className="mb-4" hint="Joining the existing scenes; this takes a minute or two. The new film appears below." />

          <div className="space-y-4">
            {animationProjects.map(project => (
              <div key={project.id} className="border-2 border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-[14rem]">
                    <h4 className="font-bold text-gray-900 text-lg">{project.title}</h4>
                    <div className="flex gap-4 text-sm text-gray-600 mt-1">
                      <span>{project.scenes?.length || 0} scenes</span>
                      {project.style && <span data-testid="project-style">{filmStyle(project.style).label}</span>}
                      {(project.finalVideo?.duration || videoDurations[project.id]) > 0 && (
                        <span>{formatDuration(project.finalVideo?.duration || videoDurations[project.id])}</span>
                      )}
                      <span>{(project.finalVideo?.size / 1024 / 1024).toFixed(1)} MB</span>
                      <span className="text-purple-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</span>
                      {project.rejoinedFrom && <span className="text-gray-500" data-testid="project-rejoined">Rejoined</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canRejoin(project) && (
                      <button
                        onClick={() => handleRejoin(project)}
                        disabled={joining === project.id || joinJobs.some(j => j.status === 'running')}
                        title="Join this film's scenes again with the scene list's transitions and even sound. No scene is rendered again, and it is free; the current film is kept so you can compare."
                        data-testid="film-rejoin"
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
                      >
                        <Film className="w-4 h-4" />
                        {project.finalVideo?.joinVersion ? 'Rejoin' : 'Rejoin with smooth transitions'}
                      </button>
                    )}
                    <a
                      href={videoSrc(project.finalVideo)}
                      download
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>
                    {project.finalVideo?.filename && [['whatsapp', 'WhatsApp'], ['gif', 'GIF']].map(([format, label]) => {
                      const file = project.finalVideo.files?.[format];
                      if (file) {
                        return (
                          <a key={format} href={file.url} download data-testid={`film-export-${format}-link`}
                            title={`${label} version (${(file.size / 1024 / 1024).toFixed(1)} MB)`}
                            className="px-3 py-2 bg-white border-2 border-green-600 text-green-700 hover:bg-green-50 rounded-lg transition-colors flex items-center gap-2 text-sm">
                            <Download className="w-4 h-4" />{label}
                          </a>
                        );
                      }
                      const busy = exporting(project, format) || starting === `export:${project.id}:${format}`;
                      return (
                        <button key={format} type="button" onClick={() => exportFilm(project, format)} disabled={busy} data-testid={`film-export-${format}`}
                          title={format === 'whatsapp' ? 'A smaller MP4 (720p) that chat apps send without compressing it again' : 'A silent looping GIF, 480 px wide'}
                          className="px-3 py-2 bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 text-sm">
                          {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}{label}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        if (confirm('Delete this animation project?')) {
                          const remaining = animationProjects.filter(p => p.id !== project.id);
                          setData(prev => ({ ...prev, animationProjects: remaining }));
                          // persist (setData alone never reached the server)
                          if (saveBook) saveBook({ animationProjects: remaining }).catch(err => console.error('Animation delete save failed:', err));
                        }
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>

                {/* Video Preview */}
                {project.finalVideo && (
                  <div className="bg-black rounded-lg overflow-hidden">
                    <video
                      src={videoSrc(project.finalVideo)}
                      controls
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        const seconds = e.currentTarget.duration;
                        if (Number.isFinite(seconds)) setVideoDurations(prev => ({ ...prev, [project.id]: seconds }));
                      }}
                      className="w-full"
                      style={{ maxHeight: '400px' }}
                    >
                      Your browser does not support video playback.
                    </video>
                  </div>
                )}

                {/* Scene Breakdown */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900 font-medium">
                    View {project.scenes?.length || 0} scenes
                  </summary>
                  <div className="mt-2 space-y-2">
                    {project.scenes?.map((scene, idx) => (
                      <div key={idx} className="bg-gray-50 rounded p-2 text-xs flex items-center gap-3" data-testid="project-scene">
                        <KeyframeThumb url={scene.keyframeUrl} sceneNumber={scene.sceneNumber} />
                        <div className="flex-1 min-w-0">
                          <span className="font-bold">Scene {scene.sceneNumber}:</span> {scene.title}
                          {scene.status === 'completed' && <span className="ml-2 text-green-600">Done</span>}
                          {scene.status === 'failed' && <span className="ml-2 text-red-600">Failed</span>}
                          {scene.cast?.length > 0 && <span className="block text-gray-500">Cast: {scene.cast.join(', ')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-6">
        <h4 className="font-bold text-purple-900 mb-3">About Animation Studio</h4>
        <ul className="space-y-2 text-sm text-purple-800">
          <li>• <strong>Storyboard first:</strong> every scene's opening frame is drawn as a still in seconds, so you can fix the pictures before paying for video</li>
          <li>• <strong>Takes:</strong> render another take of any scene and choose the one the film uses; the film is cut from the chosen takes for free</li>
          <li>• <strong>AI Video Generation:</strong> Each scene becomes a short cinematic clip (up to 10 seconds)</li>
          <li>• <strong>Scene Parsing:</strong> Automatically breaks transcripts into filmable scenes</li>
          <li>• <strong>Native Audio:</strong> clips come with generated sound</li>
          <li>• <strong>Professional Assembly:</strong> FFmpeg stitches scenes into complete films</li>
          <li>• <strong>Smooth joins:</strong> each scene begins with a continue, cut, dissolve or fade, and the sound is evened out and blended at every change</li>
          <li>• <strong>Cloud Storage:</strong> All videos stored in MinIO, accessible from any device</li>
        </ul>
      </div>
    </div>
  );
};

export default AnimationStudioTab;
