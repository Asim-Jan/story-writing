import { useState, useEffect } from 'react';

/**
 * Custom hook to detect media queries
 * @param {string} query - Media query string (e.g., '(min-width: 1024px)')
 * @returns {boolean} - True if the media query matches
 */
export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);

    // Set initial value
    setMatches(media.matches);

    // Create event listener
    const listener = (e) => setMatches(e.matches);

    // Modern browsers
    if (media.addEventListener) {
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
    // Fallback for older browsers
    else {
      media.addListener(listener);
      return () => media.removeListener(listener);
    }
  }, [query]);

  return matches;
};

/**
 * Hook to detect if viewport is mobile-sized (below lg breakpoint: 1024px)
 * @returns {boolean} - True if viewport is mobile-sized
 */
export const useIsMobile = () => {
  return !useMediaQuery('(min-width: 1024px)');
};

export default useMediaQuery;
