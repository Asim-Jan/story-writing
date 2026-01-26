import Queue from 'bull';
import { createClient } from 'redis';

// Redis configuration for Bull
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  password: process.env.REDIS_PASSWORD || undefined,
};

// Create job queues
export const imageQueue = new Queue('image-generation', { redis: redisConfig });
export const audioQueue = new Queue('audio-generation', { redis: redisConfig });
export const contentQueue = new Queue('content-generation', { redis: redisConfig });
export const importQueue = new Queue('import-analysis', { redis: redisConfig });
export const videoQueue = new Queue('video-generation', { redis: redisConfig });

// Job status storage (using Redis)
let redisClient;

export async function initializeJobTracking() {
  redisClient = createClient({
    url: `redis://${redisConfig.host}:${redisConfig.port}`,
    password: redisConfig.password,
  });

  redisClient.on('error', (err) => console.error('❌ Job Redis Client Error:', err));
  await redisClient.connect();
  console.log('✅ Job tracking Redis connected');
  return redisClient;
}

// Store job metadata
export async function storeJobMetadata(jobId, userId, bookId, type, data) {
  const metadata = {
    jobId,
    userId,
    bookId,
    type,
    status: 'queued',
    progress: 0,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...data,
  };

  await redisClient.set(`job:${jobId}`, JSON.stringify(metadata), { EX: 86400 }); // 24 hour expiry

  // Add to user's job list
  await redisClient.sAdd(`user:${userId}:jobs`, jobId);

  return metadata;
}

// Update job status
export async function updateJobStatus(jobId, updates) {
  const existing = await redisClient.get(`job:${jobId}`);
  if (!existing) return null;

  const metadata = JSON.parse(existing);
  const updated = {
    ...metadata,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await redisClient.set(`job:${jobId}`, JSON.stringify(updated), { EX: 86400 });
  return updated;
}

// Get job status
export async function getJobStatus(jobId) {
  const data = await redisClient.get(`job:${jobId}`);
  return data ? JSON.parse(data) : null;
}

// Get user's jobs
export async function getUserJobs(userId, limit = 50) {
  const jobIds = await redisClient.sMembers(`user:${userId}:jobs`);
  const jobs = await Promise.all(
    jobIds.slice(0, limit).map(async (id) => {
      const data = await redisClient.get(`job:${id}`);
      return data ? JSON.parse(data) : null;
    })
  );

  return jobs
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Clean up old jobs
export async function cleanupJob(jobId, userId) {
  await redisClient.del(`job:${jobId}`);
  await redisClient.sRem(`user:${userId}:jobs`, jobId);
}

// Get active job count for user
export async function getActiveJobCount(userId) {
  const jobs = await getUserJobs(userId);
  return jobs.filter(j => j.status === 'active' || j.status === 'queued').length;
}
