import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import EnhanceAllDialog from './EnhanceAllDialog';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { enhanceAllParams, neverEnhanced, openItems, resolveEnhancement } from '../utils/enhanceFromBook';

// "Enhance all from book" for the Characters or Locations list: one background
// job over the ones the author picks. After an import (items marked
// fromImport or found in the book, and never enhanced) it says why it is
// worth a click.

const EnhanceAllBar = ({ noun, kind, items, setData, hasChapterText, label = noun, singular = kind, max = 40, note, waitingHint = '(marked "from book" below)' }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [bulk, setBulk] = useState(null); // 'use' | 'skip' awaiting a second click
  const jobs = jobsFor(noun).filter(j => j.type === 'enhance');
  const running = jobs.some(j => j.status === 'running');
  if (!items.length) return null;
  const imported = items.filter(it => (it.fromImport || it.fromBook) && neverEnhanced(it)).length;
  const waiting = items.filter(it => openItems(it.enhancement) > 0).length;

  // every item with suggestions waiting, in one go (the panel per item is still
  // there to review one by one)
  const useOrSkipAll = (use) => {
    const ids = items.filter(it => openItems(it.enhancement) > 0).map(it => it.id);
    setData(prev => ids.reduce((book, id) => resolveEnhancement(book, kind, id, 'all', use), prev));
    setBulk(null);
  };

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
        <div className="mt-2" data-testid="enhance-all-waiting-box">
          <p className="text-xs text-emerald-800" data-testid="enhance-all-waiting">{waiting} {waiting === 1 ? singular : label} with suggestions to review {waitingHint}.</p>
          {setData && (bulk ? (
            <div className="mt-1 p-2 bg-white border border-emerald-200 rounded text-xs text-gray-700">
              {bulk === 'use'
                ? `Use every suggestion on all ${waiting}? What the book says replaces what is there now (you can still edit each one after).`
                : `Skip every suggestion on all ${waiting}? Nothing changes.`}
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => useOrSkipAll(bulk === 'use')} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700" data-testid="enhance-all-bulk-confirm">{bulk === 'use' ? 'Use all' : 'Skip all'}</button>
                <button type="button" onClick={() => setBulk(null)} className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 mt-1 text-xs">
              <button type="button" onClick={() => setBulk('use')} className="text-blue-700 hover:underline font-semibold" data-testid="enhance-all-use-every">Use all suggestions ({waiting})</button>
              <button type="button" onClick={() => setBulk('skip')} className="text-gray-600 hover:underline" data-testid="enhance-all-skip-every">Skip all</button>
            </div>
          ))}
        </div>
      )}
      {open && <EnhanceAllDialog noun={label} items={items} max={max} note={note} onStart={start} onCancel={() => setOpen(false)} />}
    </div>
  );
};

export default EnhanceAllBar;
