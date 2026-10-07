import React, { createContext, useContext, useEffect, useState } from 'react';
import { Loader, AlertCircle, X } from 'lucide-react';

// The book's media jobs (useMediaJobs, created once in FictionWritingStudio).
// Components read running and failed generations from here, never from their
// own state, so the state survives switching character or tab.

const noJobs = {
  jobs: [],
  runningCount: 0,
  jobsFor: () => [],
  startJob: async () => { throw new Error('Open a saved book to generate media'); },
  dismiss: () => {},
  refresh: () => {},
};

const MediaJobsContext = createContext(noJobs);

export const MediaJobsProvider = ({ value, children }) => (
  <MediaJobsContext.Provider value={value || noJobs}>{children}</MediaJobsContext.Provider>
);

export const useMediaJobsContext = () => useContext(MediaJobsContext);

const secondsSince = (iso) => {
  const started = Date.parse(iso);
  return Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0;
};

// Elapsed seconds since the job's server-side start: correct after leaving
// and coming back, or after a reload, unlike a timer started on click.
export const useElapsed = (startedAt) => {
  const [elapsed, setElapsed] = useState(() => (startedAt ? secondsSince(startedAt) : 0));
  useEffect(() => {
    if (!startedAt) return undefined;
    setElapsed(secondsSince(startedAt));
    const timer = setInterval(() => setElapsed(secondsSince(startedAt)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return elapsed;
};

export const formatElapsed = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

export const jobErrorText = (job) => {
  const base = job.detail ? `${job.error || 'Generation failed'}: ${job.detail}` : (job.error || 'Generation failed');
  if (job.result?.portrait) return `${base} (the base portrait was kept)`;
  if (job.type === 'analysis' && job.result) return `${base} (what it found so far was kept)`;
  return base;
};

// One job's state: a running line (elapsed + the server's progress message),
// or a failed job's error with Dismiss (which acknowledges it).
export const MediaJobStatus = ({ job, hint, compact = false, className = '' }) => {
  const { dismiss } = useMediaJobsContext();
  const elapsed = useElapsed(job?.status === 'running' ? job.startedAt : null);
  if (!job) return null;

  if (job.status === 'running') {
    const message = job.progress?.message;
    return (
      <p className={`text-sm text-[var(--dim)] mono ${className}`} role="status" data-testid="media-job-running" data-job-id={job.jobId}>
        <Loader size={12} className="inline-block animate-spin mr-1 align-[-1px]" />
        {compact ? 'Generating' : (job.label || 'Generating')}: <span data-testid="media-job-elapsed">{formatElapsed(elapsed)}</span> elapsed
        {message ? <> &middot; {message}</> : null}
        {hint ? <span className="block text-xs text-[var(--dim2)] mt-1 normal-case">{hint}</span> : null}
      </p>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className={`border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 flex items-start gap-2 ${className}`} role="alert" data-testid="media-job-failed" data-job-id={job.jobId}>
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span className="flex-1 break-words">{compact ? '' : `${job.label || 'Generation'}: `}{jobErrorText(job)}</span>
        <button type="button" onClick={() => dismiss(job.jobId)} className="btn ghost sm flex-shrink-0" title="Dismiss" data-testid="media-job-dismiss">
          <X size={12} />
          Dismiss
        </button>
      </div>
    );
  }

  return null;
};

// Several jobs, newest first.
export const MediaJobList = ({ jobs, hint, compact, className = '' }) => {
  if (!jobs?.length) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {jobs.map(job => <MediaJobStatus key={job.jobId} job={job} hint={hint} compact={compact} />)}
    </div>
  );
};

export default MediaJobsContext;
