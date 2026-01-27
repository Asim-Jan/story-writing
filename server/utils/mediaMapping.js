/**
 * Media-to-Book Mapping Utility
 *
 * Provides functions to create and retrieve media file ownership mappings.
 * Used for access control on media files.
 */

import { createClient } from 'redis';

let redisClient = null;

/**
 * Initialize Redis client for media mapping
 */
async function initRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;

  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
  });

  await redisClient.connect();
  return redisClient;
}

/**
 * Set media-to-book mapping
 * @param {string} bucketType - Type of media (images, audio, videos, comics)
 * @param {string} filename - Media filename
 * @param {string} bookId - Book ID that owns this media
 */
export async function setMediaBookMapping(bucketType, filename, bookId) {
  if (!bookId) return; // Skip if no bookId provided

  try {
    await initRedis();
    const mappingKey = `media:${bucketType}:${filename}`;
    await redisClient.set(mappingKey, bookId);
    // Set expiry to 30 days - cleanup old mappings
    await redisClient.expire(mappingKey, 30 * 24 * 60 * 60);
  } catch (error) {
    console.error('Failed to set media mapping:', error);
    // Non-fatal - don't throw, just log
  }
}

/**
 * Get book ID from media mapping
 * @param {string} bucketType - Type of media (images, audio, videos, comics)
 * @param {string} filename - Media filename
 * @returns {Promise<string|null>} Book ID or null if not found
 */
export async function getMediaBookMapping(bucketType, filename) {
  try {
    await initRedis();
    const mappingKey = `media:${bucketType}:${filename}`;
    return await redisClient.get(mappingKey);
  } catch (error) {
    console.error('Failed to get media mapping:', error);
    return null;
  }
}
