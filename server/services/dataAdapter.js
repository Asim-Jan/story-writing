/**
 * Data Adapter Service
 *
 * Provides backward-compatible wrapper functions for the application
 * while using the Data Service layer underneath.
 *
 * This adapter allows gradual migration from direct Redis calls to
 * the Data Service layer without changing all application code at once.
 */

import { UserDataService, BookDataService, ChapterDataService } from '../db/dataService.js';
import { createClient } from 'redis';
import { features } from '../config/features.js';

// Redis client for non-migrated data (sessions, jobs, etc.)
let redisClient = null;

/**
 * Initialize Redis client (still needed for sessions, job queue, etc.)
 */
export async function initializeRedis() {
  if (redisClient) return redisClient;

  redisClient = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6380'),
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
  await redisClient.connect();
  console.log('✅ Redis connected (sessions, jobs, rate limiting)');

  return redisClient;
}

/**
 * Get Redis client for non-migrated data
 */
export function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initializeRedis() first.');
  }
  return redisClient;
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Get user by ID
 */
export async function getUser(userId) {
  return await UserDataService.findById(userId);
}

/**
 * Get user by email
 */
export async function getUserByEmail(email) {
  return await UserDataService.findByEmail(email);
}

/**
 * Create user
 */
export async function createUser(userData) {
  return await UserDataService.create(userData);
}

/**
 * Update user
 */
export async function updateUser(userId, updates) {
  return await UserDataService.update(userId, updates);
}

/**
 * Update user settings (AI config, preferences)
 */
export async function updateUserSettings(userId, settings) {
  return await UserDataService.updateSettings(userId, settings);
}

/**
 * Get user settings
 * Returns user with settings and quotas
 */
export async function getUserSettings(userId) {
  return await UserDataService.findById(userId);
}

// ============================================================================
// BOOK OPERATIONS
// ============================================================================

/**
 * Get book by ID
 */
export async function getBook(bookId) {
  return await BookDataService.findById(bookId);
}

/**
 * Get all books for a user
 */
export async function getUserBooks(userId, options = {}) {
  return await BookDataService.findByUser(userId, options);
}

/**
 * Create book
 */
export async function createBook(bookData) {
  return await BookDataService.create(bookData);
}

/**
 * Update book
 * @param {string} bookId - Book ID
 * @param {string} userId - User ID (for authorization)
 * @param {object} updates - Updates to apply
 * @param {number} expectedVersion - Expected version for optimistic locking (optional)
 */
export async function updateBook(bookId, userId, updates, expectedVersion = null) {
  return await BookDataService.update(bookId, userId, updates, expectedVersion);
}

/**
 * Delete book
 */
export async function deleteBook(bookId, userId) {
  return await BookDataService.delete(bookId, userId);
}

/**
 * Check if user has access to book
 */
export async function checkBookAccess(bookId, userId) {
  return await BookDataService.checkAccess(bookId, userId);
}

// ============================================================================
// CHAPTER OPERATIONS
// ============================================================================

/**
 * Get chapters for a book
 */
export async function getBookChapters(bookId) {
  return await ChapterDataService.findByBookId(bookId);
}

/**
 * Create chapter
 */
export async function createChapter(chapterData) {
  return await ChapterDataService.create(chapterData);
}

/**
 * Update chapter
 */
export async function updateChapter(chapterId, updates, expectedVersion = null, userId = null) {
  return await ChapterDataService.update(chapterId, updates, expectedVersion, userId);
}

// ============================================================================
// BACKWARD COMPATIBILITY FUNCTIONS
// ============================================================================

/**
 * For data NOT being migrated (sessions, temporary data, etc.)
 * Use the raw Redis client
 */
export async function getRedisValue(key) {
  const client = getRedisClient();
  return await client.get(key);
}

export async function setRedisValue(key, value, options = {}) {
  const client = getRedisClient();
  return await client.set(key, value, options);
}

export async function delRedisValue(key) {
  const client = getRedisClient();
  return await client.del(key);
}

