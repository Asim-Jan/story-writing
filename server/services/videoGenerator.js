import { saiVideoStart, saiVideoStatus } from '../saiClient.js';
import dotenv from 'dotenv';
import { mediaStorage } from './mediaStorage.js';
import { setMediaBookMapping } from '../utils/mediaMapping.js';

dotenv.config();

/**
 * AI Video Generator Service
 * Generates video clips through the SAI media bridge (async job + poll).
 */
export class VideoGenerator {
  constructor(_unusedClient = null, bookId = null) {
    // Kept for call-site stability; the bridge needs no client object.
    this.bookId = bookId;
  }

  /**
   * Generate video clip via the SAI media bridge
   * @param {Object} scene - Scene object with visual prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Video result with storage info
   */
  async generateSceneVideo(scene, options = {}) {
    // The scene's own length when the parser gave one. The bridge renders 1-10 s
    // (H3 is happiest around 4-6 s); it rejected nothing above 10, it just
    // capped silently, so the stored duration was wrong.
    const duration = Math.min(10, Math.max(1, Math.round(Number(scene.duration ?? options.duration ?? 5)) || 5));

    console.log(`Generating video for scene ${scene.sceneNumber}: ${scene.title}`);

    try {
      // Build optimized prompt
      const videoPrompt = this.buildVeo3Prompt(scene);

      console.log('Video prompt:', videoPrompt.substring(0, 200) + '...');

      // Start the render (async job on the bridge)
      const { jobId } = await saiVideoStart({
        prompt: videoPrompt,
        model: 'minimax-h3-fp8',
        seconds: duration,
      });

      // Poll until the job completes
      console.log('Polling for video generation completion...');
      let pollCount = 0;
      const maxPolls = 90; // Max 15 minutes (90 * 10 seconds)

      while (pollCount < maxPolls) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
        const state = await saiVideoStatus(jobId);
        pollCount++;
        console.log(`Poll ${pollCount}: ${state.status}`);
        if (state.status === 'done') {
          var videoUrl = state.url;
          break;
        }
        if (state.status === 'failed') {
          throw new Error('Video generation failed on the media bridge');
        }
      }

      if (!videoUrl) {
        throw new Error('Video generation timed out after 15 minutes');
      }

      // Download the generated video
      const fs = await import('fs');
      const axios = (await import('axios')).default;

      console.log(`Downloading video from: ${videoUrl}`);

      // Download video using axios
      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 300000, // 5 minute timeout
      });

      const videoBuffer = Buffer.from(response.data);

      // Write to temp file for debugging
      const tempPath = `/tmp/scene-${scene.sceneNumber}-${Date.now()}.mp4`;
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
        provider: 'sai-h3',
        jobId,
      };
    } catch (error) {
      console.error(`Video generation error for scene ${scene.sceneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Build optimized prompt for the video model
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
