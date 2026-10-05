import { getSAIClient, SAI_CHAT, SAI_CHAT_FAST } from './saiClient.js';
import { extractJSON } from './utils/extractJSON.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * AI Agent Orchestrator for Book Generation
 * Coordinates multiple AI generation steps to create a complete book
 */
export class AIBookOrchestrator {
  constructor(redisClient, openaiClient = null) {
    this.redisClient = redisClient;
    // The pooled SAI gateway client (any passed client is honoured for tests)
    this.openai = openaiClient || getSAIClient();
  }

  getOpenAI() {
    if (!this.openai) {
      throw new Error('OpenAI client not configured');
    }
    return this.openai;
  }

  /**
   * Main orchestration function that generates a complete book
   * @param {Object} params - Generation parameters
   * @param {string} params.description - User's story description
   * @param {Object} params.options - Optional configuration
   * @param {Function} params.onProgress - Progress callback
   */
  async generateBook({ description, options = {}, onProgress }) {
    const defaults = {
      numCharacters: 5,
      numLocations: 4,
      numPlotlines: 3,
      numChapters: 10,
      generateImages: true,
      genre: 'fiction',
      targetAudience: 'adults',
    };

    const config = { ...defaults, ...options };
    const bookData = {
      characters: [],
      locations: [],
      plotlines: [],
      chapters: [],
      timelines: [],
      notes: [],
      transcripts: [],
      relationships: [],
      visuals: [],
      audioFiles: {},
      collaborators: []
    };

    try {
      // Phase 1: Planning & Analysis
      await this.reportProgress(onProgress, 'analyzing', 'Analyzing your story idea...');
      const bookPlan = await this.analyzePlan(description, config);
      bookData.bookTitle = bookPlan.title;
      bookData.overview = bookPlan.overview;
      bookData.genre = bookPlan.genre;
      bookData.targetAudience = bookPlan.targetAudience;
      bookData.themes = bookPlan.themes;

      // Phase 2: World Building - Characters
      await this.reportProgress(onProgress, 'characters', `Generating ${config.numCharacters} characters...`);
      const characters = await this.generateCharacters(bookPlan, config.numCharacters);

      // First pass: Create characters with IDs
      const characterMap = new Map();
      bookData.characters = characters.map((char, idx) => {
        const id = Date.now() + idx;
        characterMap.set(char.name, id);
        return {
          id,
          ...char,
          relationships: [] // Will populate in second pass
        };
      });

      // Second pass: Convert relationship character names to IDs
      bookData.characters = bookData.characters.map(char => {
        const originalChar = characters.find(c => c.name === char.name);
        const relationships = (originalChar.relationships || []).map(rel => {
          const targetId = characterMap.get(rel.characterName);
          return targetId ? {
            characterId: targetId,
            type: rel.type,
            description: rel.description
          } : null;
        }).filter(rel => rel !== null);

        return { ...char, relationships };
      });

      // Phase 2: World Building - Locations
      await this.reportProgress(onProgress, 'locations', `Creating ${config.numLocations} locations...`);
      const locations = await this.generateLocations(bookPlan, bookData.characters, config.numLocations);
      bookData.locations = locations.map((loc, idx) => ({ id: Date.now() + 1000 + idx, ...loc }));

      // Phase 2: World Building - Plotlines
      await this.reportProgress(onProgress, 'plotlines', `Developing ${config.numPlotlines} plotlines...`);
      const plotlines = await this.generatePlotlines(bookPlan, bookData, config.numPlotlines);
      bookData.plotlines = plotlines.map((plot, idx) => ({ id: Date.now() + 2000 + idx, ...plot, status: 'planning' }));

      // Phase 3: Structure - Chapter Outlines
      await this.reportProgress(onProgress, 'outlines', `Outlining ${config.numChapters} chapters...`);
      const chapterOutlines = await this.generateChapterOutlines(bookPlan, bookData, config.numChapters);

      // Phase 3: Structure - Relationships
      await this.reportProgress(onProgress, 'relationships', 'Mapping character relationships...');
      const relationships = await this.generateRelationships(bookData.characters);
      bookData.relationships = relationships;

      // Phase 4: Content Generation - Chapters
      await this.reportProgress(onProgress, 'chapters', 'Writing chapter content...');
      const chapters = [];
      for (let i = 0; i < chapterOutlines.length; i++) {
        await this.reportProgress(onProgress, 'chapters', `Writing chapter ${i + 1}/${chapterOutlines.length}...`);
        const chapterContent = await this.generateChapterContent(chapterOutlines[i], bookData, i + 1);
        chapters.push({
          id: Date.now() + 3000 + i,
          number: i + 1,
          ...chapterContent,
        });
      }
      bookData.chapters = chapters;

      // Phase 4: Generate Timeline from chapters
      await this.reportProgress(onProgress, 'timeline', 'Creating story timeline...');
      const timeline = await this.generateTimeline(bookData);
      bookData.timelines = timeline.map((event, idx) => ({ id: Date.now() + 4000 + idx, ...event }));

      // Phase 5: Image Generation (if enabled)
      if (config.generateImages) {
        await this.reportProgress(onProgress, 'images', 'Generating character portraits...');
        // We'll skip actual image generation for now as it's expensive
        // In production, you'd call generateImage for key characters
      }

      // Phase 6: Quality Check
      await this.reportProgress(onProgress, 'quality', 'Running quality checks...');
      const continuityIssues = await this.analyzeContinuity(bookData);
      if (continuityIssues.summary.critical > 0) {
        bookData.notes.push({
          id: Date.now() + 5000,
          title: 'Continuity Issues Detected',
          content: `Found ${continuityIssues.summary.critical} critical issues. Please review in the Continuity tab.`,
          category: 'warning',
        });
      }

      await this.reportProgress(onProgress, 'complete', 'Book generation complete!');

      return {
        success: true,
        bookData,
        continuityReport: continuityIssues,
      };
    } catch (error) {
      console.error('Book generation error:', error);
      throw error;
    }
  }

