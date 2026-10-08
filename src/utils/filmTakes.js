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
      const still = { url: row.url, jobId: job.jobId, createdAt: at, source: 'drawn', ...(row.check ? { check: row.check } : {}) };
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

// what the server needs of a scene (never the stills/takes lists)
export const sceneForServer = (scene) => {
  const { stills, still, takes, take, status, ...rest } = scene;
  return rest;
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
    return take ? { ...row, reuseTake: { filename: take.filename, videoUrl: take.videoUrl, keyframeUrl: take.keyframeUrl, duration: take.duration } } : null;
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
    ...(transition ? { transition } : {}) };
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
