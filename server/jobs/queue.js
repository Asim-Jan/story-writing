import Queue from 'bull';
import { createClient } from 'redis';

// Redis configuration for Bull
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  password: process.env.REDIS_PASSWORD || undefined,
};

// Create job queues.
// removeOnComplete/removeOnFail: without them completed job keys accumulate in
// Redis forever (and Redis was allkeys-lru until the review — Bull's own keys
// were being EVICTED under memory pressure, which corrupts Bull's accounting;
// the server now runs noeviction, so unbounded accumulation would instead OOM
// Redis — removal on completion is the correct behaviour either way).
const queueOptions = {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: { age: 24 * 3600, count: 500 }, // keep a day / last 500
    removeOnFail: { age: 7 * 24 * 3600 },             // failures kept a week for retry/audit
  },
};
export const imageQueue = new Queue('image-generation', queueOptions);
export const audioQueue = new Queue('audio-generation', queueOptions);
export const contentQueue = new Queue('content-generation', queueOptions);
export const importQueue = new Queue('import-analysis', queueOptions);
export const videoQueue = new Queue('video-generation', queueOptions);

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

// Store job metadata. `data` is the caller's descriptor; `originalData` (when
// provided) is the FULL Bull payload, kept under a reserved key so a retry can
// re-queue the real work — the old code only ever had the descriptor, so
// retries re-queued {} and the "new job" did nothing.
export async function storeJobMetadata(jobId, userId, bookId, type, data, originalData = null) {
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
    ...(originalData ? { jobData: originalData } : {}),
  };

  // the type prefix: Bull ids are per-queue sequences and REPEAT (a Redis
  // flush restarts them at 1), so job:<id> is ambiguous — user B's new
  // audio job 901 would collide with user A's old image job 901.
  await redisClient.set(`job:${type}:${jobId}`, JSON.stringify(metadata), { EX: 86400 }); // 24 hour expiry

  // Add to user's job list — WITH the type prefix (the id alone is
  // ambiguous across queues; see getJobStatus)
  await redisClient.sAdd(`user:${userId}:jobs`, `${type}:${jobId}`);

  return metadata;
}

// Update job status
export async function updateJobStatus(jobId, updates) {
  // processors don't know the queue — scan the known prefixes; write back to
  // the SAME (prefixed) key the job was found under
  const types = ['image', 'audio', 'content', 'import', 'video'];
  let existing = null;
  let statusKey = null;
  for (const t of types) {
    statusKey = `job:${t}:${jobId}`;
    existing = await redisClient.get(statusKey);
    if (existing) break;
  }
  if (!existing) return null;

  const metadata = JSON.parse(existing);
  const updated = {
    ...metadata,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await redisClient.set(statusKey, JSON.stringify(updated), { EX: 86400 });
  return updated;
}

// Get job status. Bull ids are per-queue sequences and REPEAT (a Redis
// flush restarts them at 1), so the unprefixed `job:<id>` key is ambiguous:
// user B's new audio job 1 would read user A's old audio job 1. Scan the
// type prefixes; every CALLER that can passes the type to skip the scan.
export async function getJobStatus(jobId, type = null) {
  const types = type ? [type] : ['image', 'audio', 'content', 'import', 'video'];
  for (const t of types) {
    const data = await redisClient.get(`job:${t}:${jobId}`);
    if (data) return JSON.parse(data);
  }
  // legacy unprefixed keys (jobs stored before the namespace fix)
  const data = await redisClient.get(`job:${jobId}`);
  return data ? JSON.parse(data) : null;
}

// Get user's jobs
export async function getUserJobs(userId, limit = 50) {
  const jobRefs = await redisClient.sMembers(`user:${userId}:jobs`);
  // refs carry their type (type:id) — new entries; bare ids are legacy
  const jobs = await Promise.all(
    jobRefs.slice(0, limit).map(async (ref) => {
      const data = await getJobStatus(ref);
      if (!data) return null;
      // ownership backstop: a stale/duplicate id must never surface
      // another user's job into this list
      return data.userId === userId ? data : null;
    })
  );

  return jobs
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Clean up old jobs. The ids repeat ACROSS types, so cleanup must target the
// job's OWN type — deleting all types for an id killed another user's job
// (the suite caught it). The ref in the user's set carries the type.
export async function cleanupJob(jobRef, userId) {
  const types = ['image', 'audio', 'content', 'import', 'video'];
  // the ref may be 'type:id' (new) or a bare id (legacy) — delete that type's
  // key plus, for safety, the legacy unprefixed one
  const [refType, refId] = refRefSplit(jobRef);
  if (refType) {
    await redisClient.del(`job:${refType}:${refId}`);
  } else {
    for (const t of types) await redisClient.del(`job:${t}:${jobRef}`);
  }
  await redisClient.del(`job:${jobRef}`);
  await redisClient.sRem(`user:${userId}:jobs`, jobRef);
}

function refRefSplit(ref) {
  const idx = ref.indexOf(':');
  if (idx <= 0) return [null, ref];
  return [ref.slice(0, idx), ref.slice(idx + 1)];
}

// Get active job count for user
export async function getActiveJobCount(userId) {
  const jobs = await getUserJobs(userId);
  return jobs.filter(j => j.status === 'active' || j.status === 'queued').length;
}
