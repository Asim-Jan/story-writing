/**
 * Backend password validation utility
 * Enforces strong password requirements for security
 */

const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true
};

const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

/**
 * Validates password against all requirements
 * @param {string} password - The password to validate
 * @returns {Object} - Validation result with isValid and error message
 */
function validatePassword(password) {
  if (!password) {
    return {
      isValid: false,
      error: 'Password is required'
    };
  }

  const failed = [];

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    failed.push(`at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }

  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    failed.push('one uppercase letter');
  }

  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    failed.push('one lowercase letter');
  }

  if (PASSWORD_REQUIREMENTS.requireNumber && !/[0-9]/.test(password)) {
    failed.push('one number');
  }

  if (PASSWORD_REQUIREMENTS.requireSpecialChar) {
    const specialCharRegex = new RegExp(`[${SPECIAL_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
    if (!specialCharRegex.test(password)) {
      failed.push('one special character (!@#$%^&*...)');
    }
  }

  if (failed.length > 0) {
    return {
      isValid: false,
      error: `Password must contain ${failed.join(', ')}`
    };
  }

  return {
    isValid: true,
    error: null
  };
}

module.exports = {
  validatePassword,
  PASSWORD_REQUIREMENTS
};
