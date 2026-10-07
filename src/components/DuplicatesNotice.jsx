import React, { useState } from 'react';
import { Copy, ArrowLeftRight, SearchCheck } from 'lucide-react';
import { findDuplicates, mergeDuplicate, markNotDuplicates } from '../utils/duplicates';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';

// "Possible duplicates": the same person (or place) in the list twice under
// two forms of one name. Each pair: merge into one (which name to keep can be
// swapped), or "Not the same", which is remembered. Locations also have
// "Check for duplicate locations": SAI reads every name and description and
// adds the pairs it finds (with why) to the same list.

const DuplicateCheck = ({ data, found }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [error, setError] = useState(null);
  const jobs = jobsFor('duplicates', 'location').filter(j => j.type === 'enhance');
  const running = jobs.some(j => j.status === 'running');
  const named = (data.locations || []).filter(l => String(l.name || '').trim()).length;
  const last = data.metadata?.duplicateCheck?.location;
  const check = () => { setError(null); startJob('enhance', { type: 'duplicates', id: 'location' }, {}).catch(e => setError(e.message)); };
  if (named < 2) return null;
  return (
    <div className="mb-3" data-testid="duplicate-check">
      <button type="button" onClick={check} disabled={running}
        className="text-sm text-amber-700 hover:underline disabled:opacity-50 disabled:no-underline flex items-center gap-1"
        title="SAI reads every location's name and description and points out the ones that look like one place"
        data-testid="duplicate-check-run">
        <SearchCheck size={14} />{running ? 'Comparing your locations...' : 'Check for duplicate locations'}
      </button>
      <MediaJobList jobs={jobs} className="mt-2" />
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
      {last && !running && found === 0 && (
        <p className="mt-1 text-xs text-gray-500" data-testid="duplicate-check-none">No duplicate locations found (checked {new Date(last.at).toLocaleDateString()}).</p>
      )}
    </div>
  );
};

const DuplicatesNotice = ({ kind, data, setData, onMerged }) => {
  const [open, setOpen] = useState(true);
  const [confirm, setConfirm] = useState(null); // { keep, drop }
  const pairs = findDuplicates(data, kind);
  const checker = kind === 'location' ? <DuplicateCheck data={data} found={pairs.length} /> : null;
  if (!pairs.length) return checker;
  const noun = kind === 'character' ? 'character' : 'location';

  const merge = ({ keep, drop }) => {
    setData(prev => mergeDuplicate(prev, kind, keep.id, drop.id));
    setConfirm(null);
    onMerged?.(keep.id, drop.id);
  };

  return (
    <>
    {checker}
    <section className="mb-3 p-3 border border-amber-300 bg-amber-50 rounded-lg text-sm" data-testid={`duplicates-${kind}`}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 font-semibold text-gray-900 text-left">
        <Copy size={14} className="text-amber-700" />
        {pairs.length} possible duplicate{pairs.length === 1 ? '' : 's'}
        <span className="ml-auto text-xs text-amber-800">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {pairs.map(p => {
            const c = confirm && confirm.keep.id === p.keep.id && confirm.drop.id === p.drop.id ? confirm
              : confirm && confirm.keep.id === p.drop.id && confirm.drop.id === p.keep.id ? confirm : null;
            const shown = c || p;
            return (
              <li key={`${p.keep.id}|${p.drop.id}`} className="bg-white border border-amber-200 rounded p-2" data-testid="duplicate-pair">
                <p className="text-gray-900"><span className="font-semibold">{p.drop.name}</span> and <span className="font-semibold">{p.keep.name}</span> look like one {noun}.</p>
                {p.reason && <p className="text-xs text-gray-600" data-testid="duplicate-reason">SAI: {p.reason}</p>}
                {c ? (
                  <div className="mt-1">
                    <p className="text-xs text-gray-600 mb-1">
                      Keep <span className="font-semibold">{shown.keep.name}</span>; {shown.drop.name} becomes an "Also known as". What either one has is combined, and links elsewhere in the book move over.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => merge(shown)} className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700" data-testid="duplicate-confirm">Merge</button>
                      <button type="button" onClick={() => setConfirm({ keep: shown.drop, drop: shown.keep })} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200 flex items-center gap-1">
                        <ArrowLeftRight size={12} />Keep {shown.drop.name} instead
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className="px-2 py-1 text-gray-600 text-xs hover:underline">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setConfirm(p)} className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700" data-testid="duplicate-merge">Merge into {p.keep.name}</button>
                    <button type="button" onClick={() => setData(prev => markNotDuplicates(prev, kind, p.keep.id, p.drop.id))} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" data-testid="duplicate-dismiss">Not the same</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
    </>
  );
};

export default DuplicatesNotice;
