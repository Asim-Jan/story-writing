import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * AI Import Analyzer - Analyzes imported book chapters incrementally
 * Extracts characters, locations, plotlines, and other metadata using AI
 */
export class AIImportAnalyzer {
  constructor(redisClient, openaiClient = null) {
    this.redisClient = redisClient;

    // Accept provided OpenAI client (user's key) or fall back to env var for backward compatibility
    if (openaiClient) {
      this.openai = openaiClient;
    } else if (process.env.OPENAI_API_KEY) {
      console.warn('⚠️ AIImportAnalyzer: Using system OpenAI key. Consider passing user API client.');
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } else {
      console.warn('⚠️ OPENAI_API_KEY not set. AI analysis features will not work.');
      this.openai = null;
    }
  }

  getOpenAI() {
    if (!this.openai) {
      throw new Error('OpenAI client not configured. Please provide API key.');
    }
    return this.openai;
  }

  /**
   * Analyze a single chapter and extract metadata
   * @param {Object} chapter - Chapter object with content
   * @param {Object} context - Previous book context (accumulated data)
   * @returns {Promise<Object>} Extracted metadata
   */
  async analyzeChapter(chapter, context = {}) {
    const systemPrompt = `You are analyzing a chapter from an imported book to extract structured metadata.

Extract the following information from the chapter:
1. **Characters mentioned** - List all characters that appear or are mentioned
2. **Locations mentioned** - List all locations, settings, or places
3. **Key events** - Important story events that happen in this chapter
4. **Plot threads** - Active storylines or plot threads in this chapter
5. **Themes** - Themes or motifs present
6. **Relationships** - Character interactions and relationship developments
7. **Timeline markers** - Any time references (dates, durations, sequences)

Context from previous chapters:
${context.characters ? `Known characters: ${context.characters.map(c => c.name).join(', ')}` : 'No characters identified yet'}
${context.locations ? `Known locations: ${context.locations.map(l => l.name).join(', ')}` : 'No locations identified yet'}

Return ONLY valid JSON in this exact format:
{
  "characters": [
    {
      "name": "Character name",
      "description": "Brief appearance/mention description",
      "role": "estimated role (protagonist/antagonist/supporting/minor)",
      "traits": ["notable", "personality", "traits"],
      "firstAppearance": true/false
    }
  ],
  "locations": [
    {
      "name": "Location name",
      "type": "city/building/natural/etc",
      "description": "Brief description",
      "firstAppearance": true/false
    }
  ],
  "events": [
    {
      "description": "What happened",
      "importance": "major/moderate/minor",
      "involvedCharacters": ["character names"],
      "location": "where it happened"
    }
  ],
  "plotThreads": [
    {
      "title": "Plot thread title",
      "description": "What's happening in this thread",
      "status": "introduced/ongoing/resolved"
    }
  ],
  "themes": ["theme1", "theme2"],
  "relationships": [
    {
      "character1": "Name",
      "character2": "Name",
      "type": "friendship/romance/rivalry/family/etc",
      "description": "Nature of interaction"
    }
  ],
  "timelineMarkers": [
    {
      "type": "date/duration/sequence",
      "value": "the time reference",
      "description": "context"
    }
  ],
  "summary": "2-3 sentence summary of the chapter"
}`;

    const userPrompt = `Chapter ${chapter.number}: ${chapter.title}

Content:
${chapter.content}

Extract all relevant metadata from this chapter.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const responseText = completion.choices[0].message.content;
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      console.error(`Chapter analysis error for chapter ${chapter.number}:`, error);
      throw error;
    }
  }

  /**
   * Consolidate character mentions across multiple chapters
   * Identifies duplicates and merges information
   * @param {Array<Object>} chapterAnalyses - Array of chapter analysis results
   * @returns {Promise<Array<Object>>} Consolidated characters
   */
  async consolidateCharacters(chapterAnalyses) {
    const allCharacterMentions = chapterAnalyses.flatMap((analysis, chapterIndex) =>
      (analysis.characters || []).map(char => ({
        ...char,
        chapterNumber: chapterIndex + 1,
      }))
    );

    if (allCharacterMentions.length === 0) {
      return [];
    }

    const systemPrompt = `You are analyzing character mentions from a book to identify unique characters and merge duplicate references.

Different mentions might refer to the same character (e.g., "John", "John Smith", "Mr. Smith", "the detective").

Analyze the character mentions and group them into unique characters. For each unique character, provide:
- A canonical name (most complete form)
- All name variations/aliases
- Consolidated description and traits
- Estimated role
- List of chapters they appear in

Return ONLY valid JSON array:
[
  {
    "name": "Canonical character name",
    "aliases": ["other", "names", "used"],
    "role": "protagonist/antagonist/supporting/minor",
    "description": "Consolidated description",
    "traits": ["personality", "traits"],
    "appearance": "Physical description if mentioned",
    "chapters": [chapter numbers where they appear],
    "firstAppearance": chapter number
  }
]`;

    const userPrompt = `Character mentions from the book:
${JSON.stringify(allCharacterMentions, null, 2)}

Identify unique characters and consolidate the information.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 6000,
      });

      const responseText = completion.choices[0].message.content;
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Character consolidation error:', error);
      throw error;
    }
  }

  /**
   * Consolidate location mentions across multiple chapters
   * @param {Array<Object>} chapterAnalyses - Array of chapter analysis results
   * @returns {Promise<Array<Object>>} Consolidated locations
   */
  async consolidateLocations(chapterAnalyses) {
    const allLocationMentions = chapterAnalyses.flatMap((analysis, chapterIndex) =>
      (analysis.locations || []).map(loc => ({
        ...loc,
        chapterNumber: chapterIndex + 1,
      }))
    );

    if (allLocationMentions.length === 0) {
      return [];
    }

    const systemPrompt = `You are analyzing location mentions from a book to identify unique locations and merge duplicate references.

Different mentions might refer to the same location (e.g., "the city", "New York", "NYC").

Return ONLY valid JSON array:
[
  {
    "name": "Canonical location name",
    "type": "city/building/natural/planet/etc",
    "description": "Consolidated description",
    "significance": "Why this location matters",
    "chapters": [chapter numbers where it appears],
    "firstAppearance": chapter number
  }
]`;

    const userPrompt = `Location mentions from the book:
${JSON.stringify(allLocationMentions, null, 2)}

Identify unique locations and consolidate the information.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      });

      const responseText = completion.choices[0].message.content;
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Location consolidation error:', error);
      throw error;
    }
  }

  /**
   * Build plot threads from chapter analyses
   * @param {Array<Object>} chapterAnalyses - Array of chapter analysis results
   * @returns {Promise<Array<Object>>} Consolidated plot threads
   */
  async consolidatePlotThreads(chapterAnalyses) {
    const allPlotMentions = chapterAnalyses.flatMap((analysis, chapterIndex) =>
      (analysis.plotThreads || []).map(plot => ({
        ...plot,
        chapterNumber: chapterIndex + 1,
      }))
    );

    if (allPlotMentions.length === 0) {
      return [];
    }

    const systemPrompt = `You are analyzing plot threads from a book to identify main plotlines and subplots.

Consolidate related plot thread mentions into coherent storylines.

Return ONLY valid JSON array:
[
  {
    "title": "Plot thread title",
    "type": "main/subplot/backstory",
    "description": "Full description of this storyline",
    "status": "ongoing/resolved/abandoned",
    "chapters": [chapter numbers where this appears],
    "startChapter": chapter number,
    "endChapter": chapter number or null if ongoing
  }
]`;

    const userPrompt = `Plot thread mentions from the book:
${JSON.stringify(allPlotMentions, null, 2)}

Identify and consolidate plot threads.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const responseText = completion.choices[0].message.content;
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Plot thread consolidation error:', error);
      throw error;
    }
  }

  /**
   * Generate comprehensive book overview from analyses
   * @param {Array<Object>} chapterAnalyses - Array of chapter analysis results
   * @param {Object} metadata - Consolidated metadata (characters, locations, etc.)
   * @returns {Promise<string>} Book overview
   */
  async generateOverview(chapterAnalyses, metadata) {
    const systemPrompt = `You are writing a comprehensive book overview based on chapter analyses and extracted metadata.

Write a compelling 3-4 paragraph overview that:
- Introduces the main premise and setting
- Highlights key characters and their roles
- Describes the central conflict or journey
- Mentions major themes

Write in a style appropriate for a book description.`;

    const userPrompt = `Book Information:

Characters: ${metadata.characters.map(c => `${c.name} (${c.role})`).join(', ')}

Locations: ${metadata.locations.map(l => l.name).join(', ')}

Plot Threads: ${metadata.plotThreads.map(p => p.title).join(', ')}

Chapter Summaries:
${chapterAnalyses.map((analysis, idx) => `Chapter ${idx + 1}: ${analysis.summary || 'N/A'}`).join('\n')}

Write a comprehensive book overview.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 800,
      });

      return completion.choices[0].message.content.trim();
    } catch (error) {
      console.error('Overview generation error:', error);
      return 'Overview generation failed.';
    }
  }

  /**
   * Generate timeline events from analyzed chapters
   * @param {Array<Object>} chapters - Chapter objects
   * @param {Array<Object>} chapterAnalyses - Chapter analysis results
   * @returns {Promise<Array<Object>>} Timeline events
   */
  async generateTimelineFromChapters(chapters, chapterAnalyses) {
    const systemPrompt = `You are creating timeline events from chapter content and analysis.

For each chapter, extract key events that should appear on a timeline. Focus on:
- Important plot events
- Character introductions or major character moments
- Location discoveries
- Conflicts and resolutions
- Time progression markers

Return ONLY valid JSON array:
[
  {
    "event": "Brief event description",
    "chapterNumber": chapter number,
    "date": "Time reference (if mentioned) or 'Chapter X'",
    "location": "Location name if relevant",
    "description": "2-3 sentence description",
    "characters": ["Character names involved"],
    "importance": "major/moderate/minor"
  }
]`;

    const userPrompt = `Extract timeline events from these chapters:

${chapters.map((ch, idx) => {
  const analysis = chapterAnalyses[idx];
  return `Chapter ${ch.number}: ${ch.title}
Summary: ${analysis?.summary || 'N/A'}
Events: ${JSON.stringify(analysis?.events || [])}
Timeline Markers: ${JSON.stringify(analysis?.timelineMarkers || [])}
`;
}).join('\n\n')}

Extract all significant timeline events.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const responseText = completion.choices[0].message.content;
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Timeline generation error:', error);
      return [];
    }
  }
}
