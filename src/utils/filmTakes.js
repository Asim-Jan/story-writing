// The Animation Studio's scene list as a workbench: each scene keeps its
// storyboard STILLS (opening frames, seconds each) and its TAKES (rendered
// clips, minutes each), one of each chosen. The film is CUT from the chosen
// takes, so a bad scene is fixed by redrawing its still or rendering another
// take, never the whole film. Kept on the draft:
//   book.metadata.animationDrafts[transcriptId].scenes[i] = {
//     ...the parsed scene,
//     stills: [{ url, jobId, createdAt, check?, source }],  still: url (chosen)
//     takes:  [{ id, videoUrl, filename, keyframeUrl, duration, jobId, createdAt }],  take: id (chosen)
//   }
// and draft.appliedJobs: the job ids already applied (a job's stills or
// takes are added once, even if the author deletes them before it is acked).

import { sceneTransition } from './filmCast.js';

export const MAX_STILLS = 6;
export const MAX_TAKES = 6;
const APPLIED_KEEP = 40;

const sameNumber = (a, b) => Number(a) === Number(b);

/** The chosen still's url, else the newest still's, else null. */
export const chosenStill = (scene) => {
  const stills = scene?.stills || [];
  if (scene?.still && stills.some(s => s.url === scene.still)) return scene.still;
  return stills.length ? stills[stills.length - 1].url : null;
};

/** The chosen take, else the newest take, else null. */
export const chosenTake = (scene) => {
  const takes = scene?.takes || [];
  return takes.find(t => t.id === scene?.take) || takes[takes.length - 1] || null;
};

// keep the chosen one; drop the oldest others beyond the limit
const capList = (list, max, keepId, idOf) => {
  let out = list;
  while (out.length > max) {
    const drop = out.findIndex(x => idOf(x) !== keepId);
    if (drop === -1) break;
    out = out.filter((_, i) => i !== drop);
  }
  return out;
};

const withDraft = (book, transcriptId, change) => {
  const drafts = book.metadata?.animationDrafts || {};
  const draft = drafts[String(transcriptId)];
  if (!draft?.scenes?.length) return book;
  const next = change(draft);
  if (!next || next === draft) return book;
  return { ...book, metadata: { ...book.metadata, animationDrafts: { ...drafts, [String(transcriptId)]: next } } };
};

const markApplied = (draft, jobId) => ({ ...draft, appliedJobs: [...(draft.appliedJobs || []), jobId].slice(-APPLIED_KEEP) });
const applied = (draft, jobId) => (draft.appliedJobs || []).includes(jobId);

/** A storyboard job's stills onto the draft; each becomes its scene's chosen still. */
export const applyStoryboard = (book, job) => {
  const rows = (job.result?.stills || []).filter(r => r?.status === 'completed' && r.url);
  if (!rows.length) return book;
  return withDraft(book, job.target?.id, (draft) => {
    if (applied(draft, job.jobId)) return draft;
    const at = job.finishedAt || new Date().toISOString();
    const scenes = draft.scenes.map(sc => {
      const row = rows.find(r => sameNumber(r.sceneNumber, sc.sceneNumber));
      if (!row) return sc;
      const still = { url: row.url, jobId: job.jobId, createdAt: at, source: row.source || 'drawn', ...(row.edit ? { edit: row.edit } : {}), ...(row.check ? { check: row.check } : {}) };
      return { ...sc, stills: capList([...(sc.stills || []), still], MAX_STILLS, row.url, s => s.url), still: row.url };
    });
    return markApplied({ ...draft, scenes }, job.jobId);
  });
};

/**
 * New takes onto the draft, from a takes-only render ({takes}) or a whole
 * film ({project}: its newly rendered scenes). A new take becomes the chosen
 * one; the still it was animated from is recorded with it.
 */
export const applyTakes = (book, job) => {
  const fromProject = (job.result?.project?.scenes || []).filter(sc => !sc.reused);
  const rows = (job.result?.takes || fromProject).filter(r => r?.status === 'completed' && r.filename);
  if (!rows.length) return book;
  return withDraft(book, job.target?.id, (draft) => {
    if (applied(draft, job.jobId)) return draft;
    const at = job.finishedAt || new Date().toISOString();
    const scenes = draft.scenes.map(sc => {
      const row = rows.find(r => sameNumber(r.sceneNumber, sc.sceneNumber));
      if (!row) return sc;
      const take = { id: `take-${job.jobId}-${row.sceneNumber}`, videoUrl: row.videoUrl, filename: row.filename, keyframeUrl: row.keyframeUrl || null,
        duration: Number(row.duration) || null, jobId: job.jobId, createdAt: at };
      return { ...sc, status: 'completed', takes: capList([...(sc.takes || []), take], MAX_TAKES, take.id, t => t.id), take: take.id };
    });
    return markApplied({ ...draft, scenes }, job.jobId);
  });
};

