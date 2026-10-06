import { VideoSceneParser } from '../../services/videoSceneParser.js';
import { VideoGenerator } from '../../services/videoGenerator.js';
import { VideoAssembler } from '../../services/videoAssembler.js';
import { updateJobStatus } from '../queue.js';
import { BookDataService } from '../../db/dataService.js';

export async function processVideoGeneration(job) {
  const { userId, bookId, transcriptId, config } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 5 });

    // Load through the data service (Redis book:{id} is empty in PG-only mode)
    const book = await BookDataService.findById(bookId);
    if (!book) {
      throw new Error('Book not found');
    }
    // transcripts now persist on the book row (books.transcripts JSONB);
    // accept both shapes (id as string or number)
    const transcript = (book.transcripts || []).find(t => String(t.id) === String(transcriptId));
    if (!transcript) {
      throw new Error('Transcript not found');
    }

    // Parse transcript into scenes
    await updateJobStatus(job.id, { status: 'active', progress: 10, message: 'Parsing transcript into scenes...' });

    const parser = new VideoSceneParser();
    // the real method name (parseTranscript doesn't exist — the job crashed here)
    const scenes = await parser.parseTranscriptToScenes(transcript.content, config);

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
        // the real method name (generateScene doesn't exist)
        const videoResult = await generator.generateSceneVideo(scene, config);
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

    // Persist through the data service (the Redis write was landing in an
    // empty store — animation projects never survived a reload)
    const updatedBook = await BookDataService.findById(bookId);
    const projects = updatedBook.animationProjects || [];
    projects.push({
      id: `anim-${Date.now()}`,
      transcriptId,
      video: finalVideo,
      scenes: sceneVideos,
      createdAt: new Date().toISOString(),
    });
    await BookDataService.update(bookId, job.data.userId, { animation_projects: projects }, updatedBook.version);

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
