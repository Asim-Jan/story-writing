import React, { useState, useEffect } from 'react';
import { Book, Plus, Trash2, Edit3, Clock, Search, Wand2, Upload, Settings, User, Shield } from 'lucide-react';
import AIBookGeneratorModal from './AIBookGeneratorModal';
import ImportBookModal from './ImportBookModal';
import ChapterReviewModal from './ChapterReviewModal';
import SettingsModal from './SettingsModal';
import ProfilePage from './ProfilePage';

// Use relative URLs to work with Vite proxy for both localhost and ngrok
const API_URL = '';

const BooksList = ({ onSelectBook, onNewBook, onOpenAdmin }) => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState(null);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState(null);
  const [showChapterReview, setShowChapterReview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [quotas, setQuotas] = useState(null);

  useEffect(() => {
    loadBooks();
    loadQuotas();
  }, []);

  const loadBooks = async () => {
    try {
      const response = await fetch(`${API_URL}/api/books`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setBooks(data);
      } else {
        throw new Error('Failed to load books');
      }
    } catch (err) {
      console.error('Error loading books:', err);
      setError('Failed to load books');
    } finally {
      setLoading(false);
    }
  };

  const loadQuotas = async () => {
    try {
      const response = await fetch(`${API_URL}/api/quotas`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setQuotas(data);
      }
    } catch (err) {
      console.error('Error loading quotas:', err);
    }
  };

  const deleteBook = async (bookId, e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this book? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/books/${bookId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setBooks(books.filter(book => book.id !== bookId));
        // Reload quotas after deletion to update the count
        loadQuotas();
      } else {
        throw new Error('Failed to delete book');
      }
    } catch (err) {
      console.error('Error deleting book:', err);
      alert('Failed to delete book');
    }
  };

  const filteredBooks = books.filter(book =>
    book.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <Book className="w-16 h-16 text-amber-600 mx-auto mb-4 animate-pulse" />
          <p className="text-xl text-gray-700">Loading your books...</p>
        </div>
      </div>
    );
  }

  if (showProfile) {
    return <ProfilePage onBack={() => setShowProfile(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-2 relative">
            <Book className="w-12 h-12 text-amber-700" />
            <h1 className="text-5xl font-bold text-gray-900">Book Writing Studio</h1>
            <div className="absolute right-0 flex gap-2">
              {onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="p-3 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Admin Dashboard"
                >
                  <Shield className="w-6 h-6" />
                </button>
              )}
              <button
                onClick={() => setShowProfile(true)}
                className="p-3 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                title="Profile"
              >
                <User className="w-6 h-6" />
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="p-3 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                title="Quick Settings"
              >
                <Settings className="w-6 h-6" />
              </button>
            </div>
          </div>
          {quotas && (
            <div className="mb-2 text-sm text-gray-600">
              <span className={`font-semibold ${quotas.usage.current_books >= quotas.limits.max_books ? 'text-red-600' : 'text-amber-700'}`}>
                {quotas.usage.current_books} / {quotas.limits.max_books}
              </span>
              {' '}books used
              {quotas.usage.current_books >= quotas.limits.max_books && (
                <span className="ml-2 text-red-600 font-medium">
                  (Limit reached - delete a book or upgrade to create more)
                </span>
              )}
            </div>
          )}
          <p className="text-xl text-gray-600">Create and manage your fiction writing projects</p>
        </div>

        {/* Search and New Book */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Search your books..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-4 rounded-xl border-2 border-amber-200 bg-white text-lg focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none shadow-sm"
              />
            </div>
            <button
              onClick={() => setShowImport(true)}
              className="px-8 py-4 bg-gradient-to-r from-green-600 to-teal-600 text-white rounded-xl hover:from-green-700 hover:to-teal-700 transition-all flex items-center gap-3 shadow-lg hover:shadow-xl text-lg font-semibold"
            >
              <Upload size={24} />
              Import
            </button>
            <button
              onClick={() => setShowAIGenerator(true)}
              disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
              className={`px-8 py-4 ${
                quotas && quotas.usage.current_books >= quotas.limits.max_books
                  ? 'bg-gray-400 cursor-not-allowed opacity-60'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl'
              } text-white rounded-xl transition-all flex items-center gap-3 text-lg font-semibold`}
              title={quotas && quotas.usage.current_books >= quotas.limits.max_books ? 'Book limit reached' : 'Generate book with AI'}
            >
              <Wand2 size={24} />
              AI Generate
            </button>
            <button
              onClick={onNewBook}
              disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
              className={`px-8 py-4 ${
                quotas && quotas.usage.current_books >= quotas.limits.max_books
                  ? 'bg-gray-400 cursor-not-allowed opacity-60'
                  : 'bg-amber-600 hover:bg-amber-700 shadow-lg hover:shadow-xl'
              } text-white rounded-xl transition-colors flex items-center gap-3 text-lg font-semibold`}
              title={quotas && quotas.usage.current_books >= quotas.limits.max_books ? 'Book limit reached' : 'Create a new book'}
            >
              <Plus size={24} />
              New Book
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-4xl mx-auto mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Books Grid */}
        {filteredBooks.length === 0 ? (
          <div className="max-w-4xl mx-auto text-center py-20">
            <Book className="w-24 h-24 text-gray-300 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-gray-700 mb-4">
              {searchTerm ? 'No books found' : 'No books yet'}
            </h2>
            <p className="text-xl text-gray-500 mb-8">
              {searchTerm
                ? 'Try a different search term'
                : 'Start your writing journey by creating your first book'}
            </p>
            {!searchTerm && (
              <div className="flex gap-4 justify-center flex-wrap">
                <button
                  onClick={() => setShowImport(true)}
                  className="px-8 py-4 bg-gradient-to-r from-green-600 to-teal-600 text-white rounded-xl hover:from-green-700 hover:to-teal-700 transition-all inline-flex items-center gap-3 shadow-lg hover:shadow-xl text-lg font-semibold"
                >
                  <Upload size={24} />
                  Import Book
                </button>
                <button
                  onClick={() => setShowAIGenerator(true)}
                  disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
                  className={`px-8 py-4 ${
                    quotas && quotas.usage.current_books >= quotas.limits.max_books
                      ? 'bg-gray-400 cursor-not-allowed opacity-60'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl'
                  } text-white rounded-xl transition-all inline-flex items-center gap-3 text-lg font-semibold`}
                >
                  <Wand2 size={24} />
                  AI Generate Book
                </button>
                <button
                  onClick={onNewBook}
                  disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
                  className={`px-8 py-4 ${
                    quotas && quotas.usage.current_books >= quotas.limits.max_books
                      ? 'bg-gray-400 cursor-not-allowed opacity-60'
                      : 'bg-amber-600 hover:bg-amber-700 shadow-lg hover:shadow-xl'
                  } text-white rounded-xl transition-colors inline-flex items-center gap-3 text-lg font-semibold`}
                >
                  <Plus size={24} />
                  Create Manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBooks.map((book) => (
              <div
                key={book.id}
                onClick={() => onSelectBook(book.id)}
                className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all cursor-pointer border-2 border-transparent hover:border-amber-300 overflow-hidden group"
              >
                <div className="bg-gradient-to-br from-amber-100 to-orange-100 p-6 border-b-2 border-amber-200">
                  <div className="flex items-start justify-between mb-3">
                    <Book className="w-10 h-10 text-amber-700" />
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBook(book.id);
                        }}
                        className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={(e) => deleteBook(book.id, e)}
                        className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2 line-clamp-2">
                    {book.title}
                  </h3>
                </div>

                <div className="p-6">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock size={16} />
                    <span>Last updated: {formatDate(book.updatedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats Footer */}
        {filteredBooks.length > 0 && (
          <div className="max-w-4xl mx-auto mt-12 text-center">
            <p className="text-lg text-gray-600">
              {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'} in your library
            </p>
          </div>
        )}
      </div>

      {/* AI Book Generator Modal */}
      {showAIGenerator && (
        <AIBookGeneratorModal
          onClose={() => setShowAIGenerator(false)}
          onBookCreated={(bookId) => {
            loadBooks();
            onSelectBook(bookId);
          }}
        />
      )}

      {/* Import Book Modal */}
      {showImport && (
        <ImportBookModal
          isOpen={showImport}
          onClose={() => setShowImport(false)}
          onImportComplete={(data) => {
            setImportData(data);
            setShowImport(false);
            setShowChapterReview(true);
          }}
        />
      )}

      {/* Chapter Review Modal */}
      {showChapterReview && importData && (
        <ChapterReviewModal
          isOpen={showChapterReview}
          importData={importData}
          onClose={() => {
            setShowChapterReview(false);
            setImportData(null);
          }}
          onComplete={(result) => {
            setShowChapterReview(false);
            setImportData(null);
            loadBooks();
            if (result.bookId) {
              onSelectBook(result.bookId);
            }
          }}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
};

export default BooksList;