const editScene = (book, transcriptId, sceneNumber, change) => withDraft(book, transcriptId, (draft) => ({
  ...draft,
  scenes: draft.scenes.map(sc => (sameNumber(sc.sceneNumber, sceneNumber) ? change(sc) : sc)),
}));

export const chooseStill = (book, transcriptId, sceneNumber, url) => editScene(book, transcriptId, sceneNumber, sc => ({ ...sc, still: url }));
export const chooseTake = (book, transcriptId, sceneNumber, id) => editScene(book, transcriptId, sceneNumber, sc => ({ ...sc, take: id }));

export const removeStill = (book, transcriptId, sceneNumber, url) => editScene(book, transcriptId, sceneNumber, (sc) => {
  const stills = (sc.stills || []).filter(s => s.url !== url);
  return { ...sc, stills, still: sc.still === url ? (stills[stills.length - 1]?.url || null) : sc.still };
});

export const removeTake = (book, transcriptId, sceneNumber, id) => editScene(book, transcriptId, sceneNumber, (sc) => {
  const takes = (sc.takes || []).filter(t => t.id !== id);
  return { ...sc, takes, take: sc.take === id ? (takes[takes.length - 1]?.id || null) : sc.take, ...(takes.length ? {} : { status: undefined }) };
});

/** A picture the author uploaded (or edited) as a scene's still; it becomes the chosen one. */
export const addStill = (book, transcriptId, sceneNumber, url, source = 'uploaded') => editScene(book, transcriptId, sceneNumber, (sc) => {
  const still = { url, createdAt: new Date().toISOString(), source };
  return { ...sc, stills: capList([...(sc.stills || []).filter(s => s.url !== url), still], MAX_STILLS, url, s => s.url), still: url };
});

// what the server needs of a scene (never the stills/takes lists, advice)
export const sceneForServer = (scene) => {
  const { stills, still, takes, take, status, advice, ...rest } = scene;
  return rest;
};

// the part of a take the film uses (seconds into the clip)
const trimOf = (take) => ({
  ...(Number(take?.trimIn) > 0 ? { trimIn: Number(take.trimIn) } : {}),
  ...(Number(take?.trimOut) > 0 ? { trimOut: Number(take.trimOut) } : {}),
});

/** Set (or clear, with null) where the film starts and ends inside a take. */
export const setTrim = (book, transcriptId, sceneNumber, takeId, patch) => editScene(book, transcriptId, sceneNumber, (sc) => ({
  ...sc,
  takes: (sc.takes || []).map(t => {
    if (t.id !== takeId) return t;
    const next = { ...t };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || !(Number(v) >= 0)) delete next[k];
      else next[k] = Math.round(Number(v) * 100) / 100;
    }
    if (next.trimIn !== undefined && next.trimOut !== undefined && next.trimOut <= next.trimIn + 0.5) delete next.trimOut;
    return next;
  }),
}));

