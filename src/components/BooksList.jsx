import React, { useState, useEffect } from 'react';
import { Book, Plus, Trash2, Edit3, Clock, Search, Wand2, Upload, Settings, Shield, BookTemplate, History, ArrowRight } from 'lucide-react';
import AIBookGeneratorModal from './AIBookGeneratorModal';
import ImportUploadDialog from './ImportUploadDialog';
import RecentImports from './RecentImports';
import ImportReview from './ImportReview';
import { importsApi } from '../utils/importsApi';
import SettingsPage from './SettingsPage';
import { settingsArrival } from '../utils/settings';
import TemplateGalleryModal from './TemplateGalleryModal';
import TemplatePreviewModal from './TemplatePreviewModal';

// Use relative URLs to work with Vite proxy for both localhost and ngrok
const API_URL = '';

// ── Library — the sheet's front page. ORDNANCE: a ruled header block, a
// hairline search, a flat button row (one primary), and the books as a
// ruled table-grid of paper cards. Small-caps labels name everything.
const BooksList = ({ onSelectBook, onNewBook, onOpenAdmin }) => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState(null);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  // import flow: { mode: 'upload' | 'recent' | 'review', id? }
  const [importView, setImportView] = useState(null);
  const [pendingImports, setPendingImports] = useState([]); // imports waiting for review
  const setShowImport = (open) => setImportView(open ? { mode: 'upload' } : null);
  // Settings: null, or { section, arrival } (arrival: back from SAI Cloud or from checkout, read off the URL once)
  const [settings, setSettings] = useState(() => {
    const arrival = settingsArrival(window.location.search);
    return arrival ? { section: arrival.section, arrival } : null;
  });
  const [quotas, setQuotas] = useState(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  useEffect(() => {
    loadBooks();
    loadQuotas();
    loadPendingImports();
    // the one-time parameters have done their job: a reload must not replay "connected" or "payment received"
    if (settings?.arrival) window.history.replaceState({}, '', '/');
  }, []);

  const loadPendingImports = async () => {
    try {
      const d = await importsApi.list();
      setPendingImports((d?.imports || []).filter(i => i.status === 'review'));
    } catch {
      setPendingImports([]); // the list is a convenience; the library works without it
    }
  };

  const openImportedBook = (bookId) => {
    setImportView(null);
    loadBooks();
    onSelectBook(bookId);
  };

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

  const handleTemplateSelected = (templateId, action) => {
    if (action === 'preview') {
      setSelectedTemplateId(templateId);
      setShowTemplateGallery(false);
      setShowTemplatePreview(true);
    } else if (action === 'clone') {
      handleCloneTemplate(templateId);
    }
  };

  const handleCloneTemplate = async (templateId) => {
    try {
      const response = await fetch(`${API_URL}/api/templates/${templateId}/clone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (response.ok) {
        const newBook = await response.json();
        setShowTemplatePreview(false);
        setShowTemplateGallery(false);
        loadBooks();
        loadQuotas(); // Refresh quotas after cloning
        onSelectBook(newBook.id);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to clone template');
      }
    } catch (err) {
      console.error('Error cloning template:', err);
      alert('Failed to clone template');
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
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="text-center">
          <div className="hatch w-24 h-24 mx-auto mb-4 border border-[var(--line)]" />
          <p className="lbl">Loading your books…</p>
        </div>
      </div>
    );
  }

  // The review is a full page: big books have hundreds of sections.
  if (importView?.mode === 'review') {
    return (
      <ImportReview
        importId={importView.id}
        onBack={() => { setImportView(null); loadPendingImports(); }}
        onOpenBook={openImportedBook}
      />
    );
  }

  if (settings) {
    return <SettingsPage section={settings.section} arrival={settings.arrival} onBack={() => { setSettings(null); loadQuotas(); }} />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">

        {/* Header bar — brand line, utilities right, hairline rule under */}
        <div className="flex items-center justify-between gap-4 pb-4 mb-6 border-b-2 border-[var(--ink)]">
          <div className="flex items-center gap-3">
            <Book className="w-6 h-6 text-[var(--blue)]" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--ink)] leading-tight">Fiction Writing Studio</h1>
              <p className="lbl mt-0.5">Fiction writing projects</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {quotas && (
              <span className="pill num hidden sm:inline-flex">
                {quotas.usage.current_books} / {quotas.limits.max_books >= 999999 ? '∞' : quotas.limits.max_books} books
              </span>
            )}
            {onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                className="iconb"
                title="Admin Dashboard"
                aria-label="Admin Dashboard"
              >
                <Shield className="w-4.5 h-4.5" size={18} />
              </button>
            )}
            <button
              onClick={() => setSettings({ section: 'account' })}
              className="iconb"
              title="Settings"
              aria-label="Settings"
              data-testid="open-settings"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>

        {pendingImports.length > 0 && (
          <div className="mb-6 card px-4 py-3 flex flex-wrap items-center gap-3" data-testid="pending-imports">
            <History size={16} className="text-[var(--dim)]" />
            <p className="flex-1 text-sm text-[var(--ink)]">
              {pendingImports.length === 1
                ? <>The import of <strong>{pendingImports[0].title || pendingImports[0].fileName}</strong> is waiting for your review.</>
                : <>{pendingImports.length} imports are waiting for your review.</>}
            </p>
            {pendingImports.length === 1 ? (
              <button onClick={() => setImportView({ mode: 'review', id: pendingImports[0].id })} className="btn sm" data-testid="resume-pending">Resume review<ArrowRight size={14} /></button>
            ) : (
              <button onClick={() => setImportView({ mode: 'recent' })} className="btn sm">Show imports</button>
            )}
          </div>
        )}

        {/* Search + actions row */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-stretch">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--dim2)]" size={16} />
              <input
                type="text"
                placeholder="Search your books…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm"
                aria-label="Search your books"
              />
            </div>
            <div className="grid grid-cols-2 sm:flex gap-2">
              <button onClick={() => setShowImport(true)} className="btn" data-testid="open-import">
                <Upload size={15} />
                <span>Import</span>
              </button>
              <button onClick={() => setImportView({ mode: 'recent' })} className="btn" data-testid="open-recent-imports">
                <History size={15} />
                <span>Recent imports</span>
              </button>
              <button onClick={() => setShowTemplateGallery(true)} className="btn">
                <BookTemplate size={15} />
                <span>Templates</span>
              </button>
              <button
                onClick={() => setShowAIGenerator(true)}
                disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
                className="btn"
                title={quotas && quotas.usage.current_books >= quotas.limits.max_books ? 'Book limit reached' : 'Generate book with AI'}
              >
                <Wand2 size={15} />
                <span>AI Generate</span>
              </button>
              <button
                onClick={onNewBook}
                disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
                className="btn pri"
                title={quotas && quotas.usage.current_books >= quotas.limits.max_books ? 'Book limit reached' : 'Create a new book'}
              >
                <Plus size={15} />
                <span>New Book</span>
              </button>
            </div>
          </div>
          {quotas && quotas.usage.current_books >= quotas.limits.max_books && (
            <p className="mt-2 text-xs text-[var(--warn)]">
              Limit reached — delete a book or upgrade to create more.
            </p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 px-4 py-3 border border-[var(--red)] text-[var(--red)] text-sm rounded-[3px]">
            {error}
          </div>
        )}

        {/* Books Grid */}
        {filteredBooks.length === 0 ? (
          <div className="grat max-w-3xl mx-auto text-center py-16 sm:py-24 px-4">
            <Book className="w-12 h-12 text-[var(--dim2)] mx-auto mb-5" />
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--ink)] mb-2 rule2 inline-block">
              {searchTerm ? 'No books found' : 'No books yet'}
            </h2>
            <p className="text-sm text-[var(--dim)] mt-3 mb-7">
              {searchTerm
                ? 'Try a different search term'
                : 'Start your writing journey by creating your first book'}
            </p>
            {!searchTerm && (
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
                <button onClick={() => setShowImport(true)} className="btn">
                  <Upload size={15} />
                  Import Book
                </button>
                <button
                  onClick={() => setShowAIGenerator(true)}
                  disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
                  className="btn"
                >
                  <Wand2 size={15} />
                  AI Generate Book
                </button>
                <button
                  onClick={onNewBook}
                  disabled={quotas && quotas.usage.current_books >= quotas.limits.max_books}
                  className="btn pri"
                >
                  <Plus size={15} />
                  Create Manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredBooks.map((book) => (
              <div
                key={book.id}
                onClick={() => onSelectBook(book.id)}
                className="card cursor-pointer group hover:border-[var(--dim)] transition-colors"
              >
                <div className="px-5 pt-4 pb-3 border-b border-[var(--line)]">
                  <div className="flex items-start justify-between gap-2">
                    <Book className="w-5 h-5 text-[var(--blue)] mt-1 flex-none" />
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBook(book.id);
                        }}
                        className="iconb"
                        title="Edit"
                        aria-label={`Edit ${book.title}`}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={(e) => deleteBook(book.id, e)}
                        className="iconb text-[var(--red)]"
                        title="Delete"
                        aria-label={`Delete ${book.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-[var(--ink)] mt-2 line-clamp-2">
                    {book.title}
                  </h3>
                </div>

                <div className="px-5 py-3">
                  <div className="flex items-center gap-2 text-xs text-[var(--dim)] mono">
                    <Clock size={12} />
                    <span>{formatDate(book.updatedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats Footer */}
        {filteredBooks.length > 0 && (
          <div className="mt-10 text-center">
            <p className="lbl">
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

      {/* Import: upload, then review (full page above), or resume from Recent imports */}
      {(importView?.mode === 'upload' || importView?.mode === 'watch') && (
        <ImportUploadDialog
          resumeId={importView.mode === 'watch' ? importView.id : null}
          onClose={() => { setImportView(null); loadPendingImports(); }}
          onReview={(id) => setImportView({ mode: 'review', id })}
          onOpenBook={openImportedBook}
        />
      )}
      {importView?.mode === 'recent' && (
        <RecentImports
          onClose={() => { setImportView(null); loadPendingImports(); }}
          onReview={(id) => setImportView({ mode: 'review', id })}
          onWatch={(imp) => setImportView({ mode: 'watch', id: imp.id })}
          onOpenBook={openImportedBook}
        />
      )}

      {/* Template Gallery Modal */}
      {showTemplateGallery && (
        <TemplateGalleryModal
          isOpen={showTemplateGallery}
          onClose={() => setShowTemplateGallery(false)}
          onTemplateSelected={handleTemplateSelected}
        />
      )}

      {/* Template Preview Modal */}
      {showTemplatePreview && (
        <TemplatePreviewModal
          isOpen={showTemplatePreview}
          templateId={selectedTemplateId}
          onClose={() => setShowTemplatePreview(false)}
          onClone={handleCloneTemplate}
        />
      )}
    </div>
  );
};

export default BooksList;
