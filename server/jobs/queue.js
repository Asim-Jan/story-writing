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

// Job references. Bull ids are per-queue sequences, so the same number exists
// in every queue (and restarts at 1 after a Redis flush): a bare id is
// ambiguous, and keying status by it let one user's audio job overwrite and
// read another user's image job. Every job is therefore addressed by its REF,
// "<type>:<bullId>" (e.g. "audio:901"): the Redis key, the user's job set, the
// API's jobId and the client's polling all use the same string.
const JOB_TYPES = ['image', 'audio', 'content', 'import', 'video'];
const TYPE_BY_QUEUE = {
  'image-generation': 'image',
  'audio-generation': 'audio',
  'content-generation': 'content',
  'import-analysis': 'import',
  'video-generation': 'video',
};

export function jobRef(type, bullId) {
  return `${type}:${bullId}`;
}

// A ref is "<known type>:<id>"; anything else (legacy bare ids) is not addressable.
function parseRef(ref) {
  const m = /^([a-z]+):(.+)$/.exec(String(ref || ''));
  return m && JOB_TYPES.includes(m[1]) ? `${m[1]}:${m[2]}` : null;
}

// Processors hold the Bull job; its queue name says which type it is.
function refOf(jobOrRef) {
  if (jobOrRef && typeof jobOrRef === 'object') {
    const type = TYPE_BY_QUEUE[jobOrRef.queue?.name];
    return type ? jobRef(type, jobOrRef.id) : null;
  }
  return parseRef(jobOrRef);
}

// Store job metadata. `data` is the caller's descriptor; `originalData` (when
// provided) is the FULL Bull payload, kept under a reserved key so a retry can
// re-queue the real work. Returns the job's ref.
export async function storeJobMetadata(bullId, userId, bookId, type, data, originalData = null) {
  const ref = jobRef(type, bullId);
  const metadata = {
    ...data,
    ...(originalData ? { jobData: originalData } : {}),
    jobId: ref,
    bullJobId: String(bullId),
    userId,
    bookId,
    type,
    status: 'queued',
    progress: 0,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await redisClient.set(`job:${ref}`, JSON.stringify(metadata), { EX: 86400 }); // 24 hour expiry
  await redisClient.sAdd(`user:${userId}:jobs`, ref);
  return ref;
}

// Update job status. Takes the Bull job (processors) or a ref.
export async function updateJobStatus(jobOrRef, updates) {
  const ref = refOf(jobOrRef);
  if (!ref) return null;
  const existing = await redisClient.get(`job:${ref}`);
  if (!existing) return null;

  const metadata = JSON.parse(existing);
  const updated = {
    ...metadata,
    ...updates,
    // identity fields are not updatable
    jobId: metadata.jobId,
    userId: metadata.userId,
    bookId: metadata.bookId,
    type: metadata.type,
    updatedAt: new Date().toISOString(),
  };

  await redisClient.set(`job:${ref}`, JSON.stringify(updated), { KEEPTTL: true });
  return updated;
}

// Get job status by ref. Legacy bare ids (stored before refs) resolve to nothing.
export async function getJobStatus(ref) {
  const key = parseRef(ref);
  if (!key) return null;
  const data = await redisClient.get(`job:${key}`);
  return data ? JSON.parse(data) : null;
}

// Get user's jobs
export async function getUserJobs(userId, limit = 50) {
  const refs = await redisClient.sMembers(`user:${userId}:jobs`);
  const jobs = await Promise.all(
    refs.slice(0, limit).map(async (ref) => {
      const data = await getJobStatus(ref);
      if (!data) {
        // expired or legacy entry: drop it from the set
        await redisClient.sRem(`user:${userId}:jobs`, ref);
        return null;
      }
      return data.userId === userId ? data : null;
    })
  );

  return jobs
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Clean up one job: its own key and its entry in the user's set, nothing else.
export async function cleanupJob(ref, userId) {
  const key = parseRef(ref);
  if (!key) return;
  await redisClient.del(`job:${key}`);
  await redisClient.sRem(`user:${userId}:jobs`, key);
}

// Get active job count for user
export async function getActiveJobCount(userId) {
  const jobs = await getUserJobs(userId);
  return jobs.filter(j => j.status === 'active' || j.status === 'queued').length;
}
