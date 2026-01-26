import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle2, Edit2, Trash2, Merge, Split } from 'lucide-react';

const ChapterReviewModal = ({ isOpen, importData, onClose, onComplete }) => {
  const [chapters, setChapters] = useState([]);
  const [editingChapter, setEditingChapter] = useState(null);
  const [bookTitle, setBookTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (importData && importData.chapters) {
      setChapters(importData.chapters);
      // Set default book title from filename
      if (importData.filename) {
        setBookTitle(importData.filename.replace(/\.[^/.]+$/, ''));
      }
    }
  }, [importData]);

  if (!isOpen || !importData) return null;

  const stats = importData.stats || {};

  const handleEditTitle = (chapterId, newTitle) => {
    setChapters(chapters.map(ch =>
      ch.id === chapterId ? { ...ch, title: newTitle } : ch
    ));
  };

  const handleDeleteChapter = (chapterId) => {
    if (confirm('Are you sure you want to delete this chapter?')) {
      setChapters(chapters.filter(ch => ch.id !== chapterId));
    }
  };

  const handleMergeWithNext = (chapterIndex) => {
    if (chapterIndex >= chapters.length - 1) return;

    const currentChapter = chapters[chapterIndex];
    const nextChapter = chapters[chapterIndex + 1];

    const mergedChapter = {
      ...currentChapter,
      title: `${currentChapter.title} & ${nextChapter.title}`,
      content: currentChapter.content + '\n\n' + nextChapter.content,
      wordCount: currentChapter.wordCount + nextChapter.wordCount,
      charCount: currentChapter.charCount + nextChapter.charCount,
    };

    const newChapters = [
      ...chapters.slice(0, chapterIndex),
      mergedChapter,
      ...chapters.slice(chapterIndex + 2),
    ];

    setChapters(newChapters);
  };

  const handleSaveAndCreateBook = async () => {
    if (!bookTitle.trim()) {
      alert('Please enter a book title');
      return;
    }

    setSaving(true);

    try {
      const token = localStorage.getItem('token');

      // Step 1: Update chapters
      await fetch(`/api/books/import/${importData.importId}/chapters`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ chapters }),
      });

      // Step 2: Create book from import
      const response = await fetch(`/api/books/import/${importData.importId}/create-book`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          bookTitle,
          overview,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create book');
      }

      const result = await response.json();

      if (onComplete) {
        onComplete(result);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save book: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const lowConfidenceChapters = chapters.filter(ch => ch.confidence < 0.6);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-hidden">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Review Chapters</h2>
            <p className="text-gray-400 text-sm mt-1">
              {chapters.length} chapters detected • {stats.totalWords?.toLocaleString()} words
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-700 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Total Chapters</p>
              <p className="text-2xl font-bold text-white">{chapters.length}</p>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Total Words</p>
              <p className="text-2xl font-bold text-white">
                {stats.totalWords?.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Avg Words/Chapter</p>
              <p className="text-2xl font-bold text-white">
                {stats.avgWordsPerChapter?.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Avg Confidence</p>
              <p className="text-2xl font-bold text-white">
                {((stats.avgConfidence || 0) * 100).toFixed(0)}%
              </p>
            </div>
          </div>

          {/* Low Confidence Warning */}
          {lowConfidenceChapters.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-400 font-medium">
                  {lowConfidenceChapters.length} chapter(s) have low detection confidence
                </p>
                <p className="text-yellow-400/80 text-sm mt-1">
                  Review these chapters and consider merging or editing them.
                </p>
              </div>
            </div>
          )}

          {/* Book Metadata */}
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 font-medium mb-2">Book Title</label>
              <input
                type="text"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                placeholder="Enter book title..."
              />
            </div>
            <div>
              <label className="block text-gray-300 font-medium mb-2">Overview (Optional)</label>
              <textarea
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none h-24 resize-none"
                placeholder="Brief description of the book (will be generated by AI if left empty)..."
              />
            </div>
          </div>

          {/* Chapters List */}
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-white">Chapters</h3>
            {chapters.map((chapter, index) => (
              <div
                key={chapter.id}
                className={`bg-gray-700 rounded-lg p-4 ${
                  chapter.confidence < 0.6 ? 'border-2 border-yellow-500/50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {editingChapter === chapter.id ? (
                      <input
                        type="text"
                        value={chapter.title}
                        onChange={(e) => handleEditTitle(chapter.id, e.target.value)}
                        onBlur={() => setEditingChapter(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setEditingChapter(null);
                        }}
                        autoFocus
                        className="w-full bg-gray-600 border border-gray-500 rounded px-2 py-1 text-white focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <h4 className="text-white font-medium flex items-center gap-2">
                        <span className="text-gray-400">#{chapter.number}</span>
                        {chapter.title}
                        {chapter.confidence < 0.6 && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                            Low Confidence
                          </span>
                        )}
                      </h4>
                    )}
                    <div className="flex gap-4 mt-2 text-sm text-gray-400">
                      <span>{chapter.wordCount?.toLocaleString()} words</span>
                      <span>{chapter.charCount?.toLocaleString()} characters</span>
                      <span>Confidence: {((chapter.confidence || 0) * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-gray-400 text-sm mt-2 line-clamp-2">
                      {chapter.content.substring(0, 200)}...
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setEditingChapter(chapter.id)}
                      className="p-2 text-blue-400 hover:bg-gray-600 rounded transition-colors"
                      title="Edit title"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleMergeWithNext(index)}
                      disabled={index >= chapters.length - 1}
                      className="p-2 text-purple-400 hover:bg-gray-600 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Merge with next chapter"
                    >
                      <Merge className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteChapter(chapter.id)}
                      className="p-2 text-red-400 hover:bg-gray-600 rounded transition-colors"
                      title="Delete chapter"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 p-6 flex gap-3">
          <button
            onClick={handleSaveAndCreateBook}
            disabled={saving || !bookTitle.trim()}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Creating Book...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Create Book ({chapters.length} chapters)
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChapterReviewModal;
