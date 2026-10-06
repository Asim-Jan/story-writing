import React, { useState, useEffect, useRef } from 'react';
import { Film, Play, Download, Trash2, Edit3, Loader, CheckCircle2, AlertCircle, Video, Zap, Clock } from 'lucide-react';
import { getMediaUrl } from '../utils/mediaUrl';
import { useMediaJobsContext, MediaJobList, MediaJobStatus } from '../contexts/MediaJobsContext';

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

const RENDER_OPTIONS = { resolution: '1080p', transitionType: 'fade' };

// A single-scene render is labelled "Scene N: ..."; a whole film "Animation: ...".
const sceneLabelPrefix = (sceneNumber) => `Scene ${sceneNumber}: `;
const isSceneJob = (job) => /^Scene \d+: /.test(String(job.label || ''));

const SCENE_STATUS = {
  pending: { label: 'Waiting', cls: 'text-[var(--dim)]' },
  rendering: { label: 'Rendering', cls: 'text-[var(--blue)]' },
  completed: { label: 'Done', cls: 'text-[var(--ok)]' },
  failed: { label: 'Failed', cls: 'text-[var(--red)]' },
};

const AnimationStudioTab = ({ data, bookId, setData, saveBook }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const transcripts = data.transcripts || [];
  const animationProjects = data.animationProjects || [];
  const drafts = data.metadata?.animationDrafts || {};
  const animationJobs = jobsFor('animation');

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

  const jobsHere = animationJobs.filter(j => String(j.target?.id) === String(selectedTranscript));
  const filmJob = jobsHere.find(j => j.status === 'running' && !isSceneJob(j));
  const sceneJobs = jobsHere.filter(j => j.status === 'running' && isSceneJob(j));
  const failedHere = jobsHere.filter(j => j.status === 'failed');
  const elsewhere = animationJobs.filter(j => String(j.target?.id) !== String(selectedTranscript));
  const sceneBusy = (sceneNumber) => starting === sceneNumber
    || sceneJobs.some(j => String(j.label).startsWith(sceneLabelPrefix(sceneNumber)));

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
      writeDraft(transcriptId, () => ({ scenes: result.scenes, parsedAt: new Date().toISOString() }));
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

  const startRender = async (scenes, label, startingKey) => {
    setStarting(startingKey);
    setActionError(null);
    try {
      await startJob('animation', { type: 'animation', id: selectedTranscript }, { scenes, options: RENDER_OPTIONS }, label);
    } catch (error) {
      setActionError(`Video generation failed: ${error.message}`);
    } finally {
      setStarting(null);
    }
  };

  const handleGenerateAnimation = () => {
    if (!parsedScenes) return;
    startRender(parsedScenes, `Animation: ${transcriptTitle(selectedTranscript)}`, 'film');
  };

  const handleGenerateSingleScene = (scene) => {
    startRender([scene], `${sceneLabelPrefix(scene.sceneNumber)}${scene.title || transcriptTitle(selectedTranscript)}`, scene.sceneNumber);
  };

  const showStep3 = view === 'scenes' && !!filmJob;
  const showStep2 = view === 'scenes' && !!parsedScenes && !filmJob;
  const showStep1 = !showStep2 && !showStep3;

  // Per-scene progress of the running film: the job's own list, or the draft
  // as "waiting" until the server reports.
  const filmScenes = filmJob
    ? (filmJob.progress?.scenes?.length
      ? filmJob.progress.scenes
      : (parsedScenes || []).map(s => ({ sceneNumber: s.sceneNumber, status: 'pending' })))
    : [];
  const sceneTitle = (n) => parsedScenes?.find(s => s.sceneNumber === n)?.title;

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

      {/* Step 2: Review & Edit Scenes */}
      {showStep2 && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200" data-testid="animation-scenes">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">
              Step 2: Review Scenes ({parsedScenes.length} scenes)
              <span className="block text-sm font-normal text-gray-500">{transcriptTitle(selectedTranscript)}</span>
            </h3>
            <button
              onClick={() => setView('select')}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
            >
              Back to Selection
            </button>
          </div>

          <MediaJobList jobs={[...sceneJobs, ...failedHere]} className="mb-4" />

          <div className="space-y-4 max-h-96 overflow-y-auto mb-6">
            {parsedScenes.map((scene, idx) => (
              <div key={idx} className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded">
                        Scene {scene.sceneNumber}
                      </span>
                      <h4 className="font-semibold text-gray-900">{scene.title}</h4>
                      <span className="text-xs text-gray-500">{scene.duration}s &middot; {scene.cameraDirection}</span>
                      {scene.status === 'completed' && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">
                          <CheckCircle2 className="w-3 h-3" />
                          Generated
                        </span>
                      )}
                      {scene.status === 'failed' && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
                          <AlertCircle className="w-3 h-3" />
                          Failed
                        </span>
                      )}
                    </div>
                    {editingScene === scene.sceneNumber ? (
                      <textarea
                        value={scene.visualPrompt}
                        onChange={(e) => updateScene(scene.sceneNumber, { visualPrompt: e.target.value })}
                        className="w-full mt-2 px-3 py-2 border border-gray-300 rounded text-sm"
                        rows="3"
                      />
                    ) : (
                      <p className="text-gray-700 text-sm mt-2">{scene.visualPrompt}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingScene(editingScene === scene.sceneNumber ? null : scene.sceneNumber)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleGenerateSingleScene(scene)}
                      disabled={sceneBusy(scene.sceneNumber) || scene.status === 'completed'}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors flex items-center gap-1"
                    >
                      {sceneBusy(scene.sceneNumber) ? (
                        <>
                          <Loader className="w-3 h-3 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          Generate
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {scene.dialogue && (
                  <p className="text-purple-700 text-sm italic mt-2">Dialogue: "{scene.dialogue}"</p>
                )}
                <div className="flex gap-2 mt-2 text-xs text-gray-600">
                  {scene.characters && scene.characters.length > 0 && (
                    <span>Cast: {scene.characters.join(', ')}</span>
                  )}
                  {scene.location && <span>Scene: {scene.location}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-blue-900 font-medium text-sm flex items-center gap-1">
              <Zap className="w-4 h-4" />
              Estimated Cost: ${(parsedScenes.length * 0.10).toFixed(2)} - ${(parsedScenes.length * 0.15).toFixed(2)}
            </p>
            <p className="text-blue-700 text-xs mt-1">
              ~{parsedScenes.length} scenes of up to 10 seconds each, rendered by SAI video (a few minutes per scene)
            </p>
            <p className="text-blue-700 text-xs mt-1">
              Generation time: {Math.ceil(parsedScenes.length * 30 / 60)} - {Math.ceil(parsedScenes.length * 45 / 60)} minutes. It keeps rendering if you leave this tab.
            </p>
          </div>

          <button
            onClick={handleGenerateAnimation}
            disabled={starting === 'film'}
            data-testid="generate-film"
            className="w-full px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-bold text-lg flex items-center justify-center gap-3"
          >
            {starting === 'film' ? <Loader className="w-6 h-6 animate-spin" /> : <Video className="w-6 h-6" />}
            Generate Animation Film ({parsedScenes.length} scenes)
          </button>
        </div>
      )}

      {/* Step 3: Generation Progress (from the job, so it survives leaving) */}
      {showStep3 && (
        <div className="bg-white rounded-lg p-6 border-2 border-purple-200" data-testid="animation-progress">
          <div className="flex items-center justify-between mb-2 gap-3">
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Loader className="w-6 h-6 animate-spin text-purple-600" />
              Generating Animation...
            </h3>
            <button
              onClick={() => setView('select')}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
            >
              Back to Selection
            </button>
          </div>
          <MediaJobStatus job={filmJob} className="mb-4" hint="Rendering runs on the server; you can leave this tab and come back." />

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filmScenes.map(scene => {
              const state = SCENE_STATUS[scene.status] || SCENE_STATUS.pending;
              return (
                <div
                  key={scene.sceneNumber}
                  data-testid="film-scene"
                  data-status={scene.status}
                  className={`p-3 rounded-lg border-l-4 flex items-center gap-3 ${
                    scene.status === 'failed' ? 'bg-red-50 border-red-500' :
                    scene.status === 'completed' ? 'bg-green-50 border-green-500' :
                    scene.status === 'rendering' ? 'bg-blue-50 border-blue-500' :
                    'bg-gray-50 border-gray-400'
                  }`}
                >
                  {scene.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                    : scene.status === 'failed' ? <AlertCircle className="w-4 h-4 text-red-600" />
                    : scene.status === 'rendering' ? <Loader className="w-4 h-4 animate-spin text-blue-600" />
                    : <Clock className="w-4 h-4 text-gray-500" />}
                  <p className="text-sm font-medium text-gray-900 flex-1">
                    Scene {scene.sceneNumber}{sceneTitle(scene.sceneNumber) ? `: ${sceneTitle(scene.sceneNumber)}` : ''}
                    {scene.error && <span className="block text-xs text-red-700 font-normal">{scene.error}</span>}
                  </p>
                  <span className={`text-xs mono ${state.cls}`}>{state.label}</span>
                </div>
              );
            })}
          </div>
          {failedHere.length > 0 && <MediaJobList jobs={failedHere} className="mt-4" />}
        </div>
      )}

      {/* Existing Animation Projects */}
      {animationProjects.length > 0 && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Your Animation Films</h3>

          <div className="space-y-4">
            {animationProjects.map(project => (
              <div key={project.id} className="border-2 border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h4 className="font-bold text-gray-900 text-lg">{project.title}</h4>
                    <div className="flex gap-4 text-sm text-gray-600 mt-1">
                      <span>{project.scenes?.length || 0} scenes</span>
                      {(project.finalVideo?.duration || videoDurations[project.id]) > 0 && (
                        <span>{formatDuration(project.finalVideo?.duration || videoDurations[project.id])}</span>
                      )}
                      <span>{(project.finalVideo?.size / 1024 / 1024).toFixed(1)} MB</span>
                      <span className="text-purple-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={videoSrc(project.finalVideo)}
                      download
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>
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
                      <div key={idx} className="bg-gray-50 rounded p-2 text-xs">
                        <span className="font-bold">Scene {scene.sceneNumber}:</span> {scene.title}
                        {scene.status === 'completed' && <span className="ml-2 text-green-600">Done</span>}
                        {scene.status === 'failed' && <span className="ml-2 text-red-600">Failed</span>}
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
          <li>• <strong>AI Video Generation:</strong> Each scene becomes a short cinematic clip (up to 10 seconds)</li>
          <li>• <strong>Scene Parsing:</strong> Automatically breaks transcripts into filmable scenes</li>
          <li>• <strong>Native Audio:</strong> clips come with generated sound</li>
          <li>• <strong>Professional Assembly:</strong> FFmpeg stitches scenes into complete films</li>
          <li>• <strong>High Quality:</strong> 1080p output with smooth transitions</li>
          <li>• <strong>Cloud Storage:</strong> All videos stored in MinIO, accessible from any device</li>
        </ul>
      </div>
    </div>
  );
};

export default AnimationStudioTab;
