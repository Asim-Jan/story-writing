/**
 * Encryption Utility
 *
 * Provides functions to encrypt and decrypt sensitive data like API keys.
 * Uses AES encryption with a secret key from environment variables.
 */

import CryptoJS from 'crypto-js';

// Get encryption key from environment variables
// Falls back to SESSION_SECRET if ENCRYPTION_KEY is not set
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;

if (!ENCRYPTION_KEY) {
  console.warn('⚠️  WARNING: No ENCRYPTION_KEY or SESSION_SECRET found. Using default key (INSECURE)');
}

/**
 * Encrypt a string value
 * @param {string} value - The plain text value to encrypt
 * @returns {string|null} The encrypted value, or null if input is null/undefined
 */
export function encrypt(value) {
  if (!value) return null;

  try {
    const encrypted = CryptoJS.AES.encrypt(value, ENCRYPTION_KEY).toString();
    return encrypted;
  } catch (error) {
    console.error('Error encrypting value:', error);
    throw new Error('Failed to encrypt value');
  }
}

/**
 * Decrypt an encrypted string value
 * @param {string} encryptedValue - The encrypted value to decrypt
 * @returns {string|null} The decrypted plain text value, or null if input is null/undefined
 */
export function decrypt(encryptedValue) {
  if (!encryptedValue) return null;

  try {
    const bytes = CryptoJS.AES.decrypt(encryptedValue, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      throw new Error('Decryption resulted in empty string');
    }

    return decrypted;
  } catch (error) {
    console.error('Error decrypting value:', error);
    throw new Error('Failed to decrypt value');
  }
}

/**
 * Encrypt an object's sensitive fields
 * @param {Object} obj - The object containing sensitive data
 * @param {string[]} fields - Array of field names to encrypt
 * @returns {Object} New object with specified fields encrypted
 */
export function encryptFields(obj, fields) {
  const encrypted = { ...obj };

  for (const field of fields) {
    if (obj[field]) {
      encrypted[field] = encrypt(obj[field]);
    }
  }

  return encrypted;
}

/**
 * Decrypt an object's encrypted fields
 * @param {Object} obj - The object containing encrypted data
 * @param {string[]} fields - Array of field names to decrypt
 * @returns {Object} New object with specified fields decrypted
 */
export function decryptFields(obj, fields) {
  const decrypted = { ...obj };

  for (const field of fields) {
    if (obj[field]) {
      try {
        decrypted[field] = decrypt(obj[field]);
      } catch (error) {
        console.warn(`Failed to decrypt field "${field}":`, error.message);
        decrypted[field] = null;
      }
    }
  }

  return decrypted;
}
