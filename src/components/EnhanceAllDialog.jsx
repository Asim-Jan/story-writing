import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { neverEnhanced } from '../utils/enhanceFromBook';

// "Enhance all from book": pick which characters (or locations) one background
// job reads the book for. The ones never enhanced are ticked to begin with.

const EnhanceAllDialog = ({ noun, items, max = 40, onStart, onCancel }) => {
  const [picked, setPicked] = useState(() => new Set(items.filter(neverEnhanced).slice(0, max).map(it => String(it.id))));
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else if (next.size < max) next.add(id);
    return next;
  });
  const chosen = items.filter(it => picked.has(String(it.id)));
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="enhance-all-title" data-testid="enhance-all-dialog">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
        <h3 id="enhance-all-title" className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2"><BookOpen size={18} className="text-emerald-600" />Enhance {noun} from the book</h3>
        <p className="text-sm text-gray-600 mb-3">
          SAI reads the passages about each one and suggests what the book says. It runs in the background (about 5 to 20 seconds each);
          the suggestions wait on each one for you to use or skip. One AI request for the whole run.
        </p>
        <div className="flex gap-3 text-sm mb-2">
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setPicked(new Set(items.slice(0, max).map(it => String(it.id))))}>Select all</button>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setPicked(new Set())}>Select none</button>
          <span className="ml-auto text-gray-500">{picked.size} of {items.length}{items.length > max ? ` (at most ${max})` : ''}</span>
        </div>
        <ul className="overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 mb-4">
          {items.map(it => (
            <li key={it.id}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={picked.has(String(it.id))} onChange={() => toggle(String(it.id))} data-testid="enhance-all-item" />
                <span className="flex-1">{it.name}</span>
                {!neverEnhanced(it) && <span className="text-xs text-gray-500">enhanced before</span>}
              </label>
            </li>
          ))}
        </ul>
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
