import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { extractJSON } from '../utils/extractJSON.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Video Scene Parser
 * Converts screenplay transcripts into video-ready scenes with optimized prompts
 */
export class VideoSceneParser {
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
   * Parse transcript into video-ready scenes
   * @param {Object} transcript - Transcript object with screenplay text
   * @param {Object} context - Book context (characters, locations)
   * @returns {Promise<Array<Object>>} Array of scene objects
   */
  async parseTranscriptToScenes(transcript, context = {}) {
    const systemPrompt = `You are a professional video director converting a screenplay transcript into video generation prompts.

Analyze the transcript and break it down into individual SCENES optimized for AI video generation (8 seconds each).

For each scene:
1. Create a detailed visual prompt optimized for AI video generation
2. Describe camera angles and movements
3. Identify characters and their actions
4. Specify setting/location
5. Extract dialogue/audio cues
6. Determine scene duration (typically 5-8 seconds)

IMPORTANT: Each scene should be a complete visual moment that can stand alone.

Return ONLY valid JSON array:
[
  {
    "sceneNumber": 1,
    "title": "Brief scene title",
    "visualPrompt": "Detailed visual description optimized for Veo 3 video generation, including camera angle, character actions, setting details, lighting, and atmosphere",
    "cameraDirection": "wide shot | close-up | medium shot | pan left | zoom in | tracking shot",
    "duration": 8,
    "characters": ["Character names from this scene"],
    "location": "Location name",
    "dialogue": "Any spoken dialogue in this scene",
    "audioPrompt": "Background sounds, music cues, sound effects",
    "mood": "Scene mood/tone",
    "action": "Key action or event in this scene"
  }
]

Aim for 10-15 scenes per minute of story content.`;

    const contextInfo = this.buildContextString(context);

    const userPrompt = `Transcript: ${transcript.title}
Duration: ${transcript.estimatedDuration || 'Unknown'}

${contextInfo}

Transcript Content:
${transcript.transcript}

Parse this into video-ready scenes with detailed visual prompts for AI video generation.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: SAI_CHAT_FAST,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 8000,
      });

      const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const scenes = extractJSON(cleaned);

      console.log(`Parsed ${scenes.length} scenes from transcript`);
      return scenes;
    } catch (error) {
      console.error('Scene parsing error:', error);
      throw error;
    }
  }

  /**
   * Build context string from book data
   */
  buildContextString(context) {
    let contextStr = '';

    if (context.characters && context.characters.length > 0) {
      contextStr += '\nCharacters:\n';
      context.characters.forEach(char => {
        contextStr += `- ${char.name}: ${char.role || 'Character'}. `;
        if (char.skinColor || char.hairColor) {
          contextStr += `Appearance: ${char.skinColor} skin, ${char.hairColor} hair, ${char.eyeColor} eyes, ${char.build} build. `;
        }
        if (char.personality) {
          contextStr += `Personality: ${char.personality}`;
        }
        contextStr += '\n';
      });
    }

    if (context.locations && context.locations.length > 0) {
      contextStr += '\nLocations:\n';
      context.locations.forEach(loc => {
        contextStr += `- ${loc.name} (${loc.type}): ${loc.description}\n`;
      });
    }

    return contextStr;
  }

  /**
   * Optimize a scene prompt for specific video AI provider
   * @param {Object} scene - Scene object
   * @param {string} provider - Provider name ('veo3', 'luma', 'runway')
   * @returns {string} Optimized prompt
   */
  optimizePromptForProvider(scene, provider = 'veo3') {
    let prompt = scene.visualPrompt;

    if (provider === 'veo3') {
      // Veo 3 likes: camera directions, realistic physics, cinematic style
      prompt = `${scene.cameraDirection}. ${prompt}. ${scene.mood} atmosphere. Realistic physics and lighting.`;
    } else if (provider === 'luma') {
      // Luma likes: coherent motion, specific actions
      prompt = `${prompt}. Focus on smooth, coherent motion of ${scene.action}.`;
    } else if (provider === 'runway') {
      // Runway likes: style references, artistic direction
      prompt = `Cinematic ${scene.cameraDirection}. ${prompt}. Professional filmmaking style.`;
    }

    return prompt.trim();
  }
}
