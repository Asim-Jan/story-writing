import React from 'react';
import { X } from 'lucide-react';

const ImagePreviewModal = ({ imageUrl, description, onClose }) => {
  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-6xl max-h-[90vh] bg-white rounded-lg overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-white bg-opacity-90 hover:bg-opacity-100 rounded-full p-2 shadow-lg transition-all z-10"
        >
          <X size={24} className="text-gray-800" />
        </button>

        <img
          src={imageUrl}
          alt={description}
          className="max-w-full max-h-[85vh] object-contain"
        />

        {description && (
          <div className="p-4 bg-gray-50 border-t border-gray-200">
            <p className="text-gray-800 text-center">{description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImagePreviewModal;
