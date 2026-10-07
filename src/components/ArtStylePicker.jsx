import React from 'react';
import { Palette, Check } from 'lucide-react';
import { ART_STYLES } from '../utils/artStyles';

// Book Info: the one art style every image of the book is drawn in. Images
// already made keep their look; generate again to bring them in line.

const ArtStylePicker = ({ data, setData }) => {
  const current = data.metadata?.artStyle || null;
  const set = (artStyle) => setData(prev => ({ ...prev, metadata: { ...(prev.metadata || {}), artStyle } }));
  const isCustom = current?.id === 'custom';
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6" data-testid="art-style">
      <h3 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Palette size={24} className="text-purple-600" />
        Art Style
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Every image for this book is drawn in this style: portraits and reference sheets, locations, chapter pictures, the cover, comic panels and films.
        {!current?.id && ' With none chosen, each image picks its own look.'} Images already made keep theirs; generate them again to match.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ART_STYLES.map(s => {
          const on = current?.id === s.id;
          return (
            <button key={s.id} type="button" onClick={() => set({ id: s.id })} aria-pressed={on}
              className={`text-left p-3 rounded-lg border-2 transition-colors ${on ? 'border-purple-600 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
              data-testid="art-style-option" data-style={s.id}>
              <span className="font-semibold text-gray-900 flex items-center gap-1">{on && <Check size={14} className="text-purple-600" />}{s.label}</span>
              <span className="block text-xs text-gray-600 mt-1">{s.description}</span>
            </button>
          );
        })}
        <div className={`p-3 rounded-lg border-2 ${isCustom ? 'border-purple-600 bg-purple-50' : 'border-gray-200'}`}>
          <button type="button" onClick={() => set({ id: 'custom', custom: current?.custom || '' })} aria-pressed={isCustom}
            className="font-semibold text-gray-900 flex items-center gap-1" data-testid="art-style-option" data-style="custom">
            {isCustom && <Check size={14} className="text-purple-600" />}Your own
          </button>
          <input type="text" value={isCustom ? current.custom || '' : ''} placeholder="e.g. 1920s pulp magazine illustration"
            onFocus={() => { if (!isCustom) set({ id: 'custom', custom: '' }); }}
            onChange={(e) => set({ id: 'custom', custom: e.target.value.slice(0, 200) })}
            className="mt-2 w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-purple-400 outline-none" data-testid="art-style-custom" />
        </div>
      </div>
      {current?.id && (
        <button type="button" onClick={() => set(null)} className="mt-3 text-sm text-gray-600 hover:underline" data-testid="art-style-clear">No fixed style</button>
      )}
    </div>
  );
};

export default ArtStylePicker;
