import { v4 as uuidv4 } from 'uuid';

// Book media jobs: every image, character reference and animation render is a
// server job listed per book, so its progress and result outlive the screen
// that started it. The client's book-level hook polls the list, applies a
// finished result to the book and acknowledges it once the book has saved.
// The server never writes the book for these jobs: that would bump its version
// and turn the user's next save into a 409.
//
// Redis:
//   mjob:<jobId>                    the job (JSON), kept 7 days
//   mjobs:book:<bookId>:<userId>    sorted set of the user's unacknowledged jobs for the book
//
// A job runs in the API process that accepted it. That process is the only
// writer of the job's record (progress, heartbeat, result), so updates never
// race. If it dies mid-job (a deploy), the heartbeat stops and readers report
// the job as interrupted instead of running forever.

const TTL = 7 * 24 * 3600;
const HEARTBEAT_MS = 30000;
const STALE_MS = 3 * 60 * 1000;

const jobKey = (jobId) => `mjob:${jobId}`;
const listKey = (bookId, userId) => `mjobs:book:${bookId}:${userId}`;

/**
 * Start a job. `run(report)` does the work and resolves to the result;
 * report({ message, current, total, scenes }) updates the progress. A thrown
 * error with `.partial` keeps that partial result on the failed job.
 * onNothingProduced runs when the job fails with no partial result (refunds).
 * Returns the job as first stored (status 'running').
 */
export async function startMediaJob({ redis, userId, bookId, type, target, label, run, onNothingProduced }) {
  const now = new Date().toISOString();
  const job = {
    jobId: uuidv4(),
    userId,
    bookId: bookId || null,
    type,
    target: target || null,
    label: label || type,
    status: 'running',
    progress: { message: 'Starting...' },
    result: null,
    error: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  const save = async () => {
    job.updatedAt = new Date().toISOString();
    await redis.set(jobKey(job.jobId), JSON.stringify(job), { EX: TTL });
  };
  await save();
  if (bookId) {
    await redis.zAdd(listKey(bookId, userId), { score: Date.now(), value: job.jobId });
    await redis.expire(listKey(bookId, userId), TTL);
  }

  const heartbeat = setInterval(() => save().catch(() => {}), HEARTBEAT_MS);
  const report = (progress) => {
    job.progress = { ...job.progress, ...progress };
    return save().catch(err => console.error(`media job ${job.jobId} progress write failed:`, err.message));
  };

  (async () => {
    try {
      job.result = await run(report);
      job.status = 'done';
      job.progress = { ...job.progress, message: 'Done' };
    } catch (error) {
      console.error(`media job ${job.jobId} (${type}) failed:`, error.message);
      job.status = 'failed';
      job.error = error.status ? error.message : (error.publicMessage || 'Generation failed');
      job.detail = error.status ? undefined : error.message;
      job.result = error.partial || null;
      if (!error.partial && onNothingProduced) {
        await Promise.resolve(onNothingProduced()).catch(err => console.error('media job refund failed:', err.message));
      }
    } finally {
      clearInterval(heartbeat);
      job.finishedAt = new Date().toISOString();
      await save().catch(err => console.error(`media job ${job.jobId} final write failed:`, err.message));
    }
  })();

  return publicJob(job);
}

function publicJob(job) {
  const { userId, ...rest } = job;
  return rest;
}

// A running job whose process stopped heartbeating (a deploy, a crash) is
// reported as failed, once, and the record is updated so it stays that way.
async function settleStale(redis, job) {
  if (job.status !== 'running' || Date.now() - Date.parse(job.updatedAt) < STALE_MS) return job;
  job.status = 'failed';
  job.error = 'Interrupted (the server restarted); please try again';
  job.finishedAt = new Date().toISOString();
  await redis.set(jobKey(job.jobId), JSON.stringify(job), { EX: TTL });
  return job;
}

export async function getMediaJob(redis, jobId, userId) {
  const raw = await redis.get(jobKey(jobId));
  const job = raw ? JSON.parse(raw) : null;
  if (!job || job.userId !== userId) return null;
  return publicJob(await settleStale(redis, job));
}

export async function listMediaJobs(redis, bookId, userId) {
  const ids = await redis.zRange(listKey(bookId, userId), 0, -1, { REV: true });
  const jobs = [];
  for (const id of ids) {
    const raw = await redis.get(jobKey(id));
    if (!raw) {
      await redis.zRem(listKey(bookId, userId), id); // expired
      continue;
    }
    const job = JSON.parse(raw);
    if (job.userId !== userId) continue;
    jobs.push(publicJob(await settleStale(redis, job)));
  }
  return jobs;
}

export async function ackMediaJob(redis, bookId, userId, jobId) {
  await redis.zRem(listKey(bookId, userId), jobId);
}
