/**
 * CSV Export Utility
 * Converts data arrays to CSV format with proper escaping
 */

/**
 * Convert an array of objects to CSV format
 * @param {Array<Object>} data - Array of objects to convert
 * @param {Array<string>} headers - Column headers (object keys to include)
 * @returns {string} CSV formatted string
 */
export function toCSV(data, headers) {
  if (!data || data.length === 0) {
    return headers.join(',') + '\n';
  }

  // Create header row
  const headerRow = headers.join(',');

  // Create data rows
  const dataRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];

      // Handle null/undefined
      if (value === null || value === undefined) {
        return '';
      }

      // Convert to string
      let strValue = String(value);

      // Escape quotes by doubling them
      strValue = strValue.replace(/"/g, '""');

      // Wrap in quotes if contains comma, newline, or quote
      if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
        strValue = `"${strValue}"`;
      }

      return strValue;
    }).join(',');
  });

  return headerRow + '\n' + dataRows.join('\n');
}

/**
 * Set CSV response headers
 * @param {Object} res - Express response object
 * @param {string} filename - Name of the CSV file
 */
export function setCSVHeaders(res, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
}

/**
 * Format date for CSV export
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatDateForCSV(date) {
  if (!date) return '';

  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  return d.toISOString();
}

/**
 * Format boolean for CSV export
 * @param {boolean} value - Boolean value
 * @returns {string} 'Yes' or 'No'
 */
export function formatBooleanForCSV(value) {
  return value ? 'Yes' : 'No';
}

/**
 * Sanitize data for CSV export (remove sensitive fields)
 * @param {Array<Object>} data - Data array
 * @param {Array<string>} sensitiveFields - Fields to remove
 * @returns {Array<Object>} Sanitized data
 */
export function sanitizeForExport(data, sensitiveFields = []) {
  return data.map(row => {
    const sanitized = { ...row };
    sensitiveFields.forEach(field => {
      delete sanitized[field];
    });
    return sanitized;
  });
}
