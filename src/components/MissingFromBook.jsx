import React, { useState } from 'react';
import { Check, X, UserPlus } from 'lucide-react';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { resolveDiscoveries } from '../utils/enhanceFromBook';

// "Find missing characters / places": one job collects the names the book
// uses often that are in neither list and has SAI sort them into people and
// places. The finds wait on book.metadata.discoveries; each can be added (as a
// basic entry, ready for Enhance all) or skipped.

const WORDS = { people: { one: 'person', many: 'people', list: 'characters' }, places: { one: 'place', many: 'places', list: 'locations' } };

const MissingFromBook = ({ which, data, setData }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const jobs = jobsFor('missing').filter(j => j.type === 'enhance');
  const running = jobs.some(j => j.status === 'running');
  const hasChapterText = (data.chapters || []).some(c => String(c.content || '').trim());
  const d = data.metadata?.discoveries;
  const rows = d?.[which] || [];
  const w = WORDS[which];
  const [error, setError] = useState(null);
  const find = () => { setError(null); startJob('enhance', { type: 'missing', id: null }, {}).catch(e => setError(e.message)); };
  const resolve = (names, add) => setData(prev => resolveDiscoveries(prev, which, names, add));

  return (
    <div className="mb-3" data-testid={`missing-${which}`}>
      <button type="button" onClick={find} disabled={!hasChapterText || running}
        className="text-sm text-emerald-700 hover:underline disabled:opacity-50 disabled:no-underline flex items-center gap-1"
        title={hasChapterText ? `Look for ${w.many} the book names often who are not in your ${w.list}` : 'Add or import chapters first'}
        data-testid="missing-find">
        <UserPlus size={14} />{running ? 'Looking through the book...' : `Find missing ${w.list}`}
      </button>
      <MediaJobList jobs={jobs} className="mt-2" />
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
      {d && !running && rows.length === 0 && (
        <p className="mt-1 text-xs text-gray-500" data-testid="missing-none">No {w.many} missing from your {w.list} (checked {new Date(d.at).toLocaleDateString()}).</p>
      )}
      {rows.length > 0 && (
        <section className="mt-2 p-3 border border-emerald-200 rounded-lg bg-emerald-50/40" data-testid="missing-review">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-gray-900">Found in the book: {rows.length} {rows.length === 1 ? w.one : w.many} not in your {w.list}</span>
            <button type="button" onClick={() => resolve('all', true)} className="ml-auto px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700" data-testid="missing-add-all">Add all</button>
            <button type="button" onClick={() => resolve('all', false)} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">Skip all</button>
          </div>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {rows.map(x => (
              <li key={x.name} className="bg-white border border-gray-200 rounded p-2 text-sm" data-testid="missing-row">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-gray-900">{x.name}</span>
                    {(x.role || x.type) && <span className="ml-2 text-xs text-gray-500">{x.role || x.type}</span>}
                    {x.description && <p className="text-gray-700">{x.description}</p>}
                    <p className="text-xs text-gray-500">Named {x.mentions} time{x.mentions === 1 ? '' : 's'}{x.chapters?.length ? `, chapters ${x.chapters.slice(0, 8).join(', ')}${x.chapters.length > 8 ? '...' : ''}` : ''}</p>
                  </div>
                  <button type="button" onClick={() => resolve([x.name], true)} className="p-1 text-blue-600 hover:bg-blue-50 rounded" title={`Add ${x.name}`} data-testid="missing-add"><Check size={16} /></button>
                  <button type="button" onClick={() => resolve([x.name], false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded" title="Skip"><X size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default MissingFromBook;