  async reportProgress(callback, stage, message) {
    if (callback) {
      callback({ stage, message, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Analyze user description and create a book plan
   */
  async analyzePlan(description, config) {
    const systemPrompt = `You are an expert story planner. Analyze the user's story idea and create a comprehensive book plan.

Extract or infer:
- A compelling book title
- Genre and subgenre
- Target audience
- Core themes
- A detailed overview/premise (3-4 sentences)
- Tone and style suggestions

Return ONLY valid JSON in this format:
{
  "title": "Book Title",
  "genre": "Genre",
  "subgenre": "Subgenre",
  "targetAudience": "Target reader demographic",
  "themes": ["theme1", "theme2", "theme3"],
  "overview": "Detailed story overview",
  "tone": "Story tone description",
  "style": "Writing style suggestions"
}`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Story Idea: ${description}\n\nDesired Length: ${config.numChapters} chapters` },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Generate characters for the book
   */
  async generateCharacters(bookPlan, count) {
    const systemPrompt = `You are helping create characters for a story. Based on the book plan, generate ${count} diverse, compelling characters that fit the story world.

Include:
- 1 protagonist
- 1 antagonist (if appropriate for the story)
- ${count - 2} supporting characters with distinct roles

Ensure diversity in backgrounds, personalities, and roles.

Return an ARRAY of ${count} character objects in this exact format:
[
  {
    "name": "Full name",
    "role": "Protagonist|Antagonist|Supporting Character|Mentor|etc",
    "age": "Age or range",
    "gender": "Gender",
    "skinColor": "Skin tone",
    "hairColor": "Hair description",
    "eyeColor": "Eye color",
    "height": "Height",
    "weight": "Weight/build description",
    "build": "Body type",
    "background": "2-3 sentences about their history",
    "personality": "2-3 sentences describing personality",
    "arc": "2-3 sentences outlining character development",
    "motivations": "What drives them",
    "fears": "Their fears and vulnerabilities",
    "quirks": "Unique traits or habits",
    "relationships": [
      {
        "characterName": "Name of another character in this list",
        "type": "Ally|Enemy|Family|Friend|Rival|Mentor|Student|Romantic|etc",
        "description": "Brief description of their relationship"
      }
    ]
  }
]

IMPORTANT: Each character should have relationships with 2-3 other characters from the list. Make sure the character names in relationships match exactly with the names you create.`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Book Plan:\nTitle: ${bookPlan.title}\nGenre: ${bookPlan.genre}\nOverview: ${bookPlan.overview}\nThemes: ${bookPlan.themes.join(', ')}`,
        },
      ],
      temperature: 0.8,
      max_tokens: 4000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Generate locations for the book
   */
  async generateLocations(bookPlan, characters, count) {
    const systemPrompt = `You are helping create locations for a story. Based on the book plan and characters, generate ${count} distinctive locations that serve the story.

Create varied location types (cities, buildings, natural settings, etc.) that make sense for the genre and setting.

Return an ARRAY of ${count} location objects:
[
  {
    "name": "Location name",
    "type": "City|Building|Natural|Planet|etc",
    "description": "3-4 sentences describing the location",
    "significance": "Why this location matters to the story",
    "atmosphere": "The mood and feel of the place",
    "history": "Brief background of the location"
  }
]`;

    const characterNames = characters.map((c) => c.name).join(', ');

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Book: ${bookPlan.title}\nGenre: ${bookPlan.genre}\nOverview: ${bookPlan.overview}\nCharacters: ${characterNames}`,
        },
      ],
      temperature: 0.8,
      max_tokens: 3000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Generate plotlines for the book
   */
  async generatePlotlines(bookPlan, bookData, count) {
    const systemPrompt = `You are helping create plot threads for a story. Generate ${count} interconnected plotlines:
- 1 main plotline
- ${count - 1} subplots that complement and enhance the main story

Return an ARRAY of ${count} plotline objects:
[
  {
    "title": "Plotline title",
    "type": "main|subplot|backstory",
    "description": "3-4 sentences describing the plot thread",
    "themes": "Themes explored",
    "conflicts": "Key conflicts and tensions"
  }
]`;

    const context = `Book: ${bookPlan.title}\nOverview: ${bookPlan.overview}\nCharacters: ${bookData.characters
      .map((c) => `${c.name} (${c.role})`)
      .join(', ')}\nLocations: ${bookData.locations.map((l) => l.name).join(', ')}`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.8,
      max_tokens: 2000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Generate chapter outlines
   */
  async generateChapterOutlines(bookPlan, bookData, numChapters) {
    const systemPrompt = `You are helping outline a ${numChapters}-chapter story. Create a structured outline for all chapters.

Each chapter should:
- Advance the plot
- Develop characters
- Build toward a satisfying conclusion
- Include specific scenes and story beats

Return an ARRAY of ${numChapters} chapter outline objects:
[
  {
    "number": 1,
    "title": "Chapter title",
    "summary": "2-3 sentence summary",
    "scenes": ["Scene 1 description", "Scene 2 description", "Scene 3 description"],
    "characters": ["Character names appearing in this chapter"],
    "locations": ["Locations featured"],
    "plotProgression": "How this chapter advances the main plot"
  }
]`;

    const context = `Book: ${bookPlan.title}\nOverview: ${bookPlan.overview}\n\nCharacters:\n${bookData.characters
      .map((c) => `- ${c.name} (${c.role}): ${c.background}`)
      .join('\n')}\n\nLocations:\n${bookData.locations
      .map((l) => `- ${l.name}: ${l.description}`)
      .join('\n')}\n\nPlotlines:\n${bookData.plotlines.map((p) => `- ${p.title} (${p.type}): ${p.description}`).join('\n')}`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 6000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Generate full chapter content
   */
  async generateChapterContent(outline, bookData, chapterNumber) {
    const systemPrompt = `You are a skilled fiction writer. Write engaging chapter content based on the provided outline and book context.

Write in a style appropriate for the genre. Include:
- Vivid descriptions and sensory details
- Natural, character-appropriate dialogue
- Character development and emotional depth
- Smooth scene transitions
- Compelling narrative tension
- Show, don't tell

IMPORTANT: Write a COMPLETE, FULL-LENGTH chapter of at least 2000-3000 words. This should feel like a real chapter from a published novel, not a summary or excerpt. Include multiple scenes, full dialogue exchanges, and rich descriptive passages.

Return JSON:
{
  "title": "Chapter title",
  "summary": "Brief 2-3 sentence summary",
  "content": "Full chapter text with proper paragraphs and formatting. Use \\n\\n for paragraph breaks. Write at least 2000-3000 words of polished, publication-ready prose."
}`;

    const context = `Book: ${bookData.bookTitle}\nChapter ${chapterNumber}: ${outline.title}\n\nChapter Outline:\nSummary: ${outline.summary}\nScenes: ${outline.scenes.join('; ')}\n\nCharacters in this chapter:\n${outline.characters
      .map((charName) => {
        const char = bookData.characters.find((c) => c.name === charName);
        return char ? `- ${char.name}: ${char.personality}` : `- ${charName}`;
      })
      .join('\n')}\n\nPrevious context: ${chapterNumber > 1 ? `This follows chapter ${chapterNumber - 1}. Build on previous events naturally.` : 'This is the opening chapter. Set the scene and introduce key elements.'}`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.8,
      max_tokens: 16000, // Increased for much longer chapters
      chat_template_kwargs: { enable_thinking: false },
      timeout: 300000, // 5 min — long-form generation
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Generate character relationships
   */
  async generateRelationships(characters) {
    const systemPrompt = `Based on the characters provided, identify and describe key relationships between them.

Return JSON:
{
  "relationships": [
    {
      "character1": "Name",
      "character2": "Name",
      "relationship": "allies|rivals|family|romantic|mentor-student|etc",
      "description": "Brief description of their dynamic"
    }
  ],
  "dynamics": "Overall assessment of character dynamics"
}`;

    const context = `Characters:\n${characters.map((c) => `- ${c.name} (${c.role}): ${c.background} | ${c.personality}`).join('\n')}`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    const result = extractJSON(responseText);
    return result.relationships || [];
  }

  /**
   * Generate timeline from chapters
   */
  async generateTimeline(bookData) {
    const systemPrompt = `Create a scene-based timeline for the story based on the chapters.

Break down into individual scenes (not full chapters). Respond with ONLY the JSON array, no prose before or after. Return an array of timeline events:
[
  {
    "event": "Scene title",
    "sceneType": "action|dialogue|exposition|transition",
    "chapterHint": "Chapter grouping",
    "date": "Time reference",
    "location": "Where this occurs",
    "description": "2-3 sentences about what happens",
    "branch": "main|subplot-A|subplot-B|backstory"
  }
]`;

    const context = `Book: ${bookData.bookTitle}\n\nChapters:\n${bookData.chapters.map((ch) => `Chapter ${ch.number}: ${ch.title}\nSummary: ${ch.summary || ch.content?.slice(0, 300) || '(no summary available)'}\n`).join('\n')}`;

    const completion = await this.getOpenAI().chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      temperature: 0.7,
      max_tokens: 4000,
      chat_template_kwargs: { enable_thinking: false },
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    return extractJSON(responseText);
  }

  /**
   * Analyze continuity
   */
  async analyzeContinuity(bookData) {
    const systemPrompt = `Analyze the story for continuity issues, plot holes, and inconsistencies.

Return JSON:
{
  "summary": {
    "passed": number,
    "warnings": number,
    "critical": number,
    "score": number (0-100)
  },
  "issues": [
    {
      "title": "Issue title",
      "description": "Detailed description",
      "category": "timeline|character|location|plot|style",
      "severity": "critical|warning|info",
      "location": "Where in story",
      "suggestion": "How to fix"
    }
  ]
}`;

    const context = `Book: ${bookData.bookTitle}\n\nCharacters: ${JSON.stringify(bookData.characters, null, 2)}\nLocations: ${JSON.stringify(bookData.locations, null, 2)}\nChapters: ${bookData.chapters.map((ch) => `Chapter ${ch.number}: ${ch.title}\n${ch.summary || '(no summary)'}\n${ch.content?.substring(0, 500) || '(no content yet)'}...`).join('\n\n')}`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: SAI_CHAT_FAST,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 3000,
        chat_template_kwargs: { enable_thinking: false },
      });

      const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
      return extractJSON(responseText);
    } catch (error) {
      console.error('Continuity analysis error:', error);
      return {
        summary: { passed: 0, warnings: 0, critical: 0, score: 100 },
        issues: [],
      };
    }
  }
}
