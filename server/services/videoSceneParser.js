import { getSAIClient, SAI_CHAT_FAST } from '../saiClient.js';
import { extractJSON } from '../utils/extractJSON.js';
import dotenv from 'dotenv';
import { saiTextOf } from '../utils/saiText.js';
import { normaliseTransitions } from './filmShots.js';

export { normaliseTransitions };
import { matchLocation } from './filmLocations.js';

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
    const systemPrompt = `You are a film director breaking an animation screenplay into the SHOTS an AI video generator will render, one clip per shot.

Each shot is ONE continuous camera take of 4 to 8 seconds: one place, one moment, one camera move. The video model cannot do montages, quick cuts, split screens, flashback overlays, title cards or on-screen captions: a montage becomes several shots (or one telling shot), and a title card is dropped.

Return ONLY a valid JSON array:
[
  {
    "sceneNumber": 1,
    "title": "Brief shot title",
    "visualPrompt": "Everything the camera sees, written so it stands ALONE (the video model sees nothing else): the place and its key set pieces, time of day, light sources and colour, weather; who is in frame, how they look and what they wear; what they do and how they move. 50 to 90 words. Describe a returning place with the same words each time. Do NOT name an art style (no photorealistic, cartoon, anime, 3D): the film's style is set separately and must stay the same in every shot",
    "cameraDirection": "wide shot | medium shot | close-up | over-the-shoulder | tracking shot | slow push-in | pan left | crane up ...",
    "duration": 6,
    "characters": ["Names of the characters in frame, EXACTLY as written in the Characters list"],
    "location": "The place: EXACTLY a name from the Locations list when the shot is there, else a short name for the place",
    "dialogue": "Words spoken in this shot, if any",
    "audioPrompt": "Background sounds, music cues, sound effects",
    "mood": "Mood/tone",
    "action": "The key action or event",
    "transition": "continue | cut | dissolve | fade"
  }
]

COVERAGE: cover the WHOLE screenplay in order, every scene and story beat, leaving nothing out. Use about one shot per 60 to 80 words of screenplay, and at most 30 shots: for a long screenplay let each shot carry more of the story.

SHOTS: the shots are edited together into one film. Consecutive shots in the same place must use different shot sizes or angles (wide, medium, close-up, over-the-shoulder, reverse), never the same framing twice in a row, which looks like a jump.

"transition" is how this shot begins after the previous one:
- continue: the previous shot carries on unbroken (same place, same moment, the camera keeps rolling, e.g. a character keeps walking); use it for at most two shots in a row
- cut: the same scene and moment from a new camera angle (the usual choice within a scene)
- dissolve: a short jump in time or a move to another place
- fade: a big jump in time or a new part of the story
Shot 1 is "fade".

CONSISTENCY: every shot is drawn from the characters' reference portraits and the locations' pictures, so always list who is on screen in "characters" using the exact names from the Characters list, keep each character's look as described there (and their clothes as the screenplay gives them), and use the exact location names.`;

    const contextInfo = this.buildContextString(context, transcript.transcript);

    const words = String(transcript.transcript || '').split(/\s+/).filter(Boolean).length;
    const userPrompt = `Screenplay: ${transcript.title}
Length: ${words} words (about ${Math.min(30, Math.max(3, Math.round(words / 70)))} shots)

${contextInfo}

Screenplay:
${transcript.transcript}

Break this into shots for AI video generation.`;

    try {
      const completion = await this.getOpenAI().chat.completions.create({
        model: SAI_CHAT_FAST,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 14000,
      });

      const responseText = saiTextOf(completion.choices[0]);
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const scenes = extractJSON(cleaned);

      console.log(`Parsed ${scenes.length} scenes from transcript`);
      // at most 30 shots (one render), the book's own location names
      return normaliseTransitions(scenes.slice(0, 30).map((scene, i) => {
        const place = matchLocation(scene?.location, context.locations);
        return { ...scene, sceneNumber: i + 1, ...(place ? { location: place.name } : {}) };
      }));
    } catch (error) {
      console.error('Scene parsing error:', error);
      throw error;
    }
  }

  /**
   * Build context string from book data
   */
  buildContextString(context, screenplay = '') {
    let contextStr = '';
    const said = String(screenplay || '').toLowerCase();
    const text = (v) => String(v ?? '').trim();
    if (context.characters && context.characters.length > 0) {
      contextStr += '\nCharacters:\n';
      context.characters.forEach(char => {
        // only the fields the book has (this printed "undefined skin, undefined hair")
        const looks = [['age', 'age '], ['gender', ''], ['build', 'build: '], ['skinColor', 'skin: '], ['hairColor', 'hair: '], ['eyeColor', 'eyes: ']]
          .map(([f, label]) => (text(char[f]) ? `${label}${text(char[f])}` : '')).filter(Boolean).join(', ');
        const appearance = [looks, text(char.appearance)].filter(Boolean).join('. ').slice(0, 400);
        contextStr += `- ${char.name}: ${char.role || 'Character'}.${appearance ? ` Looks: ${appearance}.` : ''}\n`;
      });
    }

    if (context.locations && context.locations.length > 0) {
      contextStr += '\nLocations:\n';
      // a big book (60 places): describe the places this screenplay names, list the rest
      const many = context.locations.length > 20;
      context.locations.forEach(loc => {
        const named = said.includes(String(loc.name || '').toLowerCase().replace(/^the\s+/, ''));
        const about = many && !named ? '' : [text(loc.description), text(loc.atmosphere)].filter(Boolean).join(' ').slice(0, 400);
        contextStr += `- ${loc.name}${loc.type ? ` (${loc.type})` : ''}${about ? `: ${about}` : ''}\n`;
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
