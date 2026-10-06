import { useEffect, useRef, useState } from 'react';

/**
 * Autosave Hook
 * Automatically saves data after a period of inactivity
 * Includes debouncing to prevent excessive saves
 */
export const useAutosave = (data, saveFunction, options = {}) => {
  const {
    delay = 30000, // 30 seconds default
    enabled = true,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
    // What counts as a change. useBook passes one that ignores server-owned
    // fields (version, timestamps, chapter ids), so merging a save response
    // into state is not mistaken for an edit and re-saved every cycle.
    fingerprint = (value) => JSON.stringify(value),
  } = options;

  const [saveStatus, setSaveStatus] = useState('saved'); // 'saving', 'saved', 'error', 'unsaved'
  const [lastSaved, setLastSaved] = useState(null);
  const timeoutRef = useRef(null);
  const previousDataRef = useRef(null);
  const isMountedRef = useRef(true);
  const latestDataRef = useRef(data);
  latestDataRef.current = data;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const dataString = fingerprint(data);

    // First observation after (re)enable: adopt the current state as the
    // baseline WITHOUT scheduling. The old code's baseline adoption rode on
    // saveStatus being 'saved' — which it is from the very first render — so
    // the hook absorbed every real edit into the baseline and never scheduled
    // a save (autosave was a no-op while displaying "Saved").
    if (previousDataRef.current === null) {
      previousDataRef.current = dataString;
      return;
    }

    // Skip if data hasn't changed
    if (previousDataRef.current === dataString) {
      return;
    }

    // While a save is in flight, wait: when it completes, saveStatus changes,
    // this effect runs again and compares the latest state against what was
    // actually saved, so edits made mid-save are scheduled, not absorbed.
    if (saveStatus === 'saving') {
      return;
    }

    // Mark as unsaved
    setSaveStatus('unsaved');

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout for autosave
    timeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;

      setSaveStatus('saving');
      if (onSaveStart) onSaveStart();

      try {
        const saving = fingerprint(latestDataRef.current);
        await saveFunction();

        if (isMountedRef.current) {
          previousDataRef.current = saving; // the baseline is what was saved
          setSaveStatus('saved');
          setLastSaved(new Date());
          if (onSaveSuccess) onSaveSuccess();
        }
      } catch (error) {
        if (isMountedRef.current) {
          setSaveStatus('error');
          if (onSaveError) onSaveError(error);
        }
      }
    }, delay);

    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, delay, enabled, saveFunction, onSaveStart, onSaveSuccess, onSaveError, saveStatus, fingerprint]);

  // Manual save function
  const saveNow = async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setSaveStatus('saving');
    if (onSaveStart) onSaveStart();

    try {
      const saving = fingerprint(latestDataRef.current);
      await saveFunction();
      previousDataRef.current = saving;
      setSaveStatus('saved');
      setLastSaved(new Date());
      if (onSaveSuccess) onSaveSuccess();
    } catch (error) {
      setSaveStatus('error');
      if (onSaveError) onSaveError(error);
      throw error;
    }
  };

  return {
    saveStatus,
    lastSaved,
    saveNow,
    isUnsaved: saveStatus === 'unsaved',
    isSaving: saveStatus === 'saving',
  };
};
