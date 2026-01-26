import { useEffect, useRef } from 'react';

/**
 * Hook to show browser notifications when jobs complete
 */
export function useJobNotifications(jobs) {
  const previousJobsRef = useRef({});

  useEffect(() => {
    // Request notification permission on mount
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!jobs || jobs.length === 0) return;

    jobs.forEach(job => {
      const previousJob = previousJobsRef.current[job.jobId];

      // Job just completed
      if (
        previousJob &&
        previousJob.status !== 'completed' &&
        job.status === 'completed'
      ) {
        showNotification('Job Completed', {
          body: job.message || `${job.type} generation completed successfully`,
          icon: '/favicon.ico',
          tag: job.jobId,
        });
      }

      // Job just failed
      if (
        previousJob &&
        previousJob.status !== 'failed' &&
        job.status === 'failed'
      ) {
        showNotification('Job Failed', {
          body: job.error || `${job.type} generation failed`,
          icon: '/favicon.ico',
          tag: job.jobId,
        });
      }
    });

    // Update previous jobs
    const jobsMap = {};
    jobs.forEach(job => {
      jobsMap[job.jobId] = job;
    });
    previousJobsRef.current = jobsMap;
  }, [jobs]);
}

function showNotification(title, options) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, options);

    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5000);

    // Focus window on click
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}
