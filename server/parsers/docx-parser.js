import mammoth from 'mammoth';

/**
 * Parse DOCX file and extract text content
 * @param {string} filePath - Path to DOCX file
 * @returns {Promise<string>} Extracted text content
 */
export async function parseDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });

    // Clean up text
    const cleanText = result.value
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX parsing warnings:', result.messages);
    }

    return cleanText;
  } catch (error) {
    throw new Error(`DOCX parsing error: ${error.message}`);
  }
}
