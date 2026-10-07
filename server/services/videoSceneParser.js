import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { extractJSON } from '../utils/extractJSON.js';
import dotenv from 'dotenv';
import { saiTextOf } from '../utils/saiText.js';
import { transitionOf } from './videoAssembler.js';

dotenv.config();

// Every scene gets a valid transition: the model's when it is one of ours,
// else the same place is a cut and a new place a dissolve.
export function normaliseTransitions(scenes) {
  if (!Array.isArray(scenes)) return scenes;
  return scenes.map((scene, i) => {
    if (!scene || typeof scene !== 'object') return scene;
    if (i === 0) return { ...scene, transition: 'fade' };
    return { ...scene, transition: transitionOf(scene, scenes[i - 1]) };
  });
}

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

IMPORTANT: the scenes are the SHOTS of one continuous film, edited together. Consecutive shots in the same place must use different shot sizes or angles (wide, medium, close-up, over-the-shoulder, reverse): never the same framing twice in a row, which looks like a jump.

Return ONLY valid JSON array:
[
  {
    "sceneNumber": 1,
    "title": "Brief scene title",
    "visualPrompt": "What the camera sees: the characters by name and what they do, the setting, lighting and atmosphere. Do NOT name an art style (no photorealistic, cartoon, anime, 3D): the film's style is set separately and must stay the same in every scene",
    "cameraDirection": "wide shot | close-up | medium shot | pan left | zoom in | tracking shot",
    "duration": 8,
    "characters": ["Names of the characters in this scene, EXACTLY as written in the Characters list"],
    "location": "Location name",
    "dialogue": "Any spoken dialogue in this scene",
    "audioPrompt": "Background sounds, music cues, sound effects",
    "mood": "Scene mood/tone",
    "action": "Key action or event in this scene",
    "transition": "continue | cut | dissolve | fade"
  }
]

"transition" is how this shot begins after the previous one:
- continue: the previous shot carries on unbroken (same place, same moment, the camera keeps rolling, e.g. a character keeps walking); use it for at most two shots in a row
- cut: the same scene and moment from a new camera angle (the usual choice within a scene)
- dissolve: a short jump in time or a move to another place
- fade: a big jump in time or a new part of the story
Scene 1 is "fade".

Aim for 8-10 scenes per minute of story content.

CONSISTENCY: every scene is drawn from the characters' reference portraits, so
always list who is on screen in "characters" using the exact names from the
Characters list, and keep each character's look as described there. Keep
"location" names identical between scenes that happen in the same place.`;

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

      const responseText = saiTextOf(completion.choices[0]);
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const scenes = extractJSON(cleaned);

      console.log(`Parsed ${scenes.length} scenes from transcript`);
      return normaliseTransitions(scenes);
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
