import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { extractJSON } from '../utils/extractJSON.js';
import dotenv from 'dotenv';
import { saiTextOf } from './utils/saiText.js';

dotenv.config();

/**
 * AI-powered chapter boundary detection
 * Uses AI to intelligently find chapter breaks in unstructured text
 */
export class AIChapterDetector {
  constructor(openaiClient = null) {
    // The pooled SAI gateway client (any passed client is honoured for tests)
    this.openai = openaiClient || getSAIClient();
  }

  getOpenAI() {
    if (!this.openai) {
      throw new Error('OpenAI client not configured. Please provide API key.');
    }
    return this.openai;
  }

  /**
   * Analyze text to find chapter boundaries using AI
   * @param {string} text - Full book text
   * @param {number} sampleSize - Number of lines to analyze at once (default: 200)
   * @returns {Promise<Array<Object>>} Chapter boundaries with positions
   */
  async detectChapterBoundaries(text, sampleSize = 200) {
    const lines = text.split('\n');
    const totalLines = lines.length;

    console.log(`AI Chapter Detection: Analyzing ${totalLines} lines...`);

    // Strategy: Analyze the book in chunks to find potential chapter starts
    const chunkSize = 2000; // Analyze 2000 lines at a time
    const boundaries = [];

    for (let i = 0; i < totalLines; i += chunkSize) {
      const chunk = lines.slice(i, Math.min(i + chunkSize, totalLines));
      const chunkText = chunk.join('\n');

      console.log(`Analyzing lines ${i + 1} to ${i + chunk.length}...`);

      const detectedInChunk = await this.findChaptersInChunk(chunkText, i);
      boundaries.push(...detectedInChunk);
    }

    console.log(`Found ${boundaries.length} potential chapter boundaries`);
    return boundaries;
  }

  /**
   * Find chapter starts within a text chunk
   * @param {string} chunkText - Text chunk to analyze
   * @param {number} lineOffset - Starting line number offset
   * @returns {Promise<Array<Object>>} Chapter boundaries
   */
  async findChaptersInChunk(chunkText, lineOffset) {
    const systemPrompt = `You are analyzing a book text to identify chapter boundaries.

Your task is to find lines that mark the START of a new chapter. Look for:
- Lines like "Chapter 1", "CHAPTER ONE", "Ch. 5", etc.
- Roman numerals that indicate chapters (I, II, III, IV, etc.)
- Special chapter names (Prologue, Epilogue, Introduction, etc.)
- Part/Section markers
- ANY pattern that clearly indicates a new chapter beginning

Be smart about context:
- Ignore chapter mentions in dialogue or regular text
- Focus on lines that are isolated or formatted as headings
- Consider surrounding whitespace and formatting
- A chapter title might appear on the line after the chapter number

Return a JSON array of chapter starts found in this text:
[
  {
    "lineNumber": line number where chapter starts (0-indexed within this chunk),
    "chapterIndicator": "the exact text that indicates the chapter (e.g., 'Chapter 1', 'PROLOGUE')",
    "chapterTitle": "the chapter title if found on next line, or null",
    "confidence": confidence score 0.0-1.0,
    "reasoning": "brief explanation of why this is a chapter start"
  }
]

If no chapters found, return empty array: []`;

    const userPrompt = `Analyze this text excerpt and identify all chapter boundaries:

${chunkText}

Return JSON array of chapter starts.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: SAI_CHAT_FAST,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1, // Low temperature for consistent detection
        max_tokens: 2000,
      });

      const responseText = saiTextOf(completion.choices[0]);
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const detected = extractJSON(cleaned);

      // Adjust line numbers to account for chunk offset
      return detected.map(boundary => ({
        ...boundary,
        lineNumber: boundary.lineNumber + lineOffset,
      }));
    } catch (error) {
      console.error('AI chapter detection error:', error);
      return [];
    }
  }

  /**
   * Extract chapters based on AI-detected boundaries
   * @param {string} text - Full book text
   * @param {Array<Object>} boundaries - Detected chapter boundaries
   * @returns {Array<Object>} Extracted chapters
   */
  extractChaptersFromBoundaries(text, boundaries) {
    if (boundaries.length === 0) {
      return [{
        number: 1,
        title: 'Full Text',
        content: text,
        wordCount: text.split(/\s+/).length,
        confidence: 0.5,
        detectionMethod: 'ai-no-chapters-found',
      }];
    }

    const lines = text.split('\n');
    const chapters = [];

    // Sort boundaries by line number
    const sortedBoundaries = [...boundaries].sort((a, b) => a.lineNumber - b.lineNumber);

    for (let i = 0; i < sortedBoundaries.length; i++) {
      const boundary = sortedBoundaries[i];
      const startLine = boundary.lineNumber;
      const endLine = i < sortedBoundaries.length - 1
        ? sortedBoundaries[i + 1].lineNumber
        : lines.length;

      // Extract chapter content
      const chapterLines = lines.slice(startLine, endLine);
      const content = chapterLines.join('\n').trim();

      chapters.push({
        number: i + 1,
        title: boundary.chapterTitle || boundary.chapterIndicator,
        content,
        wordCount: content.split(/\s+/).length,
        charCount: content.length,
        confidence: boundary.confidence,
        detectionMethod: 'ai',
        metadata: {
          chapterIndicator: boundary.chapterIndicator,
          reasoning: boundary.reasoning,
          startLine,
          endLine,
        },
      });
    }

    return chapters;
  }

  /**
   * Complete AI-powered chapter extraction
   * @param {string} text - Full book text
   * @returns {Promise<Array<Object>>} Extracted chapters
   */
  async extractChapters(text) {
    console.log('Starting AI-powered chapter detection...');

    const boundaries = await this.detectChapterBoundaries(text);

    console.log(`Extracting chapters from ${boundaries.length} boundaries...`);

    const chapters = this.extractChaptersFromBoundaries(text, boundaries);

    console.log(`Extracted ${chapters.length} chapters`);

    return chapters;
  }
}