// ============================================================================
// TEMPORARY: Password Reset (stays in Redis - ephemeral data)
// ============================================================================

export async function setPasswordResetToken(token, userId, expirySeconds = 3600) {
  const client = getRedisClient();
  return await client.set(`password_reset:${token}`, userId, { EX: expirySeconds });
}

export async function getPasswordResetToken(token) {
  const client = getRedisClient();
  return await client.get(`password_reset:${token}`);
}

export async function deletePasswordResetToken(token) {
  const client = getRedisClient();
  return await client.del(`password_reset:${token}`);
}

// ============================================================================
// TEMPORARY: Import tracking (will migrate to PostgreSQL imports table)
// ============================================================================

export async function setImportData(importId, data) {
  const client = getRedisClient();
  return await client.set(`import:${importId}`, JSON.stringify(data));
}

export async function getImportData(importId) {
  const client = getRedisClient();
  const data = await client.get(`import:${importId}`);
  return data ? JSON.parse(data) : null;
}

// ============================================================================
// TEMPORARY: API key storage (will migrate to PostgreSQL api_keys table)
// ============================================================================

export async function setApiKeyData(apiKey, data) {
  const client = getRedisClient();
  return await client.set(`apikey:${apiKey}`, JSON.stringify(data));
}

export async function getApiKeyData(apiKey) {
  const client = getRedisClient();
  const data = await client.get(`apikey:${apiKey}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteApiKeyData(apiKey) {
  const client = getRedisClient();
  return await client.del(`apikey:${apiKey}`);
}

export async function getUserApiKeys(userId) {
  const client = getRedisClient();
  const data = await client.get(`user:${userId}:apikeys`);
  return data ? JSON.parse(data) : [];
}

export async function setUserApiKeys(userId, keys) {
  const client = getRedisClient();
  return await client.set(`user:${userId}:apikeys`, JSON.stringify(keys));
}

// ============================================================================
// TEMPORARY: Stats (ephemeral, can stay in Redis)
// ============================================================================

export async function getStats(key) {
  const client = getRedisClient();
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
}

export async function setStats(key, data) {
  const client = getRedisClient();
  return await client.set(key, JSON.stringify(data));
}

// ============================================================================
// TEMPORARY: RPG data (book-specific metadata, could migrate later)
// ============================================================================

export async function getRPGData(bookId) {
  const client = getRedisClient();
  const data = await client.get(`rpg:${bookId}`);
  return data ? JSON.parse(data) : null;
}

export async function setRPGData(bookId, data) {
  const client = getRedisClient();
  return await client.set(`rpg:${bookId}`, JSON.stringify(data));
}

export async function deleteRPGData(bookId) {
  const client = getRedisClient();
  return await client.del(`rpg:${bookId}`);
}

// ============================================================================
// MIGRATION STATUS
// ============================================================================

export function getMigrationStatus() {
  return {
    phase: features.getMigrationPhase(),
    usePostgres: features.USE_POSTGRES,
    dualWrite: features.DUAL_WRITE,
    readFromPostgres: features.READ_FROM_POSTGRES,
  };
}

export default {
  // Initialization
  initializeRedis,
  getRedisClient,

  // User operations
  getUser,
  getUserByEmail,
  createUser,
  updateUser,
  updateUserSettings,
  getUserSettings,

  // Book operations
  getBook,
  getUserBooks,
  createBook,
  updateBook,
  deleteBook,
  checkBookAccess,

  // Chapter operations
  getBookChapters,
  createChapter,
  updateChapter,

  // Raw Redis (for non-migrated data)
  getRedisValue,
  setRedisValue,
  delRedisValue,

  // Temporary data (staying in Redis)
  setPasswordResetToken,
  getPasswordResetToken,
  deletePasswordResetToken,
  setImportData,
  getImportData,
  setApiKeyData,
  getApiKeyData,
  deleteApiKeyData,
  getUserApiKeys,
  setUserApiKeys,
  getStats,
  setStats,
  getRPGData,
  setRPGData,
  deleteRPGData,

  // Status
  getMigrationStatus,
};
