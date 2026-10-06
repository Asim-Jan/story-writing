import { saiImage } from '../../saiClient.js';
import { createClient } from 'redis';
import { mediaStorage } from '../../services/mediaStorage.js';
import { updateJobStatus } from '../queue.js';
import { setMediaBookMapping } from '../../utils/mediaMapping.js';

// Redis client for book data
let redisClient;

async function initRedis() {
  if (redisClient) return redisClient;

  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
  });
  // Without a listener, redis v4 re-throws connection errors and a Redis restart kills the worker.
  redisClient.on('error', (err) => console.error('Redis client error:', err.message));
  await redisClient.connect();
  return redisClient;
}

export async function processImageGeneration(job) {
  const { userId, bookId, imageType, itemId, prompt, context } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

    // Initialize Redis
    await initRedis();

    // Build enhanced prompt based on image type
    let enhancedPrompt = prompt;

    if (context) {
      const contextParts = [];
      if (context.genre) contextParts.push(`Genre: ${context.genre}`);
      if (context.tone) contextParts.push(`Tone: ${context.tone}`);
      if (context.setting) contextParts.push(`Setting: ${context.setting}`);

      if (contextParts.length > 0) {
        enhancedPrompt = `${contextParts.join(', ')}\n\n${prompt}`;
      }
    }

    await updateJobStatus(job.id, { status: 'active', progress: 30, message: 'Generating image with AI...' });

    // Generate image via the SAI media bridge
    const { buffer: imageBuffer } = await saiImage({
      prompt: enhancedPrompt,
      model: 'flux2-klein-9b',
      size: '1024x1024',
    });

    await updateJobStatus(job.id, { status: 'active', progress: 70, message: 'Uploading image...' });

    // Upload to MinIO with access control mapping
    const filename = `${imageType}-${itemId || Date.now()}.png`;

    const uploadResult = await mediaStorage.upload('images', imageBuffer, filename, {
      bookId,
      userId,
      imageType,
      itemId,
    }, setMediaBookMapping);

    await updateJobStatus(job.id, { status: 'active', progress: 90, message: 'Updating book data...' });

    // Update book data
    const bookData = await redisClient.get(`book:${bookId}`);
    if (bookData) {
      const book = JSON.parse(bookData);

      // Update the appropriate field based on imageType
      if (imageType === 'cover') {
        book.coverImage = uploadResult;
      } else if (imageType === 'character' && itemId) {
        const character = book.characters?.find(c => c.id === itemId);
        if (character) character.visual = uploadResult;
      } else if (imageType === 'location' && itemId) {
        const location = book.locations?.find(l => l.id === itemId);
        if (location) location.visual = uploadResult;
      } else if (imageType === 'chapter' && itemId) {
        const chapter = book.chapters?.find(c => c.id === itemId);
        if (chapter) chapter.visual = uploadResult;
      }

      await redisClient.set(`book:${bookId}`, JSON.stringify(book));
    }

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: 'Image generated successfully',
      result: uploadResult,
    });

    return uploadResult;
  } catch (error) {
    console.error('Image generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
