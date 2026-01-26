import {
  imageQueue,
  audioQueue,
  contentQueue,
  importQueue,
  videoQueue,
  storeJobMetadata,
  getActiveJobCount,
} from './queue.js';

// Max concurrent jobs per user
const MAX_CONCURRENT_JOBS = 10;

/**
 * Queue an image generation job
 */
export async function queueImageGeneration(userId, bookId, imageType, itemId, prompt, context) {
  // Check job limit
  const activeCount = await getActiveJobCount(userId);
  if (activeCount >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Too many active jobs (${activeCount}/${MAX_CONCURRENT_JOBS})`);
  }

  const jobData = {
    userId,
    bookId,
    imageType,
    itemId,
    prompt,
    context,
  };

  const job = await imageQueue.add(jobData);
  await storeJobMetadata(job.id.toString(), userId, bookId, 'image', {
    imageType,
    itemId,
    description: `Generating ${imageType} image`,
  });

  return job.id.toString();
}

/**
 * Queue an audio generation job
 */
export async function queueAudioGeneration(userId, bookId, chapterId, text, voice = 'alloy') {
  const activeCount = await getActiveJobCount(userId);
  if (activeCount >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Too many active jobs (${activeCount}/${MAX_CONCURRENT_JOBS})`);
  }

  const jobData = {
    userId,
    bookId,
    chapterId,
    text,
    voice,
  };

  const job = await audioQueue.add(jobData);
  await storeJobMetadata(job.id.toString(), userId, bookId, 'audio', {
    chapterId,
    description: `Generating audio for chapter`,
  });

  return job.id.toString();
}

/**
 * Queue a content generation job
 */
export async function queueContentGeneration(userId, bookId, contentType, itemId, config) {
  const activeCount = await getActiveJobCount(userId);
  if (activeCount >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Too many active jobs (${activeCount}/${MAX_CONCURRENT_JOBS})`);
  }

  const jobData = {
    userId,
    bookId,
    contentType,
    itemId,
    config,
  };

  const job = await contentQueue.add(jobData);
  await storeJobMetadata(job.id.toString(), userId, bookId, 'content', {
    contentType,
    itemId,
    description: `Generating ${contentType}`,
  });

  return job.id.toString();
}

/**
 * Queue an import analysis job
 */
export async function queueImportAnalysis(userId, bookId, chapterIndex, chapter) {
  const activeCount = await getActiveJobCount(userId);
  if (activeCount >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Too many active jobs (${activeCount}/${MAX_CONCURRENT_JOBS})`);
  }

  const jobData = {
    userId,
    bookId,
    chapterIndex,
    chapter,
  };

  const job = await importQueue.add(jobData);
  await storeJobMetadata(job.id.toString(), userId, bookId, 'import', {
    chapterIndex,
    description: `Analyzing chapter ${chapterIndex + 1}`,
  });

  return job.id.toString();
}

/**
 * Queue a video generation job
 */
export async function queueVideoGeneration(userId, bookId, transcriptId, config) {
  const activeCount = await getActiveJobCount(userId);
  if (activeCount >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Too many active jobs (${activeCount}/${MAX_CONCURRENT_JOBS})`);
  }

  const jobData = {
    userId,
    bookId,
    transcriptId,
    config,
  };

  const job = await videoQueue.add(jobData);
  await storeJobMetadata(job.id.toString(), userId, bookId, 'video', {
    transcriptId,
    description: `Generating animation from transcript`,
  });

  return job.id.toString();
}

/**
 * Check if a user can queue more jobs
 */
export async function canQueueJob(userId) {
  const activeCount = await getActiveJobCount(userId);
  return {
    canQueue: activeCount < MAX_CONCURRENT_JOBS,
    activeCount,
    limit: MAX_CONCURRENT_JOBS,
  };
}
