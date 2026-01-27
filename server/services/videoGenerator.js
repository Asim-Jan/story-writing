import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { mediaStorage } from './mediaStorage.js';
import { setMediaBookMapping } from '../utils/mediaMapping.js';

dotenv.config();

/**
 * AI Video Generator Service
 * Generates video clips using Veo 3 (Google Gemini API)
 */
export class VideoGenerator {
  constructor(genaiClient = null, bookId = null) {
    // Accept provided Gemini client (user's key) or fall back to env var for backward compatibility
    if (genaiClient) {
      this.genai = genaiClient;
    } else if (process.env.GEMINI_API_KEY) {
      console.warn('⚠️ VideoGenerator: Using system Gemini key. Consider passing user API client.');
      this.genai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
    } else {
      console.warn('⚠️ GEMINI_API_KEY not set.');
      this.genai = null;
    }

    // Store bookId for media access control
    this.bookId = bookId;
  }

  getGenAI() {
    if (!this.genai) {
      throw new Error('Gemini client not configured. Please provide API key.');
    }
    return this.genai;
  }

  /**
   * Generate video clip using Veo 3
   * @param {Object} scene - Scene object with visual prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Video result with storage info
   */
  async generateSceneVideo(scene, options = {}) {
    const {
      duration = 8, // Veo 3 supports 5-8 seconds
      aspectRatio = '16:9', // 16:9, 9:16, 1:1
      quality = 'high', // low, medium, high
    } = options;

    console.log(`Generating video for scene ${scene.sceneNumber}: ${scene.title}`);

    try {
      // Build optimized prompt
      const videoPrompt = this.buildVeo3Prompt(scene);

      console.log('Veo 3 prompt:', videoPrompt.substring(0, 200) + '...');

      // Generate video using Veo 3 (async operation)
      let operation;
      try {
        operation = await this.genai.models.generateVideos({
          model: 'veo-3.0-generate-001',
          prompt: videoPrompt,
          generationConfig: {
            videoDuration: duration,
            aspectRatio: aspectRatio,
          },
        });
      } catch (apiError) {
        // Handle API permission errors with helpful messages
        if (apiError.message && apiError.message.includes('403')) {
          const helpfulError = new Error(
            'Google Generative Language API is not enabled. Please enable it at: https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview'
          );
          helpfulError.code = 'API_NOT_ENABLED';
          helpfulError.originalError = apiError;
          throw helpfulError;
        }
        if (apiError.message && apiError.message.includes('PERMISSION_DENIED')) {
          const helpfulError = new Error(
            'API Permission Denied. Please check your Gemini API key has the correct permissions and the Generative Language API is enabled.'
          );
          helpfulError.code = 'PERMISSION_DENIED';
          helpfulError.originalError = apiError;
          throw helpfulError;
        }
        throw apiError;
      }

      // Poll until video generation completes
      console.log('Polling for video generation completion...');
      let pollCount = 0;
      const maxPolls = 60; // Max 10 minutes (60 * 10 seconds)

      while (!operation.done && pollCount < maxPolls) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
        operation = await this.genai.operations.getVideosOperation({
          operation: operation,
        });
        pollCount++;
        console.log(`Poll ${pollCount}: ${operation.done ? 'Complete!' : 'Still generating...'}`);
      }

      if (!operation.done) {
        throw new Error('Video generation timed out after 10 minutes');
      }

      if (!operation.response?.generatedVideos?.[0]?.video) {
        throw new Error('No video in operation response');
      }

      // Download the generated video
      const videoFile = operation.response.generatedVideos[0].video;
      const tempPath = `/tmp/veo-scene-${scene.sceneNumber}-${Date.now()}.mp4`;

      // Get the video URI and download it
      const fs = await import('fs');
      const axios = (await import('axios')).default;

      // The video file object should have a URI or downloadUrl
      const videoUrl = videoFile.uri || videoFile.downloadUrl;

      if (!videoUrl) {
        console.error('Video file object:', JSON.stringify(videoFile, null, 2));
        throw new Error('No video URL found in response');
      }

      console.log(`Downloading video from: ${videoUrl}`);

      // Download video using axios
      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 300000, // 5 minute timeout
      });

      const videoBuffer = Buffer.from(response.data);

      // Write to temp file for debugging
      fs.writeFileSync(tempPath, videoBuffer);
      console.log(`Video downloaded: ${videoBuffer.length} bytes`);

      // Upload to MinIO
      const filename = `scene-${scene.sceneNumber}-${Date.now()}.mp4`;
      const uploadResult = await mediaStorage.upload('videos', videoBuffer, filename, {
        'x-amz-meta-type': 'animation-scene',
        'x-amz-meta-scene-number': String(scene.sceneNumber),
        'x-amz-meta-title': scene.title,
        'x-amz-meta-duration': String(duration),
        bookId: this.bookId, // For access control
      }, setMediaBookMapping);

      // Cleanup temp file
      fs.unlinkSync(tempPath);

      console.log(`✓ Video generated and uploaded: ${uploadResult.storageKey}`);

      return {
        success: true,
        videoUrl: `/api/media/videos/${filename}`,
        storageKey: uploadResult.storageKey,
        bucket: uploadResult.bucket,
        filename,
        duration,
        size: videoBuffer.length,
        provider: 'veo3',
      };
    } catch (error) {
      console.error(`Video generation error for scene ${scene.sceneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Build optimized prompt for Veo 3
   */
  buildVeo3Prompt(scene) {
    let prompt = '';

    // Camera direction
    if (scene.cameraDirection) {
      prompt += `${scene.cameraDirection}. `;
    }

    // Main visual prompt
    prompt += scene.visualPrompt;

    // Add mood/atmosphere
    if (scene.mood) {
      prompt += `. ${scene.mood} atmosphere`;
    }

    // Cinematic instructions
    prompt += '. Cinematic quality, realistic physics, smooth motion, professional lighting.';

    // Audio cues (Veo 3 generates audio natively)
    if (scene.audioPrompt) {
      prompt += ` Audio: ${scene.audioPrompt}`;
    }

    if (scene.dialogue) {
      prompt += `. Dialogue: "${scene.dialogue}"`;
    }

    return prompt;
  }

  /**
   * Generate multiple scenes in batch
   * @param {Array<Object>} scenes - Array of scene objects
   * @param {Function} onProgress - Progress callback
   * @param {Object} options - Generation options
   * @returns {Promise<Array<Object>>} Generated videos
   */
  async generateBatch(scenes, onProgress, options = {}) {
    const results = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      if (onProgress) {
        onProgress({
          stage: 'generating',
          sceneNumber: scene.sceneNumber,
          current: i + 1,
          total: scenes.length,
          message: `Generating scene ${i + 1}/${scenes.length}: ${scene.title}`,
        });
      }

      try {
        const result = await this.generateSceneVideo(scene, options);
        results.push({
          sceneNumber: scene.sceneNumber,
          ...result,
          status: 'completed',
        });

        if (onProgress) {
          onProgress({
            stage: 'scene-complete',
            sceneNumber: scene.sceneNumber,
            current: i + 1,
            total: scenes.length,
            result,
          });
        }

        // Rate limiting delay (Veo 3 may have rate limits)
        if (i < scenes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Failed to generate scene ${scene.sceneNumber}:`, error);

        results.push({
          sceneNumber: scene.sceneNumber,
          status: 'failed',
          error: error.message,
        });

        if (onProgress) {
          onProgress({
            stage: 'scene-failed',
            sceneNumber: scene.sceneNumber,
            current: i + 1,
            total: scenes.length,
            error: error.message,
          });
        }
      }
    }

    return results;
  }
}
