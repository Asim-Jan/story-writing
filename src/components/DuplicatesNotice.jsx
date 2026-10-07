import React, { useState } from 'react';
import { Copy, ArrowLeftRight } from 'lucide-react';
import { findDuplicates, mergeDuplicate, markNotDuplicates } from '../utils/duplicates';

// "Possible duplicates": the same person (or place) in the list twice under
// two forms of one name. Each pair: merge into one (which name to keep can be
// swapped), or "Not the same", which is remembered.

const DuplicatesNotice = ({ kind, data, setData, onMerged }) => {
  const [open, setOpen] = useState(true);
  const [confirm, setConfirm] = useState(null); // { keep, drop }
  const pairs = findDuplicates(data, kind);
  if (!pairs.length) return null;
  const noun = kind === 'character' ? 'character' : 'location';

  const merge = ({ keep, drop }) => {
    setData(prev => mergeDuplicate(prev, kind, keep.id, drop.id));
    setConfirm(null);
    onMerged?.(keep.id, drop.id);
  };

  return (
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
  );
};

export default DuplicatesNotice;
