import { useState, useEffect } from 'react';
import { useAutosave } from './useAutosave';

// Use relative URLs to work with Vite proxy for both localhost and ngrok
const API_URL = '';

export const useBook = (bookId) => {
  const [data, setData] = useState({
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);

  // Load book data
  useEffect(() => {
    const loadBook = async () => {
      if (!bookId) {
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/books/${bookId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include'
        });
        if (response.ok) {
          const bookData = await response.json();
          // Merge with default state to ensure all expected fields exist
          setData(prev => ({
            ...prev,
            ...bookData,
            // Ensure arrays exist
            characters: bookData.characters || [],
            locations: bookData.locations || [],
            plotlines: bookData.plotlines || [],
            timelines: bookData.timelines || [],
            chapters: bookData.chapters || [],
            notes: bookData.notes || [],
            visuals: bookData.visuals || [],
            comicPages: bookData.comicPages || [],
            animationProjects: bookData.animationProjects || [],
            collaborators: bookData.collaborators || [],
            // Ensure objects exist
            audioFiles: bookData.audioFiles || {},
            characterRefs: bookData.characterRefs || {},
          }));
        } else if (response.status === 404) {
          // Book not found, use default data
          console.log('Book not found, using default data');
        }
      } catch (err) {
        console.error('Error loading book:', err);
        setError('Failed to load book');
      } finally {
        setLoading(false);
      }
    };

    loadBook();
  }, [bookId]);

  // Save book data
  const saveBook = async () => {
    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const url = bookId
        ? `${API_URL}/api/books/${bookId}`
        : `${API_URL}/api/books`;

      const method = bookId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to save book');
      }

      const savedBook = await response.json();

      // Update local state with server response to prevent "unsaved changes" after save
      setData(prev => ({
        ...prev,
        ...savedBook,
        // Ensure arrays exist
        characters: savedBook.characters || [],
        locations: savedBook.locations || [],
        plotlines: savedBook.plotlines || [],
        timelines: savedBook.timelines || [],
        chapters: savedBook.chapters || [],
        notes: savedBook.notes || [],
        visuals: savedBook.visuals || [],
        comicPages: savedBook.comicPages || [],
        animationProjects: savedBook.animationProjects || [],
        collaborators: savedBook.collaborators || [],
        // Ensure objects exist
        audioFiles: savedBook.audioFiles || {},
        characterRefs: savedBook.characterRefs || {},
      }));

      // If this was a new book, update the URL with the new ID
      if (!bookId && savedBook.id) {
        window.history.pushState({}, '', `?book=${savedBook.id}`);
        // Trigger a custom event that App.jsx can listen to
        window.dispatchEvent(new CustomEvent('bookCreated', { detail: { bookId: savedBook.id } }));
      }

      return savedBook;
    } catch (err) {
      console.error('Error saving book:', err);
      setError('Failed to save book');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  // Autosave setup
  const autosave = useAutosave(data, saveBook, {
    delay: 30000, // 30 seconds
    enabled: autosaveEnabled && !loading && bookId,
    onSaveStart: () => setSaving(true),
    onSaveSuccess: () => {
      setSaving(false);
      setError(null);
    },
    onSaveError: (err) => {
      setSaving(false);
      setError('Autosave failed');
      console.error('Autosave error:', err);
    },
  });

  return {
    data,
    setData,
    loading,
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
