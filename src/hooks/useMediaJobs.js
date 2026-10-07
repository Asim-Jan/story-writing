import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { chapterHeading } from '../utils/chapters';
import { applyEnhanceJob } from '../utils/enhanceFromBook';

// Book media jobs: every image, reference sheet and animation is a SERVER job
// listed per book. This hook is created once for the open book (in
// FictionWritingStudio), so a generation's progress and its result survive
// switching character, tab, or reloading the page.
//
// The server never writes the book for these jobs. When a job is done, the
// result is applied here with a functional setData, and the job is
// acknowledged only after a book save that contains it has succeeded: an ack
// before the save would lose the result if the tab died in between.

const POLL_MS = 4000;

// A comic-specific reference also becomes the character's comic reference
// image (ComicTab's characterRefs map). The label is how the job says so.
export const COMIC_REFERENCE_LABEL = 'Comic reference: ';

const authHeaders = (json = false) => {
  const token = localStorage.getItem('token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const fileName = (url) => String(url || '').split('?')[0].split('/').pop() || undefined;

const refKey = (ref) => ref?.id || ref?.imageUrl;

let visualSeq = 0;
const newVisualId = () => Date.now() * 1000 + (visualSeq++ % 1000);

// Fold a reference result into a character: the new images go to the front
// (the sheet was made after the portrait, so it is newest), and a portrait
// becomes the main image when the character had none. Images the character
// already has are skipped, so applying the same result twice is a no-op that
// returns the SAME object.
export const addReferences = (character, result) => {
  const have = new Set((character.referenceImages || []).map(refKey));
  const fresh = [result.reference, result.portrait].filter(ref => ref?.imageUrl && !have.has(refKey(ref)));
  if (!fresh.length) return character;
  const next = { ...character, referenceImages: [...fresh, ...(character.referenceImages || [])] };
  const portrait = result.portrait || (result.reference?.kind === 'portrait' ? result.reference : null);
  if (!character.imageUrl && portrait) next.imageUrl = portrait.imageUrl;
  return next;
};

const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);

const applyReference = (book, job) => {
  const result = job.result || {};
  if (!result.reference && !result.portrait) return book;
  const characters = book.characters || [];
  const character = characters.find(c => sameId(c.id, job.target?.id));
  if (!character) return book; // the character was deleted: nothing to keep
  const updated = addReferences(character, result);
  if (updated === character) return book;
  const next = { ...book, characters: characters.map(c => (c === character ? updated : c)) };
  const comicUrl = result.reference?.imageUrl;
  if (comicUrl && String(job.label || '').startsWith(COMIC_REFERENCE_LABEL)) {
    next.characterRefs = { ...(book.characterRefs || {}), [character.id]: comicUrl };
  }
  return next;
};

// An image job lands in the visuals library too (as each tab's old accept
// step did), and that visual is the "already applied" marker: once it is
// there, a re-apply changes nothing, even if the user has since picked a
// different portrait.
const applyImage = (book, job) => {
  const url = job.result?.imageUrl;
  if (!url) return book;
  const visuals = book.visuals || [];
  if (visuals.some(v => v.url === url || v.imageUrl === url)) return book;

  const filename = fileName(url);
  const id = job.target?.id;
  const visual = { id: newVisualId(), description: job.label || job.result?.prompt || 'Generated image', url, filename, createdAt: job.finishedAt || new Date().toISOString() };
  const next = { ...book, visuals: [...visuals, visual] };

  switch (job.target?.type) {
    case 'character': {
      const character = (book.characters || []).find(c => sameId(c.id, id));
      if (character) {
        visual.description = character.name || visual.description;
        visual.characterId = character.id;
        next.characters = book.characters.map(c => (c === character ? { ...c, imageUrl: url, imageFilename: filename } : c));
      }
      break;
    }
    case 'location': {
      const location = (book.locations || []).find(l => sameId(l.id, id));
      if (location) {
        visual.description = location.name || visual.description;
        visual.locationId = location.id;
        next.locations = book.locations.map(l => (l === location ? { ...l, imageUrl: url, imageFilename: filename } : l));
      }
      break;
    }
    case 'chapter': {
      const chapter = (book.chapters || []).find(ch => sameId(ch.id, id));
      if (chapter) {
        visual.description = chapterHeading(chapter);
        visual.chapterId = chapter.id;
        next.chapters = book.chapters.map(ch => (ch === chapter ? { ...ch, coverImage: url, coverImageFilename: filename } : ch));
      }
      break;
    }
    case 'cover':
      visual.description = `Cover - ${book.bookTitle || 'Book'}`;
      next.metadata = { ...(book.metadata || {}), coverImage: url };
      break;
    default: // 'visual': the label is the description the user typed
      break;
  }
  return next;
};

const applyAnimation = (book, job) => {
  const project = job.result?.project;
  if (!project?.id) return book;
  const projects = book.animationProjects || [];
  if (projects.some(p => p.id === project.id)) return book;
  const next = { ...book, animationProjects: [...projects, project] };

  // Mark the rendered scenes on the saved draft, so the scene list shows them
  // as generated when the user comes back to it.
  const transcriptId = String(job.target?.id ?? project.transcriptId ?? '');
  const draft = book.metadata?.animationDrafts?.[transcriptId];
  if (draft?.scenes?.length && project.scenes?.length) {
    const status = new Map(project.scenes.map(s => [s.sceneNumber, s.status]));
    next.metadata = {
      ...book.metadata,
      animationDrafts: {
        ...book.metadata.animationDrafts,
        [transcriptId]: {
          ...draft,
          scenes: draft.scenes.map(s => (status.has(s.sceneNumber) ? { ...s, status: status.get(s.sceneNumber) } : s)),
        },
      },
    };
  }
  return next;
};

// An audiobook job's files go into audioFiles, keyed by chapter id. A file
// only replaces an entry that is older (by createdAt), so re-applying an old
// unacknowledged job after a reload can't undo a newer regeneration. A failed
// job's partial files are applied too.
const fileTime = (file) => Date.parse(file?.createdAt || '') || 0;
const applyAudiobook = (book, job) => {
  const files = job.result?.files;
  if (!files || typeof files !== 'object') return book;
  const current = book.audioFiles || {};
  let next = null;
  for (const [chapterId, file] of Object.entries(files)) {
    if (!file?.audioUrl && !file?.filename) continue;
    const have = current[chapterId];
    if (have && (have.audioUrl === file.audioUrl || fileTime(have) > fileTime(file))) continue;
    if (!next) next = { ...current };
    next[chapterId] = file;
  }
  return next ? { ...book, audioFiles: next } : book;
};

// ---- analysis (characters, places, plot found in the book's text) ----
// Merged by name, case-insensitively. A field the user already filled is never
// overwritten; only empty ones are filled. New items are marked fromImport.
// Returns the SAME book when there is nothing left to merge.
const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
let importSeq = 0;
const importId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(importSeq++).toString(36)}`;

// Merge `incoming` items into `list` by key. `fill(item)` gives the fields an
// existing item may receive (only where empty); `create(item)` builds a new one.
const mergeByName = (list = [], incoming = [], keyOf, fill, create) => {
  let next = null;
  const out = () => (next || (next = [...list]));
  for (const item of incoming || []) {
    const key = normName(keyOf(item));
    if (!key) continue;
    const current = next || list;
    const at = current.findIndex(x => normName(keyOf(x)) === key);
    if (at === -1) { out().push(create(item)); continue; }
    const existing = current[at];
    let updated = null;
    for (const [field, value] of Object.entries(fill(item))) {
      if (isEmpty(value) || !isEmpty(existing[field])) continue;
      updated = updated || { ...existing };
      updated[field] = value;
    }
    if (updated) out()[at] = updated;
  }
  return next || list;
};

const applyAnalysis = (book, job) => {
  const r = job.result;
  if (!r || typeof r !== 'object') return book;
  const next = { ...book };
  let changed = false;
  const set = (field, value) => { if (value !== book[field]) { next[field] = value; changed = true; } };

  set('characters', mergeByName(book.characters, r.characters, c => c.name,
    c => ({ role: c.role, description: c.description, background: c.description, appearance: c.appearance, firstChapter: c.firstChapter, mentions: c.mentions, aliases: c.aliases }),
    c => ({ id: importId('char'), name: String(c.name).trim(), role: c.role || '', description: c.description || '', background: c.description || '',
      appearance: c.appearance || '', aliases: c.aliases || [], firstChapter: c.firstChapter ?? null, mentions: c.mentions ?? null, relationships: [], referenceImages: [], fromImport: true })));
  set('locations', mergeByName(book.locations, r.locations, l => l.name,
    l => ({ type: l.type, description: l.description, firstChapter: l.firstChapter }),
    l => ({ id: importId('loc'), name: String(l.name).trim(), type: l.type || '', description: l.description || '', significance: '', atmosphere: '', history: '',
      firstChapter: l.firstChapter ?? null, fromImport: true })));
  set('plotlines', mergeByName(book.plotlines, r.plotlines, pl => pl.title || pl.name,
    pl => ({ description: pl.description, chapters: pl.chapters }),
    pl => ({ id: importId('plot'), title: String(pl.title || pl.name).trim(), type: '', description: pl.description || '', status: 'planning', themes: '', conflicts: '',
      linkedPlotlines: [], chapters: pl.chapters || [], fromImport: true })));

  // timeline: append events that aren't there yet (same title and chapter)
  const events = book.timelines || [];
  const eventKey = (title, chapter) => `${normName(title)}|${chapter ?? ''}`;
  const have = new Set(events.map(e => eventKey(e.event || e.title, e.chapter)));
  const added = (r.timeline || [])
    .filter(e => e?.title && !have.has(eventKey(e.title, e.chapter)))
    .filter((e, i, arr) => arr.findIndex(x => eventKey(x.title, x.chapter) === eventKey(e.title, e.chapter)) === i)
    .map(e => ({ id: importId('evt'), event: e.title, description: e.description || '', chapter: e.chapter ?? null,
      chapterHint: e.chapter != null ? `Chapter ${e.chapter}` : '', date: '', location: '', sceneType: 'action', branch: 'main', locked: false, fromImport: true }));
  if (added.length) set('timelines', [...events, ...added]);

  // summaries for chapters that have none
  const summaries = r.chapterSummaries || {};
  if (Object.keys(summaries).length && (book.chapters || []).some(ch => isEmpty(ch.summary) && !isEmpty(summaries[ch.id]))) {
    set('chapters', book.chapters.map(ch => (isEmpty(ch.summary) && !isEmpty(summaries[ch.id]) ? { ...ch, summary: summaries[ch.id] } : ch)));
  }
  if (isEmpty(book.overview) && !isEmpty(r.overview)) set('overview', r.overview);

  const status = job.status === 'done' ? 'completed' : 'partial';
  const analyzedAt = job.finishedAt || job.updatedAt || null;
  const prevMark = book.metadata?.importAnalysis;
  if (!prevMark || prevMark.status !== status || prevMark.analyzedAt !== analyzedAt) {
    next.metadata = { ...(book.metadata || {}), importAnalysis: { status, analyzedAt, ...(status === 'partial' ? { error: job.error || null } : {}) } };
    changed = true;
  }
  return changed ? next : book;
};

// Apply a job's result to a book. Pure and idempotent: when there is nothing
// (more) to apply it returns the SAME book object, which is how the hook tells
// "already in the book" apart from "still to apply".
export const applyJob = (book, job) => {
  if (!book) return book;
  switch (job.type) {
    case 'reference': return applyReference(book, job);
    case 'image': return applyImage(book, job);
    case 'animation': return applyAnimation(book, job);
    case 'film-join': return applyAnimation(book, job); // a rejoined film is a new project
    case 'audiobook': return applyAudiobook(book, job);
    case 'analysis': return applyAnalysis(book, job);
    case 'enhance': return applyEnhanceJob(book, job);
    default: return book;
  }
};

const hasPartialFiles = (job) => job.type === 'audiobook' && Object.keys(job.result?.files || {}).length > 0;
const hasPartialAnalysis = (job) => job.type === 'analysis' && !!job.result
  && ['characters', 'locations', 'plotlines', 'timeline'].some(k => (job.result[k] || []).length > 0);
const isApplicable = (job) => job.status === 'done'
  || (job.status === 'failed' && (!!job.result?.portrait || hasPartialFiles(job) || hasPartialAnalysis(job)));

export const useMediaJobs = ({ bookId, data, setData, ready, savedSnapshot }) => {
  const [jobs, setJobs] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const ackedRef = useRef(new Set());   // acked (or acking) job ids: never shown again
  const trackRef = useRef(new Map());   // jobId -> { committedAt, settled }
  const localRef = useRef(new Map());   // jobId -> { job, addedAt } started in this tab
  const disabledRef = useRef(false);    // the server has no media-jobs API

  const fetchJobs = useCallback(async () => {
    if (!bookId || disabledRef.current) return;
    const fetchedAt = Date.now();
    try {
      const response = await fetch(`/api/books/${bookId}/media-jobs`, { headers: authHeaders(), credentials: 'include' });
      if (response.status === 404 || response.status === 501) { disabledRef.current = true; return; }
      if (!response.ok) return;
      const body = await response.json().catch(() => null);
      const listed = (Array.isArray(body?.jobs) ? body.jobs : []).filter(j => j?.jobId && !ackedRef.current.has(j.jobId));
      const ids = new Set(listed.map(j => j.jobId));
      // A job started while this request was in the air may not be in the
      // reply yet; keep it rather than flicker it away until the next poll.
      const pending = [];
      for (const [jobId, entry] of localRef.current) {
        if (ids.has(jobId)) localRef.current.delete(jobId);
        else if (entry.addedAt >= fetchedAt && !ackedRef.current.has(jobId)) pending.push(entry.job);
      }
      setJobs([...pending, ...listed]);
    } catch {
      // offline or the server is restarting: keep what we have, poll again
    }
  }, [bookId]);

  // Load on open, and again whenever the window regains focus.
  useEffect(() => {
    setJobs([]);
    trackRef.current = new Map();
    localRef.current = new Map();
    disabledRef.current = false;
    fetchJobs();
    const onFocus = () => fetchJobs();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchJobs]);

  // Poll every 4 s while anything is running; stop when nothing is.
  const runningCount = jobs.filter(j => j.status === 'running').length;
  const anyRunning = runningCount > 0;
  useEffect(() => {
    if (!anyRunning) return undefined;
    const timer = setInterval(fetchJobs, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, fetchJobs]);

  const ack = useCallback(async (jobId) => {
    if (ackedRef.current.has(jobId)) return;
    ackedRef.current.add(jobId);
    setJobs(prev => prev.filter(j => j.jobId !== jobId));
    try {
      const response = await fetch(`/api/books/${bookId}/media-jobs/${jobId}/ack`, {
        method: 'POST', headers: authHeaders(true), credentials: 'include', body: '{}',
      });
      if (!response.ok && response.status !== 404) throw new Error(`ack ${response.status}`);
    } catch {
      // let the next list bring it back; it is already applied, so the
      // re-apply is a no-op and the ack is retried
      ackedRef.current.delete(jobId);
    }
  }, [bookId]);

  // Apply finished results, then ack each one once a save holds it.
  useEffect(() => {
    if (!ready || !bookId) return;
    for (const job of jobs) {
      if (ackedRef.current.has(job.jobId)) continue;
      if (!isApplicable(job)) {
        if (job.status === 'failed' && dismissed.has(job.jobId)) ack(job.jobId);
        continue;
      }
      let track = trackRef.current.get(job.jobId);
      if (!track) {
        track = { committedAt: null, settled: false };
        trackRef.current.set(job.jobId, track);
        if (applyJob(data, job) !== data) {
          setData(prev => applyJob(prev, job));
          continue; // committed on a later render
        }
      }
      if (track.committedAt === null) {
        if (applyJob(data, job) !== data) continue; // not rendered yet
        track.committedAt = Date.now();
      }
      if (!track.settled && savedSnapshot) {
        const saved = savedSnapshot.book;
        const savedHasIt = applyJob(saved, job) === saved;
        const fromLoad = savedSnapshot.startedAt === 0;
        const savedAfterApply = savedSnapshot.startedAt >= track.committedAt;
        if (savedHasIt && (fromLoad || savedAfterApply)) track.settled = true;
        // saved after the apply but without it: the user removed it again,
        // so there is nothing left to protect
        else if (savedAfterApply && applyJob(data, job) !== data) track.settled = true;
      }
      if (track.settled && (job.status === 'done' || dismissed.has(job.jobId))) ack(job.jobId);
    }
  }, [ready, bookId, jobs, data, savedSnapshot, dismissed, setData, ack]);

  const startJob = useCallback(async (type, target, params, label) => {
    if (!bookId) throw new Error('Save the book before generating media');
    const response = await fetch(`/api/books/${bookId}/media-jobs`, {
      method: 'POST',
      headers: authHeaders(true),
      credentials: 'include',
      body: JSON.stringify({ type, target, params, ...(label ? { label } : {}) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.job) {
      const message = body?.error || body?.message || `Request failed (${response.status})`;
      const err = new Error(body?.detail ? `${message}: ${body.detail}` : message);
      err.status = response.status;
      err.body = body;
      throw err;
    }
    const job = body.job;
    localRef.current.set(job.jobId, { job, addedAt: Date.now() });
    setJobs(prev => [job, ...prev.filter(j => j.jobId !== job.jobId)]);
    window.dispatchEvent(new Event('quotaRefresh'));
    return job;
  }, [bookId]);

  const dismiss = useCallback((jobId) => {
    setDismissed(prev => new Set(prev).add(jobId));
  }, []);

  // Running and failed (not dismissed) jobs: what the UI shows.
  const visible = useMemo(
    () => jobs.filter(j => j.status === 'running' || (j.status === 'failed' && !dismissed.has(j.jobId))),
    [jobs, dismissed],
  );

  const jobsFor = useCallback(
    (targetType, id) => visible.filter(j => j.target?.type === targetType && (id === undefined || sameId(j.target?.id, id))),
    [visible],
  );

  return { jobs: visible, runningCount, startJob, jobsFor, dismiss, refresh: fetchJobs };
};
