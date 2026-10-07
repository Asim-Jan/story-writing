import React from 'react';
import { Trash2, Check } from 'lucide-react';
import { picturesOf, removePicture, setMainPicture } from '../utils/pictures';

// A character's or location's pictures: the main one large, every earlier
// generated or uploaded one below it. Each can be made the main picture or
// deleted. Reference sheets keep their own gallery (CharacterReferences).
const ItemPictures = ({ kind, item, book, setData, onOpenImage }) => {
  const pictures = picturesOf(book, kind, item, { references: false });
  if (!pictures.length) return null;
  const main = pictures.find(p => p.main);
  const others = pictures.filter(p => !p.main);
  const name = item.name || (kind === 'character' ? 'this character' : 'this location');

  const remove = (picture) => {
    const what = picture.main && others.length ? ' The newest other picture becomes the main one.' : '';
    if (!confirm(`Delete this picture from ${name}?${what}`)) return;
    setData(prev => removePicture(prev, kind, item.id, picture.url));
  };
  const useAsMain = (picture) => setData(prev => setMainPicture(prev, kind, item.id, picture.url));

  return (
    <div className="mb-6 sm:mb-8" data-testid="item-pictures">
      {main && (
        <div>
          <img
            src={main.url}
            alt={name}
            className="w-full max-h-64 sm:max-h-96 object-cover rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => onOpenImage?.({ imageUrl: main.url, description: item.name })}
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={() => remove(main)}
              data-testid="picture-delete-main"
              className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              Delete picture
            </button>
          </div>
        </div>
      )}
      {others.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-2">{main ? 'Other pictures' : 'Pictures'} ({others.length})</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {others.map(picture => (
              <div key={picture.url} className="border border-gray-200 rounded-lg overflow-hidden flex flex-col" data-testid="picture-other">
                <button onClick={() => onOpenImage?.({ imageUrl: picture.url, description: item.name })} title="Open full size" className="block bg-gray-50">
                  <img src={picture.url} alt={`${name}, earlier picture`} className="w-full h-28 object-cover" />
                </button>
                <div className="p-2 flex items-center gap-1">
                  {picture.createdAt && (
                    <span className="text-xs text-gray-500 mr-auto">{new Date(picture.createdAt).toLocaleDateString()}</span>
                  )}
                  <button onClick={() => useAsMain(picture)} className="ml-auto px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1" title="Use as the main picture" data-testid="picture-use">
                    <Check size={12} />
                    Use
                  </button>
                  <button onClick={() => remove(picture)} className="px-2 py-1 text-red-600 hover:bg-red-50 rounded" title="Delete picture" aria-label="Delete picture" data-testid="picture-delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemPictures;
