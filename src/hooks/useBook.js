import { useState, useEffect, useRef } from 'react';
import { useAutosave } from './useAutosave';

// Use relative URLs to work with Vite proxy for both localhost and ngrok
const API_URL = '';

const emptyBook = () => ({
  bookTitle: 'Untitled Story',
  overview: '',
  characters: [],
  locations: [],
  plotlines: [],
  timelines: [],
  chapters: [],
  notes: [],
  visuals: [],
  audioFiles: {}, // Map of chapterId -> audio metadata
  comicPages: [], // Array of comic pages with panels
  characterRefs: {}, // Map of characterId -> reference image URL
  collaborators: [],
  importedFrom: null, // Import metadata if book was imported
  importAnalysis: null, // AI analysis status for imported books
  animationProjects: [] // Animation films generated from transcripts
});

// The server owns these fields; the client never overwrites them from its own
// copy after a save. The server reply is authoritative for identity + version;
// the content fields belong to the tab that just saved them.
const SERVER_OWNED_FIELDS = ['id', 'version', 'updatedAt', 'createdAt', 'wordCount', 'chapterCount'];

const ensureBookShape = (raw) => ({
  ...emptyBook(),
  ...raw,
  characters: raw.characters || [],
  locations: raw.locations || [],
  plotlines: raw.plotlines || [],
  timelines: raw.timelines || [],
  chapters: raw.chapters || [],
  notes: raw.notes || [],
  visuals: raw.visuals || [],
  comicPages: raw.comicPages || [],
  animationProjects: raw.animationProjects || [],
  collaborators: raw.collaborators || [],
  audioFiles: raw.audioFiles || {},
  characterRefs: raw.characterRefs || {},
});

export const useBook = (bookId) => {
  const [data, setData] = useState(emptyBook);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // the GET failed — a REAL error state, not a blank book
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const hydratedRef = useRef(false); // has the real book arrived?
  const dataRef = useRef(data);      // latest data for same-tick saves

  // Load book data
  useEffect(() => {
    let cancelled = false;
    const loadBook = async () => {
      if (!bookId) {
        // A brand-new (unsaved) book starts blank ON PURPOSE — that is not a
        // load failure; there is nothing to load yet.
        hydratedRef.current = true;
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      hydratedRef.current = false;

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/books/${bookId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include'
        });
        if (cancelled) return;
        if (response.ok) {
          const bookData = await response.json();
          if (cancelled) return;
          setData(ensureBookShape(bookData));
          hydratedRef.current = true;
        } else {
          // 404 or 401/500: show a real error. The old code logged 404 and
          // rendered the EMPTY book — one Save click then PUT those blank
          // arrays over the real book.
          setLoadError(response.status === 404 ? 'Book not found' : 'Failed to load book');
        }
      } catch (err) {
        console.error('Error loading book:', err);
        if (!cancelled) setLoadError('Failed to load book');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadBook();
    return () => { cancelled = true; };
  }, [bookId]);

  // Save book data.
  // saveBook(overrides?) — the save reads state fresh from the CURRENT render
  // unless the caller passes explicit overrides. Callers that set state and
  // then save in the same tick (ComicTab: setData(...); saveBook()) MUST pass
  // the new values here, because `data` still holds the pre-render closure —
  // that stale closure is how ComicTab kept saving the previous comic state.
  const saveBook = async (overrides = null) => {
    // The blank-book save is the data-destroyer: if the real book never loaded
    // (failed GET, still loading), refuse to PUT anything.
    if (bookId && !hydratedRef.current) {
      const err = new Error('Book not loaded — refusing to save over an unknown state');
      setError(err.message);
      throw err;
    }

    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const url = bookId
        ? `${API_URL}/api/books/${bookId}`
        : `${API_URL}/api/books`;

      const method = bookId ? 'PUT' : 'POST';

      const effective = overrides ? { ...data, ...overrides } : dataRef.current;

      // version = the optimistic-lock ticket. The server refuses a write whose
      // version is stale (409) instead of letting last-write-wins clobber.
      const payload = { ...effective, version: effective.version ?? undefined };

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (response.status === 409) {
        // Someone else saved first. Surface it; DON'T overwrite local edits.
        const body = await response.json().catch(() => ({}));
        setError(body.error || 'This book changed on the server while you were editing. Reload to get the latest version, then re-apply your change.');
        throw new Error('Save conflict');
      }

      if (!response.ok) {
        throw new Error('Failed to save book');
      }

      const savedBook = await response.json();

      // Merge ONLY the server-owned fields. The old code spread the whole
      // server response over local state — which clobbered edits made while
      // the save was in the air (ComicTab's stale saves rode this).
      setData(prev => {
        const merged = { ...prev };
        for (const field of SERVER_OWNED_FIELDS) {
          if (savedBook[field] !== undefined) merged[field] = savedBook[field];
        }
        // Chapters: take back server-assigned versions so the NEXT save matches
        // rows correctly, without touching the content the user sees.
        if (Array.isArray(savedBook.chapters) && merged.chapters?.length) {
          const byId = new Map(savedBook.chapters.map(ch => [ch.id, ch]));
          merged.chapters = merged.chapters.map(ch =>
            byId.has(ch.id) ? { ...ch, version: byId.get(ch.id).version, updatedAt: byId.get(ch.id).updatedAt } : ch
          );
        }
        return merged;
      });

      // If this was a new book, update the URL with the new ID
      if (!bookId && savedBook.id) {
        window.history.pushState({}, '', `?book=${savedBook.id}`);
        // Trigger a custom event that App.jsx can listen to
        window.dispatchEvent(new CustomEvent('bookCreated', { detail: { bookId: savedBook.id } }));
      }

      return savedBook;
    } catch (err) {
      if (err.message !== 'Save conflict') {
        console.error('Error saving book:', err);
        if (!err.message.startsWith('Book not loaded')) {
          setError('Failed to save book');
        }
      }
      throw err;
    } finally {
      setSaving(false);
    }
  };

  // Autosave setup. Enabled only once the real book is hydrated — an autosave
  // over a blank book is exactly the mass-delete this hook exists to prevent.
  const autosave = useAutosave(data, saveBook, {
    delay: 30000, // 30 seconds
    enabled: autosaveEnabled && !loading && !loadError && hydratedRef.current,
    onSaveStart: () => setSaving(true),
    onSaveSuccess: () => {
      setSaving(false);
      setError(null);
    },
    onSaveError: (err) => {
      setSaving(false);
      setError('Autosave failed — your changes are still here; press Save Now to retry.');
      console.error('Autosave error:', err);
    },
  });

  // Guard against leaving with unsaved work. (Autosave is on, but a save in
  // flight or a failed autosave must still be surfaced before navigation.)
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const beforeUnload = (e) => {
      if (autosave.status === 'unsaved' || autosave.status === 'saving' || autosave.status === 'error') {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
      return undefined;
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [autosave.status]);

  return {
    data,
    setData,
    loading,
    loadError,
    saving: saving || autosave.isSaving,
    error,
    saveBook,
    autosave: {
      status: autosave.saveStatus,
      lastSaved: autosave.lastSaved,
      saveNow: autosave.saveNow,
      enabled: autosaveEnabled,
      setEnabled: setAutosaveEnabled,
    },
  };
};
