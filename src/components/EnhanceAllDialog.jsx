import React, { useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { neverEnhanced, nameOf, openItems } from '../utils/enhanceFromBook';

// "Enhance all from book": pick which characters (or locations, plotlines,
// events) one background job reads the book for. A page holds as many as one
// run takes, so a long list goes a page at a time: it opens on the first page
// with ones never enhanced, those ticked, and "Select this page" ticks a page.

const EnhanceAllDialog = ({ noun, items, max = 40, note, onStart, onCancel }) => {
  const perPage = Math.min(max, 40);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const firstFresh = items.findIndex(neverEnhanced);
  const [page, setPage] = useState(firstFresh === -1 ? 0 : Math.floor(firstFresh / perPage));
  const onPage = (p) => items.slice(p * perPage, (p + 1) * perPage);
  const [picked, setPicked] = useState(() => new Set(onPage(page).filter(neverEnhanced).slice(0, max).map(it => String(it.id))));
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else if (next.size < max) next.add(id);
    return next;
  });
  const selectPage = () => setPicked(new Set(onPage(page).slice(0, max).map(it => String(it.id))));
  const selectFresh = () => setPicked(new Set(items.filter(neverEnhanced).slice(0, max).map(it => String(it.id))));
  const chosen = items.filter(it => picked.has(String(it.id)));
  const fresh = items.filter(neverEnhanced).length;
  const shown = onPage(page);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="enhance-all-title" data-testid="enhance-all-dialog">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
        <h3 id="enhance-all-title" className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2"><BookOpen size={18} className="text-emerald-600" />Enhance {noun} from the book</h3>
        <p className="text-sm text-gray-600 mb-3">
          {note || 'SAI reads the passages about each one and suggests what the book says. It runs in the background (about 5 to 20 seconds each); the suggestions wait on each one for you to use or skip.'} One AI request for the whole run{items.length > max ? `, up to ${max} at a time` : ''}.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm mb-2">
          <button type="button" className="text-blue-600 hover:underline" onClick={selectPage} data-testid="enhance-all-select-page">Select this page</button>
          {fresh > 0 && <button type="button" className="text-blue-600 hover:underline" onClick={selectFresh} data-testid="enhance-all-select-fresh">Select not yet enhanced</button>}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setPicked(new Set())}>Select none</button>
          <span className="ml-auto text-gray-500" data-testid="enhance-all-count">{picked.size} selected{fresh ? `, ${fresh} never enhanced` : ''}</span>
        </div>
        <ul className="overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2 flex-1">
          {shown.map(it => (
            <li key={it.id}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={picked.has(String(it.id))} onChange={() => toggle(String(it.id))} data-testid="enhance-all-item" />
                <span className="flex-1">{nameOf(it)}</span>
                {openItems(it.enhancement) > 0
                  ? <span className="text-xs text-emerald-700">{openItems(it.enhancement)} waiting</span>
                  : !neverEnhanced(it) && <span className="text-xs text-gray-500">enhanced before</span>}
              </label>
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <div className="flex items-center justify-between text-sm mb-3" data-testid="enhance-all-pages">
            <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40 flex items-center gap-1" data-testid="enhance-all-prev">
              <ChevronLeft size={14} />Previous
            </button>
            <span className="text-gray-600" data-testid="enhance-all-page">Page {page + 1} of {pages} ({page * perPage + 1} to {Math.min(items.length, (page + 1) * perPage)})</span>
            <button type="button" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40 flex items-center gap-1" data-testid="enhance-all-next">
              Next<ChevronRight size={14} />
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
          <button type="button" onClick={() => onStart(chosen)} disabled={!chosen.length}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50" data-testid="enhance-all-start">
            Enhance {chosen.length}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnhanceAllDialog;
