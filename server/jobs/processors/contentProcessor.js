import { createClient } from 'redis';
import { AIBookOrchestrator } from '../../ai-agent-orchestrator.js';
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

export async function processContentGeneration(job) {
  const { userId, bookId, contentType, itemId, config } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

    await initRedis();

    // Get book data
    const bookData = await redisClient.get(`book:${bookId}`);
    if (!bookData) {
      throw new Error('Book not found');
    }

    const book = JSON.parse(bookData);
    const orchestrator = new AIBookOrchestrator(book);

    let result;

    // Progress callback
    const onProgress = async (progress, message) => {
      await updateJobStatus(job.id, {
        status: 'active',
        progress: Math.min(90, 10 + progress * 0.8),
        message,
      });
    };

    await updateJobStatus(job.id, { status: 'active', progress: 20, message: `Generating ${contentType}...` });

    // Generate content based on type
    switch (contentType) {
      case 'chapter':
        result = await orchestrator.generateChapter(itemId, onProgress);
        break;

      case 'character':
        result = await orchestrator.generateCharacter(config, onProgress);
        break;

      case 'location':
        result = await orchestrator.generateLocation(config, onProgress);
        break;

      case 'plotline':
        result = await orchestrator.generatePlotline(config, onProgress);
        break;

      case 'worldbuilding':
        result = await orchestrator.generateWorldbuilding(config, onProgress);
        break;

      default:
        throw new Error(`Unknown content type: ${contentType}`);
    }

    await updateJobStatus(job.id, { status: 'active', progress: 95, message: 'Saving to book...' });

    // Update book data
    const updatedBookData = await redisClient.get(`book:${bookId}`);
    const updatedBook = JSON.parse(updatedBookData);

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: `${contentType} generated successfully`,
      result,
    });

    return result;
  } catch (error) {
    console.error('Content generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
