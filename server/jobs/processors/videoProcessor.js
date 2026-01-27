import { createClient } from 'redis';
import { VideoSceneParser } from '../../services/videoSceneParser.js';
import { VideoGenerator } from '../../services/videoGenerator.js';
import { VideoAssembler } from '../../services/videoAssembler.js';
import { updateJobStatus } from '../queue.js';

let redisClient;

async function initRedis() {
  if (redisClient) return redisClient;

  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
  });
  await redisClient.connect();
  return redisClient;
}

export async function processVideoGeneration(job) {
  const { userId, bookId, transcriptId, config } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 5 });

    await initRedis();

    // Get book data
    const bookData = await redisClient.get(`book:${bookId}`);
    if (!bookData) {
      throw new Error('Book not found');
    }

    const book = JSON.parse(bookData);
    const transcript = book.transcripts?.find(t => t.id === transcriptId);
    if (!transcript) {
      throw new Error('Transcript not found');
    }

    // Parse transcript into scenes
    await updateJobStatus(job.id, { status: 'active', progress: 10, message: 'Parsing transcript into scenes...' });

    const parser = new VideoSceneParser();
    const scenes = await parser.parseTranscript(transcript.content, config);

    await updateJobStatus(job.id, {
      status: 'active',
      progress: 20,
      message: `Parsed ${scenes.length} scenes, generating videos...`,
    });

    // Generate videos for each scene (pass bookId for media access control)
    const generator = new VideoGenerator(null, bookId);
    const sceneVideos = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sceneProgress = 20 + (i / scenes.length) * 60; // 20% to 80%

      await updateJobStatus(job.id, {
        status: 'active',
        progress: sceneProgress,
        message: `Generating scene ${i + 1} of ${scenes.length}...`,
      });

      try {
        const videoResult = await generator.generateScene(scene, config);
        sceneVideos.push(videoResult);
      } catch (error) {
        console.error(`Failed to generate scene ${i + 1}:`, error);
        // Continue with other scenes
        sceneVideos.push({ error: error.message, scene: i + 1 });
      }
    }

    // Assemble final video
    await updateJobStatus(job.id, { status: 'active', progress: 85, message: 'Assembling final video...' });

    const assembler = new VideoAssembler(bookId);
    const finalVideo = await assembler.assembleFilm(sceneVideos, {
      bookId,
      transcriptId,
      userId,
    });

    await updateJobStatus(job.id, { status: 'active', progress: 95, message: 'Updating book data...' });

    // Update book data
    const updatedBookData = await redisClient.get(`book:${bookId}`);
    const updatedBook = JSON.parse(updatedBookData);

    if (!updatedBook.animationProjects) {
      updatedBook.animationProjects = [];
    }

    updatedBook.animationProjects.push({
      id: `anim-${Date.now()}`,
      transcriptId,
      video: finalVideo,
      scenes: sceneVideos,
      createdAt: new Date().toISOString(),
    });

    await redisClient.set(`book:${bookId}`, JSON.stringify(updatedBook));

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: 'Video generated successfully',
      result: finalVideo,
    });

    return finalVideo;
  } catch (error) {
    console.error('Video generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
