/**
 * Chapter Extractor - Pattern-based chapter detection from book text
 */

/**
 * Common chapter heading patterns (ordered by specificity - most specific first)
 */
const CHAPTER_PATTERNS = [
  // Chapter with number: "Chapter 1", "Chapter One", "CHAPTER 1", "Ch. 1"
  /^(?:chapter|ch\.?|chap\.?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)/im,

  // Roman numerals with "Chapter": "Chapter I", "CHAPTER IV"
  /^chapter\s+([IVXLCDM]{1,10})\.?\s*$/im,

  // Part/Section markers: "PART ONE", "Part 1"
  /^(?:part|section|book)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/im,

  // Special chapters (prologue, epilogue, etc.)
  /^(prologue|epilogue|introduction|preface|foreword|afterword|conclusion|interlude)/im,

  // Standalone Roman numerals (2+ characters to reduce false positives)
  /^([IVXLCDM]{2,10})\.?\s*$/m,

  // Numbered sections (only 1-2 digits to reduce false positives)
  /^(\d{1,2})\.?\s*$/m,
];

/**
 * Extract chapters from text using pattern matching
 * @param {string} text - Full book text
 * @param {Object} options - Extraction options
 * @returns {Array<Object>} Array of detected chapters
 */
export function extractChapters(text, options = {}) {
  const {
    minChapterLength = 500, // Minimum characters to consider a valid chapter
    maxChapterLength = 100000, // Maximum characters per chapter
    detectTitle = true, // Try to detect chapter titles
  } = options;

  const chapters = [];
  const lines = text.split('\n');

  let currentChapter = null;
  let chapterCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    // Check if line matches any chapter pattern
    let isChapterStart = false;
    let chapterTitle = null;
    let chapterNumber = null;

    for (const pattern of CHAPTER_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        // Additional validation: line should be relatively short (not a paragraph)
        if (line.length > 150) {
          continue; // Skip if line is too long to be a chapter heading
        }

        isChapterStart = true;
        chapterNumber = match[1] || chapterCount + 1;
        chapterTitle = line;

        // If detectTitle is enabled, check next few lines for a chapter title
        if (detectTitle && i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          // If next line is not empty and reasonable length, it might be a title
          if (nextLine && nextLine.length > 2 && nextLine.length < 150) {
            // Check if next line looks like a title
            // (uppercase start, no sentence-ending punctuation, not starting with common paragraph words)
            const looksLikeTitle = /^[A-Z]/.test(nextLine) &&
                                   !/[.!?]$/.test(nextLine) &&
                                   !/^(The |A |An |In |On |At |By |For |With |Of )/i.test(nextLine);

            if (looksLikeTitle) {
              chapterTitle = nextLine;
              i++; // Skip the title line in next iteration
            }
          }
        }

        break;
      }
    }

    if (isChapterStart) {
      // Save previous chapter if it exists and meets minimum length
      if (currentChapter && currentChapter.content.length >= minChapterLength) {
        chapters.push({
          ...currentChapter,
          content: currentChapter.content.trim(),
          wordCount: currentChapter.content.split(/\s+/).length,
        });
      } else if (currentChapter) {
        console.warn(`Skipping short chapter: ${currentChapter.title} (${currentChapter.content.length} chars)`);
      }

      // Start new chapter
      chapterCount++;
      currentChapter = {
        number: chapterCount,
        detectedNumber: chapterNumber,
        title: chapterTitle || `Chapter ${chapterCount}`,
        content: '',
        startLine: i,
      };
    } else if (currentChapter) {
      // Add line to current chapter content
      currentChapter.content += line + '\n';

      // Check if chapter is getting too long (possible missed chapter break)
      if (currentChapter.content.length > maxChapterLength) {
        console.warn(`Chapter "${currentChapter.title}" exceeds max length. May have missed a chapter break.`);
      }
    } else {
      // Before first chapter - might be frontmatter
      if (chapters.length === 0 && line.length > 0) {
        // Start a "frontmatter" chapter
        if (!currentChapter) {
          currentChapter = {
            number: 0,
            detectedNumber: 0,
            title: 'Frontmatter',
            content: '',
            startLine: i,
            isFrontmatter: true,
          };
        }
        currentChapter.content += line + '\n';
      }
    }
  }

  // Add last chapter
  if (currentChapter && currentChapter.content.length >= minChapterLength) {
    chapters.push({
      ...currentChapter,
      content: currentChapter.content.trim(),
      wordCount: currentChapter.content.split(/\s+/).length,
    });
  }

  return chapters;
}

/**
 * Validate and clean detected chapters
 * @param {Array<Object>} chapters - Detected chapters
 * @returns {Array<Object>} Cleaned chapters
 */
export function validateChapters(chapters) {
  return chapters.map((chapter, index) => ({
    id: `chapter-${index}`,
    number: chapter.number,
    title: chapter.title,
    content: chapter.content,
    wordCount: chapter.wordCount,
    charCount: chapter.content.length,
    isFrontmatter: chapter.isFrontmatter || false,
    confidence: calculateConfidence(chapter, chapters),
  }));
}

/**
 * Calculate confidence score for chapter detection
 * @param {Object} chapter - Chapter object
 * @param {Array<Object>} allChapters - All chapters
 * @returns {number} Confidence score 0-1
 */
function calculateConfidence(chapter, allChapters) {
  let confidence = 0.5; // Base confidence

  // Higher confidence if chapter has reasonable length
  if (chapter.wordCount > 1000 && chapter.wordCount < 15000) {
    confidence += 0.2;
  }

  // Higher confidence if chapter title looks structured
  if (/chapter|ch\.|prologue|epilogue|part/i.test(chapter.title)) {
    confidence += 0.2;
  }

  // Higher confidence if similar length to other chapters
  const avgLength = allChapters.reduce((sum, ch) => sum + ch.wordCount, 0) / allChapters.length;
  const lengthDiff = Math.abs(chapter.wordCount - avgLength) / avgLength;
  if (lengthDiff < 0.5) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Get statistics about detected chapters
 * @param {Array<Object>} chapters - Chapters array
 * @returns {Object} Statistics
 */
export function getChapterStats(chapters) {
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const totalChars = chapters.reduce((sum, ch) => sum + ch.charCount, 0);
  const avgWords = totalWords / chapters.length;
  const avgChars = totalChars / chapters.length;

  return {
    totalChapters: chapters.length,
    totalWords,
    totalChars,
    avgWordsPerChapter: Math.round(avgWords),
    avgCharsPerChapter: Math.round(avgChars),
    shortestChapter: Math.min(...chapters.map(ch => ch.wordCount)),
    longestChapter: Math.max(...chapters.map(ch => ch.wordCount)),
    avgConfidence: chapters.reduce((sum, ch) => sum + (ch.confidence || 0), 0) / chapters.length,
  };
}
