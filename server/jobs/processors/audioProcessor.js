import { speakLongText } from '../../utils/speech.js';
import { BookDataService } from '../../db/dataService.js';
import { mediaStorage } from '../../services/mediaStorage.js';
import { updateJobStatus } from '../queue.js';
import { setMediaBookMapping } from '../../utils/mediaMapping.js';

export async function processAudioGeneration(job) {
  const { userId, bookId, chapterId, text, voice = 'alloy' } = job.data;

  try {
    await updateJobStatus(job, { status: 'active', progress: 10 });

    const { buffer, voice: selectedVoice } = await speakLongText(text, {
      voice,
      onChunk: (i, n) => updateJobStatus(job, {
        status: 'active',
        progress: 20 + (i / n) * 60,
        message: `Generating chunk ${i + 1}/${n}...`,
      }),
    });

    // Upload to MinIO with access control mapping (the bridge returns WAV)
    const filename = `chapter-${chapterId}-${Date.now()}.wav`;
    const uploadResult = await mediaStorage.upload('audio', buffer, filename, {
      bookId,
      userId,
      chapterId,
      'x-amz-meta-voice': selectedVoice,
    }, setMediaBookMapping);

    await updateJobStatus(job, { status: 'active', progress: 90, message: 'Updating book data...' });

    // Record on the chapter through the data service (the Redis book:{id}
    // store is empty under PostgreSQL-only mode; audioFiles were never
    // written to Postgres at all).
    try {
      // AudiobookTab reads data.audioFiles[chapterId]. Applied to a fresh read
      // of the book, so edits made while the audio rendered are kept.
      await BookDataService.applyServerWrite(bookId, userId, (book) => ({
        audio_files: { ...(book.audioFiles || {}), [chapterId]: uploadResult },
      }));
    } catch (err) {
      console.error('Audio generated but book update failed:', err.message);
    }

    await updateJobStatus(job, {
      status: 'completed',
      progress: 100,
      message: 'Audio generated successfully',
      result: uploadResult,
    });

    return uploadResult;
  } catch (error) {
    console.error('Audio generation job failed:', error);
    await updateJobStatus(job, {
      status: 'failed',
      error: error.message,
      message: `Failed: ${error.message}`,
    });
    throw error;
  }
}
