/**
 * Media URL Resolution Helper
 * Converts storage keys to accessible URLs
 */

/**
 * Get media URL from storage key or legacy URL
 * Backwards compatible with old absolute URLs
 * @param {string|Object} urlOrObject - URL string, storage key, or object with storageKey/imageUrl/audioUrl
 * @param {string} bucketType - Bucket type ('images', 'audio', 'comics')
 * @returns {string} Resolved URL
 */
export function getMediaUrl(urlOrObject, bucketType = 'images') {
  // Handle null/undefined
  if (!urlOrObject) return null;

  // If it's an object with storageKey (new format)
  if (typeof urlOrObject === 'object') {
    if (urlOrObject.storageKey) {
      const filename = urlOrObject.filename || extractFilename(urlOrObject.storageKey);
      // The storageKey's FIRST SEGMENT is the media type the route expects
      // (images/audio/comics/videos — mediaStorage writes `${bucketType}/${filename}`).
      // obj.bucket is a real BUCKET name (story-videos) — using it as the type
      // made every saved audio/film/job file 400. Key wins.
      const type = getBucketFromStorageKey(urlOrObject.storageKey);
      return `/api/media/${type}/${filename}`;
    }

    // Legacy: object with imageUrl or audioUrl
    if (urlOrObject.imageUrl) return normalizeUrl(urlOrObject.imageUrl);
    if (urlOrObject.audioUrl) return normalizeUrl(urlOrObject.audioUrl);
    if (urlOrObject.url) return normalizeUrl(urlOrObject.url);

    return null;
  }

  // If it's a string
  if (typeof urlOrObject === 'string') {
    // A JSON-serialized upload record (job processors write uploadResult into
    // TEXT columns) — parse and treat it as the object it is, else a bare
    // storageKey/URL string.
    if (urlOrObject.startsWith('{') && urlOrObject.includes('storageKey')) {
      try {
        return getMediaUrl(JSON.parse(urlOrObject));
      } catch (e) { /* fall through to the plain-string path */ }
    }
    if (/^(images|audio|comics|videos)\//.test(urlOrObject)) {
      // a bare storageKey — build its media route
      const filename = extractFilename(urlOrObject);
      const type = urlOrObject.split('/')[0];
      return `/api/media/${type}/${filename}`;
    }
    return normalizeUrl(urlOrObject);
  }

  return null;
}

/**
 * Normalize URL to be portable (remove absolute domains)
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeUrl(url) {
  if (!url) return null;

  // Already a relative/proxy URL
  if (url.startsWith('/api/media/')) {
    return url;
  }

  // Convert legacy absolute URLs to proxy URLs
  // e.g., "http://localhost:3002/images/visual-123.png" → "/api/media/images/visual-123.png"
  const match = url.match(/\/(images|audio|comics)\/([^?#]+)/);
  if (match) {
    const [, bucket, filename] = match;
    return `/api/media/${bucket}/${filename}`;
  }

  // If it's already relative, keep it
  if (url.startsWith('/')) {
    return url;
  }

  // If we can't parse it, return as-is (might be external URL)
  return url;
}

/**
 * Extract filename from storage key
 * @param {string} storageKey - Storage key (e.g., "images/visual-123.png")
 * @returns {string} Filename
 */
function extractFilename(storageKey) {
  const parts = storageKey.split('/');
  return parts[parts.length - 1];
}

/**
 * Get bucket type from storage key
 * @param {string} storageKey - Storage key (e.g., "images/visual-123.png")
 * @returns {string} Bucket type
 */
function getBucketFromStorageKey(storageKey) {
  const parts = storageKey.split('/');
  return parts[0]; // First part is bucket type
}

/**
 * Check if URL needs migration (is absolute URL)
 * @param {string} url - URL to check
 * @returns {boolean} True if URL is absolute and needs migration
 */
export function needsMigration(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}
