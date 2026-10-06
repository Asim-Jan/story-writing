import { createClient } from 'redis';
import { saiSpeech, VOICE_MAP } from '../../saiClient.js';
import { mediaStorage } from '../../services/mediaStorage.js';
import { updateJobStatus } from '../queue.js';
import { setMediaBookMapping } from '../../utils/mediaMapping.js';

let redisClient;

async function initRedis() {
  if (redisClient) return redisClient;

  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
  });
  await redisClient.connect();
  return redisClient;
}

function chunkText(text, maxChars = 4000) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        // Sentence itself is too long, split by words
        const words = sentence.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > maxChars) {
            chunks.push(currentChunk.trim());
            currentChunk = word;
          } else {
            currentChunk += ' ' + word;
          }
        }
      }
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export async function processAudioGeneration(job) {
  const { userId, bookId, chapterId, text, voice = 'alloy' } = job.data;

  try {
    await updateJobStatus(job.id, { status: 'active', progress: 10 });

    await initRedis();

    // Friendly voice names map onto the SAI bridge's vibevoice set.
    const selectedVoice = VOICE_MAP[voice] || voice;

    // Check if text needs chunking
    const chunks = text.length > 4000 ? chunkText(text) : [text];

    await updateJobStatus(job.id, {
      status: 'active',
      progress: 20,
      message: `Generating audio in ${chunks.length} chunk(s)...`
    });

    // Generate audio for each chunk
    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      await updateJobStatus(job.id, {
        status: 'active',
        progress: 20 + (i / chunks.length) * 50,
        message: `Generating chunk ${i + 1}/${chunks.length}...`
      });

      const buffer = await saiSpeech({
        text: chunks[i],
        voice: selectedVoice,
      });
      audioBuffers.push(buffer);
    }

    await updateJobStatus(job.id, { status: 'active', progress: 70, message: 'Combining audio chunks...' });

    // Combine all audio buffers
    const buffer = Buffer.concat(audioBuffers);

    // Upload to MinIO with access control mapping (the bridge returns WAV)
    const filename = `chapter-${chapterId}-${Date.now()}.wav`;
    const uploadResult = await mediaStorage.upload('audio', buffer, filename, {
      bookId,
      userId,
      chapterId,
      'x-amz-meta-voice': selectedVoice,
    }, setMediaBookMapping);

    await updateJobStatus(job.id, { status: 'active', progress: 90, message: 'Updating book data...' });

    // Update book data
    const bookData = await redisClient.get(`book:${bookId}`);
    if (bookData) {
      const book = JSON.parse(bookData);
      const chapter = book.chapters?.find(c => c.id === chapterId);
      if (chapter) {
        chapter.audio = uploadResult;
      }
      await redisClient.set(`book:${bookId}`, JSON.stringify(book));
    }

    await updateJobStatus(job.id, {
      status: 'completed',
      progress: 100,
      message: 'Audio generated successfully',
      result: uploadResult,
    });

    return uploadResult;
  } catch (error) {
    console.error('Audio generation job failed:', error);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
