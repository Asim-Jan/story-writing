import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * Parse PDF file and extract text content
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} Extracted text content
 */
export async function parsePDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    // Clean up text
    const cleanText = data.text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return cleanText;
  } catch (error) {
    throw new Error(`PDF parsing error: ${error.message}`);
  }
}
