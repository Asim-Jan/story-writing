import fs from 'fs';

/**
 * Parse TXT file and extract text content
 * @param {string} filePath - Path to TXT file
 * @returns {Promise<string>} Extracted text content
 */
export async function parseTXT(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Clean up text
    const cleanText = content
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return cleanText;
  } catch (error) {
    throw new Error(`TXT parsing error: ${error.message}`);
  }
}
