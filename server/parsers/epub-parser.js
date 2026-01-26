import { createRequire } from 'module';
import { promisify } from 'util';

const require = createRequire(import.meta.url);
const EPub = require('epub');

/**
 * Parse EPUB file and extract text content
 * @param {string} filePath - Path to EPUB file
 * @returns {Promise<string>} Extracted text content
 */
export async function parseEPUB(filePath) {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on('error', (error) => {
      reject(new Error(`EPUB parsing error: ${error.message}`));
    });

    epub.on('end', async () => {
      try {
        const chapters = epub.flow;
        const textParts = [];

        for (const chapter of chapters) {
          try {
            const chapterText = await promisify(epub.getChapter.bind(epub))(chapter.id);

            // Remove HTML tags and decode entities with better formatting
            const cleanText = chapterText
              // Remove style and script tags with their content
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              // Convert common block elements to double newlines
              .replace(/<\/p>/gi, '\n\n')
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/div>/gi, '\n\n')
              .replace(/<\/h[1-6]>/gi, '\n\n')
              .replace(/<\/li>/gi, '\n')
              // Remove all remaining HTML tags
              .replace(/<[^>]+>/g, ' ')
              // Decode HTML entities
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&rsquo;/g, "'")
              .replace(/&lsquo;/g, "'")
              .replace(/&rdquo;/g, '"')
              .replace(/&ldquo;/g, '"')
              .replace(/&mdash;/g, '—')
              .replace(/&ndash;/g, '–')
              // Clean up excessive whitespace
              .replace(/[ \t]+/g, ' ')
              .replace(/\n\s+/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim();

            if (cleanText) {
              textParts.push(cleanText);
            }
          } catch (chapterError) {
            console.warn(`Failed to parse chapter ${chapter.id}:`, chapterError.message);
          }
        }

        resolve(textParts.join('\n\n'));
      } catch (error) {
        reject(new Error(`Failed to extract EPUB content: ${error.message}`));
      }
    });

    epub.parse();
  });
}
