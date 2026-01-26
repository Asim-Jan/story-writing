import {
  imageQueue,
  audioQueue,
  contentQueue,
  importQueue,
  videoQueue,
  initializeJobTracking,
} from './queue.js';

import { processImageGeneration } from './processors/imageProcessor.js';
import { processAudioGeneration } from './processors/audioProcessor.js';
import { processContentGeneration } from './processors/contentProcessor.js';
import { processImportAnalysis } from './processors/importProcessor.js';
import { processVideoGeneration } from './processors/videoProcessor.js';

// Initialize job tracking
await initializeJobTracking();

// Configure queue processors
const CONCURRENCY = {
  image: 2, // 2 concurrent image generations
  audio: 2, // 2 concurrent audio generations
  content: 1, // 1 at a time for content (expensive)
  import: 2, // 2 concurrent import analyses
  video: 1, // 1 at a time for video (very expensive)
};

// Image generation worker
imageQueue.process(CONCURRENCY.image, async (job) => {
  console.log(`📸 Processing image job ${job.id}`);
  return await processImageGeneration(job);
});

imageQueue.on('completed', (job, result) => {
  console.log(`✅ Image job ${job.id} completed`);
});

imageQueue.on('failed', (job, err) => {
  console.error(`❌ Image job ${job.id} failed:`, err.message);
});

// Audio generation worker
audioQueue.process(CONCURRENCY.audio, async (job) => {
  console.log(`🎵 Processing audio job ${job.id}`);
  return await processAudioGeneration(job);
});

audioQueue.on('completed', (job, result) => {
  console.log(`✅ Audio job ${job.id} completed`);
});

audioQueue.on('failed', (job, err) => {
  console.error(`❌ Audio job ${job.id} failed:`, err.message);
});

// Content generation worker
contentQueue.process(CONCURRENCY.content, async (job) => {
  console.log(`📝 Processing content job ${job.id}`);
  return await processContentGeneration(job);
});

contentQueue.on('completed', (job, result) => {
  console.log(`✅ Content job ${job.id} completed`);
});

contentQueue.on('failed', (job, err) => {
  console.error(`❌ Content job ${job.id} failed:`, err.message);
});

// Import analysis worker
importQueue.process(CONCURRENCY.import, async (job) => {
  console.log(`📚 Processing import job ${job.id}`);
  return await processImportAnalysis(job);
});

importQueue.on('completed', (job, result) => {
  console.log(`✅ Import job ${job.id} completed`);
});

importQueue.on('failed', (job, err) => {
  console.error(`❌ Import job ${job.id} failed:`, err.message);
});

// Video generation worker
videoQueue.process(CONCURRENCY.video, async (job) => {
  console.log(`🎬 Processing video job ${job.id}`);
  return await processVideoGeneration(job);
});

videoQueue.on('completed', (job, result) => {
  console.log(`✅ Video job ${job.id} completed`);
});

videoQueue.on('failed', (job, err) => {
  console.error(`❌ Video job ${job.id} failed:`, err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⏸️  Shutting down job workers gracefully...');
  await Promise.all([
    imageQueue.close(),
    audioQueue.close(),
    contentQueue.close(),
    importQueue.close(),
    videoQueue.close(),
  ]);
  process.exit(0);
});

console.log('🚀 Job workers started');
console.log(`   - Image: ${CONCURRENCY.image} concurrent`);
console.log(`   - Audio: ${CONCURRENCY.audio} concurrent`);
console.log(`   - Content: ${CONCURRENCY.content} concurrent`);
console.log(`   - Import: ${CONCURRENCY.import} concurrent`);
console.log(`   - Video: ${CONCURRENCY.video} concurrent`);
