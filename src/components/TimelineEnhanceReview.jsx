import React, { useState } from 'react';
import { BookOpen, Check } from 'lucide-react';
import EnhanceFromBookPanel from './EnhanceFromBookPanel';
import EnhanceAllBar from './EnhanceAllBar';
import { resolveEnhancement, closeEnhancement, openItems } from '../utils/enhanceFromBook';

// The Timeline's "Enhance from book": one job reads each event's chapter once
// (date in the story, place, kind of scene, what happens). The events are drawn
// in two layouts, so their suggestions are reviewed here, in one list above
// the timeline, each event with its own panel.

const SHOW = 8;

const TimelineEnhanceReview = ({ data, setData }) => {
  const [expanded, setExpanded] = useState(false);
  const events = data.timelines || [];
  const hasChapterText = (data.chapters || []).some(c => String(c.content || '').trim());
  const waiting = events.filter(ev => openItems(ev.enhancement) > 0);
  const shown = expanded ? waiting : waiting.slice(0, SHOW);
  const useEverything = () => setData(prev => waiting.reduce((book, ev) => resolveEnhancement(book, 'event', ev.id, 'all', true), prev));

  if (!events.length) return null;
  return (
    <div className="mb-6" data-testid="timeline-enhance">
      <div className="max-w-md">
        <EnhanceAllBar noun="timelines" kind="event" label="timeline events" singular="timeline event" items={events} max={400}
          hasChapterText={hasChapterText} waitingHint="(below)"
          note="SAI reads each event's chapter once and suggests when it happens in the story, where, what kind of scene it is and what happens. It runs in the background (a few seconds per chapter); the suggestions are listed here for you to use or skip." />
      </div>
      {waiting.length > 0 && (
        <section className="mt-3 p-4 border border-emerald-200 rounded-lg bg-white" data-testid="timeline-enhance-review">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><BookOpen size={18} className="text-emerald-600" />From the book: {waiting.length} event{waiting.length === 1 ? '' : 's'} to review</h3>
            <button type="button" onClick={useEverything} className="ml-auto px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-1" data-testid="timeline-use-everything">
              <Check size={14} />Use all for every event
            </button>
          </div>
          {shown.map(ev => (
            <EnhanceFromBookPanel key={ev.id} kind="event" item={ev} title={ev.event || 'Event'} className="mb-3"
              onResolve={(items, use) => setData(prev => resolveEnhancement(prev, 'event', ev.id, items, use))}
              onClose={() => setData(prev => closeEnhancement(prev, 'event', ev.id))} />
          ))}
          {waiting.length > SHOW && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="text-sm text-blue-600 hover:underline">
              {expanded ? 'Show fewer' : `Show all ${waiting.length}`}
            </button>
          )}
        </section>
      )}
    </div>
  );
};

export default TimelineEnhanceReview;
