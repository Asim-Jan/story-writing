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

    // Skip if data hasn't changed
    const dataString = JSON.stringify(data);
    if (previousDataRef.current === dataString) {
      return;
    }

    // Mark as unsaved
    if (previousDataRef.current !== null) {
      setSaveStatus('unsaved');
    }

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
          previousDataRef.current = dataString;
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
  }, [data, delay, enabled, saveFunction, onSaveStart, onSaveSuccess, onSaveError]);

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
      previousDataRef.current = JSON.stringify(data);
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
