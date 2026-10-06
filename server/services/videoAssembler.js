import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mediaStorage } from './mediaStorage.js';
import { setMediaBookMapping } from '../utils/mediaMapping.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Video Assembler Service
 * Stitches video scenes together using FFmpeg
 */
export class VideoAssembler {
  constructor(bookId = null) {
    this.tempDir = path.join(__dirname, '..', '..', 'temp-video');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    // Store bookId for media access control
    this.bookId = bookId;
  }

  /**
   * Assemble multiple video clips into final film
   * @param {Array<Object>} scenes - Scene objects with video URLs
   * @param {Object} options - Assembly options
   * @returns {Promise<Object>} Final video info
   */
  async assembleFilm(scenes, options = {}) {
    const {
      title = 'Animation',
      resolution = '1080p',
      transitionType = 'fade', // fade, dissolve, cut
      transitionDuration = 0.5, // seconds
      addTitleCard = true,
      addEndCard = true,
    } = options;

    console.log(`Assembling ${scenes.length} scenes into film...`);

    try {
      // Download scenes from MinIO to temp directory
      const tempFiles = [];
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        if (!scene.storageKey || scene.status !== 'completed') continue;

        const filename = `scene-${String(i + 1).padStart(3, '0')}.mp4`;
        const tempPath = path.join(this.tempDir, filename);

        // Download from MinIO
        const buffer = await mediaStorage.getFile('videos', scene.filename);
        fs.writeFileSync(tempPath, buffer);
        tempFiles.push(tempPath);

        console.log(`Downloaded scene ${i + 1}/${scenes.length}`);
      }

      if (tempFiles.length === 0) {
        throw new Error('No valid scene videos to assemble');
      }

      // Create concat file for FFmpeg
      const concatFile = path.join(this.tempDir, 'concat-list.txt');
      const concatContent = tempFiles.map(file => `file '${file}'`).join('\n');
      fs.writeFileSync(concatFile, concatContent);

      // Output file
      const outputFilename = `film-${Date.now()}.mp4`;
      const outputPath = path.join(this.tempDir, outputFilename);

      // Assemble with FFmpeg
      await new Promise((resolve, reject) => {
        let command = ffmpeg();

        if (transitionType === 'fade') {
          // Use xfade filter for smooth transitions
          command = this.applyFadeTransitions(command, tempFiles, transitionDuration);
        } else {
          // Simple concatenation
          command.input(concatFile)
            .inputOptions(['-f', 'concat', '-safe', '0']);
        }

        command
          .outputOptions([
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart', // Enable streaming
          ])
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            console.log(`Processing: ${progress.percent?.toFixed(1)}% done`);
          })
          .on('end', () => {
            console.log('✓ Video assembly complete');
            resolve();
          })
          .on('error', (err, stdout, stderr) => {
            console.error('FFmpeg error:', err.message);
            console.error('FFmpeg stderr:', stderr);
            reject(err);
          })
          .run();
      });

      // Upload final video to MinIO
      const finalBuffer = fs.readFileSync(outputPath);
      const uploadResult = await mediaStorage.upload('videos', finalBuffer, outputFilename, {
        'x-amz-meta-type': 'final-animation',
        'x-amz-meta-title': title,
        'x-amz-meta-scene-count': String(scenes.length),
        'x-amz-meta-resolution': resolution,
        bookId: this.bookId, // For access control
      }, setMediaBookMapping);

      // Size BEFORE cleanup — the old code deleted the file, then statSync'd
      // it (undefined size / thrown ENOENT depending on timing).
      const size = fs.statSync(outputPath).size;

      // Cleanup temp files
      this.cleanupTempFiles([...tempFiles, concatFile, outputPath]);

      console.log('✓ Final film uploaded to MinIO:', uploadResult.storageKey);

      return {
        success: true,
        videoUrl: `/api/media/videos/${outputFilename}`,
        storageKey: uploadResult.storageKey,
        bucket: uploadResult.bucket,
        filename: outputFilename,
        sceneCount: tempFiles.length,
        size,
      };
    } catch (error) {
      console.error('Video assembly error:', error);
      throw error;
    }
  }

  /**
   * Apply fade transitions between clips
   */
  applyFadeTransitions(command, files, duration) {
    // Complex filter for crossfade - simplified for now
    // Just concat without transitions if complex filtering fails
    const concatFile = path.join(this.tempDir, 'concat-list.txt');
    const concatContent = files.map(file => `file '${file}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);

    return command
      .input(concatFile)
      .inputOptions(['-f', 'concat', '-safe', '0']);
  }

  /**
   * Cleanup temporary files
   */
  cleanupTempFiles(files) {
    files.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (error) {
        console.warn(`Failed to delete temp file ${file}:`, error.message);
      }
    });
  }

  /**
   * Get video metadata using FFmpeg
   * @param {string} filePath - Path to video file
   * @returns {Promise<Object>} Video metadata
   */
  async getVideoMetadata(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });
  }
}
