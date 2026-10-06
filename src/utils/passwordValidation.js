/**
 * Password validation utility
 * Enforces strong password requirements for security
 */

export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true
};

export const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

/**
 * Validates password against all requirements
 * @param {string} password - The password to validate
 * @returns {Object} - Validation result with isValid and requirements object
 */
export function validatePassword(password) {
  if (!password) {
    return {
      isValid: false,
      requirements: {
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSpecialChar: false
      },
      strength: 0
    };
  }

  const requirements = {
    minLength: password.length >= PASSWORD_REQUIREMENTS.minLength,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: new RegExp(`[${SPECIAL_CHARS.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}]`).test(password)
  };

  const isValid = Object.values(requirements).every(Boolean);

  // Calculate strength (0-100)
  let strength = 0;
  if (requirements.minLength) strength += 20;
  if (requirements.hasUppercase) strength += 20;
  if (requirements.hasLowercase) strength += 20;
  if (requirements.hasNumber) strength += 20;
  if (requirements.hasSpecialChar) strength += 20;

  return {
    isValid,
    requirements,
    strength
  };
}

/**
 * Gets password strength label
 * @param {number} strength - Strength score (0-100)
 * @returns {Object} - Label and color
 */
export function getPasswordStrength(strength) {
  if (strength === 0) {
    return { label: 'No password', color: 'gray' };
  } else if (strength < 40) {
    return { label: 'Very Weak', color: 'red' };
  } else if (strength < 60) {
    return { label: 'Weak', color: 'orange' };
  } else if (strength < 80) {
    return { label: 'Good', color: 'yellow' };
  } else if (strength < 100) {
    return { label: 'Strong', color: 'green' };
  } else {
    return { label: 'Very Strong', color: 'green' };
  }
}

/**
 * Gets validation error message
 * @param {Object} validation - Validation result from validatePassword
 * @returns {string} - Error message
 */
export function getPasswordError(validation) {
  if (validation.isValid) return '';

  const failed = [];
  if (!validation.requirements.minLength) {
    failed.push(`at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }
  if (!validation.requirements.hasUppercase) {
    failed.push('one uppercase letter');
  }
  if (!validation.requirements.hasLowercase) {
    failed.push('one lowercase letter');
  }
  if (!validation.requirements.hasNumber) {
    failed.push('one number');
  }
  if (!validation.requirements.hasSpecialChar) {
    failed.push('one special character');
  }

  return `Password must contain ${failed.join(', ')}`;
}
