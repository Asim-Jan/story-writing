import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import EnhanceAllDialog from './EnhanceAllDialog';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { enhanceAllParams, neverEnhanced, openItems } from '../utils/enhanceFromBook';

// "Enhance all from book" for the Characters or Locations list: one background
// job over the ones the author picks. After an import (items marked
// fromImport or found in the book, and never enhanced) it says why it is
// worth a click.

const EnhanceAllBar = ({ noun, kind, items, hasChapterText, label = noun, singular = kind, max = 40, note, waitingHint = '(marked "from book" below)' }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const jobs = jobsFor(noun).filter(j => j.type === 'enhance');
  const running = jobs.some(j => j.status === 'running');
  if (!items.length) return null;
  const imported = items.filter(it => (it.fromImport || it.fromBook) && neverEnhanced(it)).length;
  const waiting = items.filter(it => openItems(it.enhancement) > 0).length;

  const start = async (chosen) => {
    setOpen(false);
    setError(null);
    try {
      await startJob('enhance', { type: noun, id: null }, enhanceAllParams(kind, chosen));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="mb-3" data-testid={`enhance-all-${noun}`}>
      {imported > 0 && !running && (
        <p className="text-xs text-gray-600 mb-2" data-testid="enhance-all-hint">
          {imported} {imported === 1 ? `${singular} has` : `${label} have`} only the basics from the book. Enhancing reads what it says about them.
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!hasChapterText || running}
        title={hasChapterText ? `Read the chapters and suggest what the book says about each of the ${label}` : 'Add or import chapters first'}
        className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="enhance-all-open"
      >
        <BookOpen size={18} className={running ? 'animate-pulse' : ''} />
        {running ? 'Reading the book...' : `Enhance all from book`}
      </button>
      <MediaJobList jobs={jobs} className="mt-2" hint="You can keep working; each one's suggestions appear on it as the run finishes." />
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {waiting > 0 && !running && (
        <p className="mt-2 text-xs text-emerald-800" data-testid="enhance-all-waiting">{waiting} {waiting === 1 ? singular : label} with suggestions to review {waitingHint}.</p>
      )}
      {open && <EnhanceAllDialog noun={label} items={items} max={max} note={note} onStart={start} onCancel={() => setOpen(false)} />}
    </div>
  );
};

export default EnhanceAllBar;
