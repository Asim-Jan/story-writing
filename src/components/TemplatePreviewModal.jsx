import React, { useState, useEffect } from 'react';
import { X, BookOpen, Copy, ChevronDown, ChevronUp } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

const TemplatePreviewModal = ({ isOpen, templateId, onClose, onClone }) => {
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState(new Set([0])); // First chapter expanded

  useEffect(() => {
    if (isOpen && templateId) {
      fetchTemplate();
    }
  }, [isOpen, templateId]);

  const fetchTemplate = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/templates/${templateId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setTemplate(data);
      } else {
        throw new Error('Failed to load template');
      }
    } catch (err) {
      console.error('Error loading template:', err);
      setError('Failed to load template preview');
    } finally {
      setLoading(false);
    }
  };

  const toggleChapter = (index) => {
    const newExpanded = new Set(expandedChapters);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedChapters(newExpanded);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 flex justify-between items-start">
          <div className="flex-1">
            {loading ? (
              <div className="h-8 bg-white bg-opacity-20 rounded w-64 animate-pulse" />
            ) : (
              <>
                <h2 className="text-3xl font-bold mb-2">{template?.title}</h2>
                <p className="text-indigo-100">{template?.template_description || template?.description}</p>
                {template?.genre && (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    <span className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-sm">
                      {template.genre}
                    </span>
                    {template.target_audience && (
                      <span className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-sm">
                        {template.target_audience}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition-colors ml-4 flex-shrink-0"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <BookOpen className="w-16 h-16 text-indigo-600 animate-pulse" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          ) : (
            <>
              {/* Overview Section */}
              <div className="mb-8">
                <h3 className="text-xl font-bold text-gray-900 mb-4">Overview</h3>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-indigo-600">{template.chapter_count || 0}</div>
                    <div className="text-sm text-gray-600">Chapters</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-indigo-600">
                      {(template.word_count || 0).toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">Words</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-indigo-600">{template.clone_count || 0}</div>
                    <div className="text-sm text-gray-600">Times Used</div>
                  </div>
                </div>

                {/* Characters, Locations, Plotlines Preview */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Characters</h4>
                    <p className="text-sm text-gray-600">
                      {Array.isArray(template.characters) ? template.characters.length : 0} characters included
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Locations</h4>
                    <p className="text-sm text-gray-600">
                      {Array.isArray(template.locations) ? template.locations.length : 0} locations included
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-2">Plotlines</h4>
                    <p className="text-sm text-gray-600">
                      {Array.isArray(template.plotlines) ? template.plotlines.length : 0} plotlines included
                    </p>
                  </div>
                </div>
              </div>

              {/* Chapters Preview */}
              {template.chapters && template.chapters.length > 0 && (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Chapter Preview</h3>
                  <div className="space-y-3">
                    {template.chapters.map((chapter, index) => (
                      <div key={chapter.id} className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleChapter(index)}
                          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-gray-500">
                              Ch. {chapter.chapter_number}
                            </span>
                            <span className="font-semibold text-gray-900">{chapter.title}</span>
                            <span className="text-sm text-gray-500">
                              ({(chapter.word_count || 0).toLocaleString()} words)
                            </span>
                          </div>
                          {expandedChapters.has(index) ? (
                            <ChevronUp className="text-gray-400 flex-shrink-0" size={20} />
                          ) : (
                            <ChevronDown className="text-gray-400 flex-shrink-0" size={20} />
                          )}
                        </button>

                        {expandedChapters.has(index) && (
                          <div className="p-4 bg-gray-50 border-t border-gray-200">
                            <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
                              {chapter.preview}
                            </p>
                            <p className="text-gray-400 text-sm mt-2 italic">
                              Preview truncated. Full chapter available after cloning.
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-gray-50 p-6 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-6 py-3 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => onClone(templateId)}
            disabled={loading || error}
            className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Copy size={20} />
            Use This Template
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplatePreviewModal;