/** Move a scene up (-1) or down (+1) in the film. */
export const moveScene = (book, transcriptId, sceneNumber, by) => withDraft(book, transcriptId, (draft) => {
  const i = draft.scenes.findIndex(sc => sameNumber(sc.sceneNumber, sceneNumber));
  const j = i + by;
  if (i < 0 || j < 0 || j >= draft.scenes.length) return draft;
  const scenes = [...draft.scenes];
  [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
  return { ...draft, scenes };
});

/** The shot doctor's notes on a scene's still. */
export const applyAdvice = (book, job) => {
  const r = job.result;
  if (!r || r.sceneNumber === undefined) return book;
  return withDraft(book, job.target?.id, (draft) => {
    if (applied(draft, job.jobId)) return draft;
    const scenes = draft.scenes.map(sc => (sameNumber(sc.sceneNumber, r.sceneNumber)
      ? { ...sc, advice: { jobId: job.jobId, verdict: r.verdict, notes: r.notes || [], prompt: r.prompt || '', still: r.still || null } }
      : sc));
    return markApplied({ ...draft, scenes }, job.jobId);
  });
};

export const dismissAdvice = (book, transcriptId, sceneNumber) => editScene(book, transcriptId, sceneNumber, (sc) => {
  const { advice, ...rest } = sc;
  return rest;
});

/** The director's review of the whole film. */
export const applyReview = (book, job) => {
  const r = job.result;
  if (!r) return book;
  return withDraft(book, job.target?.id, (draft) => {
    if (applied(draft, job.jobId)) return draft;
    return markApplied({ ...draft, review: { jobId: job.jobId, at: job.finishedAt || new Date().toISOString(), overall: r.overall || '', scenes: r.scenes || [] } }, job.jobId);
  });
};

/** Use one of the review's suggestions (or all: sceneNumber null); used ones leave the list. */
export const takeReviewSuggestion = (book, transcriptId, sceneNumber) => withDraft(book, transcriptId, (draft) => {
  const rows = draft.review?.scenes || [];
  const picked = rows.filter(r => sceneNumber === null || sameNumber(r.sceneNumber, sceneNumber));
  if (!picked.length) return draft;
  const scenes = draft.scenes.map(sc => {
    const r = picked.find(x => sameNumber(x.sceneNumber, sc.sceneNumber));
    if (!r) return sc;
    return { ...sc, ...(r.duration ? { duration: r.duration } : {}), ...(r.transition ? { transition: r.transition } : {}) };
  });
  return { ...draft, scenes, review: { ...draft.review, scenes: rows.filter(r => !picked.includes(r)) } };
});

export const dismissReview = (book, transcriptId) => withDraft(book, transcriptId, (draft) => {
  const { review, ...rest } = draft;
  return rest;
});

/** A film's WhatsApp / GIF version onto its project. */
export const applyExport = (book, job) => {
  const r = job.result;
  if (!r?.filename || !r.projectId) return book;
  const projects = book.animationProjects || [];
  const project = projects.find(p => p.id === r.projectId);
  if (!project?.finalVideo || project.finalVideo.files?.[r.format]?.filename === r.filename) return book;
  const finalVideo = { ...project.finalVideo, files: { ...(project.finalVideo.files || {}), [r.format]: { url: r.url, filename: r.filename, size: r.size } } };
  return { ...book, animationProjects: projects.map(p => (p === project ? { ...p, finalVideo } : p)) };
};

/**
 * The storyboard job's scenes: the ones asked for, in film order, and for a
 * batch that starts mid-film the previous scene's still to draw on.
 */
export const storyboardScenes = (scenes, sceneNumbers) => {
  const out = [];
  scenes.forEach((sc, i) => {
    if (!sceneNumbers.some(n => sameNumber(n, sc.sceneNumber))) return;
    const row = { ...sceneForServer(sc), transition: sceneTransition(scenes, i) || undefined };
    if (!out.length && i > 0) {
      const prev = chosenStill(scenes[i - 1]);
      if (prev) {
        row.previousStill = prev;
        row.previousScene = { location: scenes[i - 1].location, title: scenes[i - 1].title, action: scenes[i - 1].action };
      }
    }
    out.push(row);
  });
  return out;
};

/**
 * The render job's scenes. `render` = the scene numbers to render. Other
 * scenes with a take go along as reuseTake (kept as they are): for a whole
 * film every one (they are in the cut), for takes only the one just before
 * each rendered scene (a "continue" starts from its last frame).
 */
export const renderScenes = (scenes, render, { wholeFilm = false } = {}) => {
  const rendering = (sc) => render.some(n => sameNumber(n, sc.sceneNumber));
  return scenes.map((sc, i) => {
    const row = { ...sceneForServer(sc), transition: sceneTransition(scenes, i) || undefined };
    if (rendering(sc)) {
      const still = chosenStill(sc);
      return still ? { ...row, still } : row;
    }
    const needed = wholeFilm || (scenes[i + 1] && rendering(scenes[i + 1]));
    const take = needed ? chosenTake(sc) : null;
    return take ? { ...row, ...trimOf(take), reuseTake: { filename: take.filename, videoUrl: take.videoUrl, keyframeUrl: take.keyframeUrl, duration: take.duration } } : null;
  }).filter(Boolean);
};

/**
 * The cut: each scene's chosen take in list order, with its transition. A
 * "continue" whose previous scene has no take dissolves instead (the shot it
 * continued is not in the film).
 */
export const cutScenes = (scenes) => scenes.map((sc, i) => {
  const take = chosenTake(sc);
  if (!take) return null;
  let transition = i > 0 ? sceneTransition(scenes, i) : null;
  if (transition === 'continue' && !chosenTake(scenes[i - 1])) transition = 'dissolve';
  return { sceneNumber: sc.sceneNumber, title: sc.title, filename: take.filename, keyframeUrl: take.keyframeUrl, location: sc.location,
    ...(transition ? { transition } : {}), ...(Number.isFinite(sc.clipVolume) ? { clipVolume: sc.clipVolume } : {}), ...trimOf(take) };
}).filter(Boolean);

// A job's label names its scenes ("Storyboard: scenes 1–4, 7"), so the scene
// list knows which scenes a running job is busy with before it reports.
export const sceneListLabel = (prefix, numbers) => {
  const ns = [...new Set(numbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(j > i ? `${ns[i]}–${ns[j]}` : String(ns[i]));
    i = j;
  }
  return `${prefix}: scene${ns.length === 1 ? '' : 's'} ${parts.join(', ')}`.slice(0, 120);
};

export const scenesInLabel = (label) => {
  const m = /: scenes? ([\d–, ]+)$/.exec(String(label || ''));
  if (!m) return [];
  return m[1].split(',').flatMap((part) => {
    const [a, b] = part.trim().split('–').map(Number);
    if (!Number.isFinite(a)) return [];
    if (!Number.isFinite(b)) return [a];
    return Array.from({ length: Math.max(0, Math.min(b - a, 200)) + 1 }, (_, k) => a + k);
  });
};

// ---- the film's sound: draft.sound = { voiceover, music } ----
//   voiceover: { text, voice, url, filename, duration, spokenText, volume, offset }
//   music:     { prompt, url, filename, duration, source, volume }
// A scene's own clip sound: scene.clipVolume (0 = muted, 1 = as rendered).

export const DEFAULT_VOICE_OFFSET = 0.5;
export const DEFAULT_MUSIC_VOLUME = 1;

const withSound = (book, transcriptId, jobId, change) => withDraft(book, transcriptId, (draft) => {
  if (jobId && applied(draft, jobId)) return draft;
  const next = { ...draft, sound: change(draft.sound || {}) };
  return jobId ? markApplied(next, jobId) : next;
});

/** Edit the sound by hand (text, voice, volumes, offset, removing a part). */
export const editSound = (book, transcriptId, part, patch) => withSound(book, transcriptId, null, (sound) => ({
  ...sound,
  [part]: patch === null ? null : { ...(sound[part] || {}), ...patch },
}));

export const applyNarration = (book, job) => {
  const text = String(job.result?.narration || '').trim();
  if (!text) return book;
  return withSound(book, job.target?.id, job.jobId, (sound) => ({ ...sound, voiceover: { ...(sound.voiceover || {}), text, written: { words: job.result.words, seconds: job.result.seconds } } }));
};

export const applyVoiceover = (book, job) => {
  const vo = job.result?.voiceover;
  if (!vo?.filename) return book;
  return withSound(book, job.target?.id, job.jobId, (sound) => ({
    ...sound,
    voiceover: { ...(sound.voiceover || {}), url: vo.url, filename: vo.filename, duration: vo.duration, voice: vo.voice, spokenText: vo.text },
  }));
};

export const applyMusic = (book, job) => {
  const m = job.result?.music;
  if (!m?.filename) return book;
  return withSound(book, job.target?.id, job.jobId, (sound) => ({
    ...sound,
    music: { ...(sound.music || {}), url: m.url, filename: m.filename, duration: m.duration, prompt: m.prompt, source: 'generated' },
  }));
};

/** What the join needs of the sound (files, levels, offset). */
export const soundForServer = (sound) => {
  if (!sound) return undefined;
  const out = {};
  const vo = sound.voiceover;
  if (vo?.filename) out.voiceover = { filename: vo.filename, volume: vo.volume ?? 1, offset: vo.offset ?? DEFAULT_VOICE_OFFSET };
  const m = sound.music;
  if (m?.filename) out.music = { filename: m.filename, volume: m.volume ?? DEFAULT_MUSIC_VOLUME };
  return Object.keys(out).length ? out : undefined;
};

/** The film's running time: each scene's chosen take (else its planned length), less the blends. */
export const filmSeconds = (scenes) => {
  const parts = scenes.map(sc => Number(chosenTake(sc)?.duration) || Number(sc.duration) || 5);
  return Math.max(1, Math.round(parts.reduce((a, b) => a + b, 0) - Math.max(0, parts.length - 1) * 0.4));
};
