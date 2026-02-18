import React, { useState } from 'react';
import { FileText, Plus, Trash2, Grid3x3, List } from 'lucide-react';

const NotesTab = ({ data, setData, noteForm, setNoteForm, addNote, deleteItem }) => {
  const [selectedNote, setSelectedNote] = useState(null);
  const [viewMode, setViewMode] = useState('list');

  const showingDetail = selectedNote !== null || (noteForm.title || noteForm.content);

  const resetForm = () => {
    setNoteForm({ title: '', content: '', category: 'general' });
    setSelectedNote(null);
  };

  const handleAddNew = () => {
    setSelectedNote(null);
    resetForm();
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'general': return 'bg-gray-100 text-gray-800';
      case 'research': return 'bg-blue-100 text-blue-800';
      case 'ideas': return 'bg-purple-100 text-purple-800';
      case 'worldbuilding': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const sortedNotes = [...data.notes].sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  return (
    <div className="flex h-full relative">
      {/* Left sidebar - Notes list */}
      <div className={`${viewMode === 'grid' ? 'w-full' : 'w-full lg:w-80'} ${showingDetail ? 'hidden lg:flex' : 'flex'} bg-white border-r border-gray-200 flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-2">
            <button
              onClick={handleAddNew}
              className="flex-1 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <Plus size={20} />
              New Note
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              title={viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View'}
            >
              {viewMode === 'list' ? <Grid3x3 size={20} /> : <List size={20} />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {data.notes.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p>No notes yet</p>
            </div>
          ) : viewMode === 'list' ? (
            <>
              {sortedNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => setSelectedNote(note)}
              className={`w-full p-4 text-left border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                selectedNote?.id === note.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <FileText className="text-amber-600 mt-1 flex-shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{note.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${getCategoryColor(note.category)}`}>
                      {note.category}
                    </span>
                    {note.createdAt && (
                      <span className="text-xs text-gray-500">{formatDate(note.createdAt)}</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
              ))}
            </>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedNotes.map((note) => (
                <div key={note.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900 mb-1 truncate">{note.title}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`inline-block text-xs px-2 py-1 rounded ${getCategoryColor(note.category)}`}>
                          {note.category}
                        </span>
                        {note.createdAt && (
                          <span className="text-xs text-gray-500">{formatDate(note.createdAt)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteItem('notes', note.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {note.content && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-4">{note.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Details or form */}
      {viewMode === 'list' && (
        <div className={`${showingDetail ? 'fixed inset-0 lg:relative lg:flex-1 z-50 bg-white' : 'hidden lg:block lg:flex-1'} overflow-y-auto p-4 sm:p-6`}>
          {selectedNote ? (
          // Detailed view
          <div className="max-w-4xl">
            <div className="flex items-start justify-between mb-4 sm:mb-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                  {/* Mobile back button */}
                  <button
                    onClick={() => setSelectedNote(null)}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Back to notes"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800">{selectedNote.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getCategoryColor(selectedNote.category)}`}>
                    {selectedNote.category}
                  </span>
                  {selectedNote.createdAt && (
                    <span className="text-sm text-gray-600">Created {formatDate(selectedNote.createdAt)}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  deleteItem('notes', selectedNote.id);
                  setSelectedNote(null);
                }}
                className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 flex-shrink-0"
              >
                <Trash2 size={16} className="flex-shrink-0" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>

            <div className="prose prose-lg max-w-none">
              <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{selectedNote.content}</p>
              </div>
            </div>
          </div>
        ) : (
          // Form view
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 mb-4 sm:mb-6">
              {/* Mobile back button */}
              <button
                onClick={resetForm}
                className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                title="Back to notes"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-800">Add New Note</h2>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                placeholder="Note Title *"
                value={noteForm.title}
                onChange={(e) => setNoteForm(prev => ({ ...prev, title: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              />

              <select
                value={noteForm.category}
                onChange={(e) => setNoteForm(prev => ({ ...prev, category: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              >
                <option value="general">General</option>
                <option value="research">Research</option>
                <option value="ideas">Ideas</option>
                <option value="worldbuilding">Worldbuilding</option>
              </select>

              <textarea
                placeholder="Note Content *"
                value={noteForm.content}
                onChange={(e) => setNoteForm(prev => ({ ...prev, content: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none h-64 focus:ring-2 focus:ring-amber-400 outline-none"
              />

              <button
                onClick={() => {
                  addNote();
                  resetForm();
                }}
                disabled={!noteForm.title || !noteForm.content}
                className="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={20} />
                Add Note
              </button>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotesTab;
