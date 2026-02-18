import React, { useState, useEffect } from 'react';
import { X, BookOpen, Eye, Copy, Filter } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

const TemplateGalleryModal = ({ isOpen, onClose, onTemplateSelected }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen, selectedCategory]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const url = selectedCategory
        ? `${API_URL}/api/templates?category=${selectedCategory}`
        : `${API_URL}/api/templates`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setTemplates(data);
      } else {
        throw new Error('Failed to load templates');
      }
    } catch (err) {
      console.error('Error loading templates:', err);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const categories = ['Fantasy', 'Romance', 'Sci-Fi', 'Mystery', 'Thriller'];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-4 sm:p-6 flex justify-between items-center">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-3xl font-bold mb-1 sm:mb-2 truncate">Template Gallery</h2>
            <p className="text-purple-100 text-sm sm:text-base truncate">Choose a template to jumpstart your writing</p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 sm:p-3 transition-colors flex-shrink-0 ml-2"
          >
            <X size={20} className="sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Category Filter */}
        <div className="p-6 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            <Filter size={20} className="text-gray-600" />
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedCategory('')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedCategory === ''
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    selectedCategory === cat
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <BookOpen className="w-16 h-16 text-purple-600 mx-auto mb-4 animate-pulse" />
                <p className="text-xl text-gray-700">Loading templates...</p>
              </div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-24 h-24 text-gray-300 mx-auto mb-4" />
              <p className="text-xl text-gray-600">No templates available</p>
              <p className="text-sm text-gray-500 mt-2">Check back soon for more templates!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {templates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onPreview={() => onTemplateSelected(template.id, 'preview')}
                  onClone={() => onTemplateSelected(template.id, 'clone')}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TemplateCard = ({ template, onPreview, onClone }) => {
  return (
    <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden hover:border-purple-400 hover:shadow-lg transition-all">
      {/* Preview Image or Icon */}
      <div className="h-40 bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center">
        <BookOpen className="w-16 h-16 text-purple-600" />
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-xl font-bold text-gray-900 line-clamp-2 flex-1">{template.title}</h3>
          {template.template_category && (
            <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full whitespace-nowrap flex-shrink-0">
              {template.template_category}
            </span>
          )}
        </div>

        <p className="text-gray-600 text-sm mb-4 line-clamp-3">
          {template.template_description || template.description}
        </p>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
          <span>{template.chapter_count || 0} chapters</span>
          <span>{(template.word_count || 0).toLocaleString()} words</span>
          {template.clone_count > 0 && (
            <span className="text-purple-600 font-medium">
              {template.clone_count} {template.clone_count === 1 ? 'clone' : 'clones'}
            </span>
          )}
        </div>

        {/* Tags */}
        {template.template_tags && template.template_tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {template.template_tags.slice(0, 3).map((tag, idx) => (
              <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                {tag}
              </span>
            ))}
            {template.template_tags.length > 3 && (
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                +{template.template_tags.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onPreview}
            className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <Eye size={18} />
            Preview
          </button>
          <button
            onClick={onClone}
            className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <Copy size={18} />
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateGalleryModal;
