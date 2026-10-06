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
  } = options;

  const [saveStatus, setSaveStatus] = useState('saved'); // 'saving', 'saved', 'error', 'unsaved'
  const [lastSaved, setLastSaved] = useState(null);
  const timeoutRef = useRef(null);
  const previousDataRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const dataString = JSON.stringify(data);

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

    // While a save is in flight, just record the latest state — the in-flight
    // save's completion compares against this and the next change schedules a
    // follow-up. This replaces the old 'saved' branch that absorbed every edit
    // into the baseline (the never-schedules bug) while keeping its intent:
    // server responses merging into state must not mark the book unsaved.
    if (saveStatus === 'saving') {
      previousDataRef.current = dataString;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // NOTE: no re-schedule here — the in-flight save's completion handler
      // compares JSON.stringify(data) against previousDataRef and re-marks.
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
        await saveFunction();

        if (isMountedRef.current) {
          setSaveStatus('saved');
          setLastSaved(new Date());
          // onSaveSuccess may re-baseline (the save merged server-owned fields
          // into state); run it BEFORE the stale-closure baseline write, or
          // its markBaseline is overwritten and autosave loops.
          if (onSaveSuccess) {
            onSaveSuccess(); // may call markBaseline with the merged state
          } else {
            previousDataRef.current = JSON.stringify(data);
          }
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
  }, [data, delay, enabled, saveFunction, onSaveStart, onSaveSuccess, onSaveError, saveStatus]);

  // Manual save function
  const saveNow = async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setSaveStatus('saving');
    if (onSaveStart) onSaveStart();

    try {
      await saveFunction();
      setSaveStatus('saved');
      setLastSaved(new Date());
      if (onSaveSuccess) {
        onSaveSuccess(); // may call markBaseline with the merged state
      } else {
        previousDataRef.current = JSON.stringify(data);
      }
    } catch (error) {
      setSaveStatus('error');
      if (onSaveError) onSaveError(error);
      throw error;
    }
  };

  // The save flow MERGES server-owned fields into the book state (version
  // bumps) — that merge must not itself look like an edit. useBook calls
  // markBaseline(postMergeState) in its onSaveSuccess; without it autosave
  // re-saves the merged version every cycle.

  return {
    saveStatus,
    lastSaved,
    saveNow,
    markBaseline,
    isUnsaved: saveStatus === 'unsaved',
    isSaving: saveStatus === 'saving',
  };
};
