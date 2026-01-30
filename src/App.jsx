import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AudioPlayerProvider } from './contexts/AudioPlayerContext';
import { ThemeProvider } from './contexts/ThemeContext';
import FictionWritingStudio from './components/FictionWritingStudio';
import BooksList from './components/BooksList';
import AuthPage from './components/AuthPage';
import GlobalAudioPlayer from './components/GlobalAudioPlayer';
import AdminDashboard from './components/AdminDashboard';

function AppContent() {
  const { user, loading, login, isAuthenticated } = useAuth();
  const [currentView, setCurrentView] = useState('list'); // 'list', 'editor', or 'admin'
  const [selectedBookId, setSelectedBookId] = useState(null);

  // Check URL on mount to see if we should open a specific book or admin panel
  useEffect(() => {
    if (isAuthenticated) {
      const urlParams = new URLSearchParams(window.location.search);
      const bookId = urlParams.get('book');
      const admin = urlParams.get('admin');

      if (admin === 'true' && user?.role === 'admin') {
        setCurrentView('admin');
      } else if (bookId) {
        setSelectedBookId(bookId);
        setCurrentView('editor');
      }
    }
  }, [isAuthenticated, user]);

  const handleSelectBook = (bookId) => {
    setSelectedBookId(bookId);
    setCurrentView('editor');
    window.history.pushState({}, '', `?book=${bookId}`);
  };

  const handleNewBook = () => {
    setSelectedBookId(null);
    setCurrentView('editor');
    window.history.pushState({}, '', '/');
  };

  const handleBackToList = () => {
    setCurrentView('list');
    setSelectedBookId(null);
    window.history.pushState({}, '', '/');
  };

  const handleOpenAdmin = () => {
    setCurrentView('admin');
    window.history.pushState({}, '', '?admin=true');
  };

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={login} />;
  }

  // Show main app
  return (
    <>
      {currentView === 'list' ? (
        <BooksList
          onSelectBook={handleSelectBook}
          onNewBook={handleNewBook}
          onOpenAdmin={user?.role === 'admin' ? handleOpenAdmin : null}
        />
      ) : currentView === 'admin' ? (
        user?.role === 'admin' ? (
          <AdminDashboard onBack={handleBackToList} />
        ) : (
          <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="text-center">
              <p className="text-xl text-red-600">Admin access required</p>
            </div>
          </div>
        )
      ) : (
        <FictionWritingStudio bookId={selectedBookId} onBack={handleBackToList} />
      )}
      <GlobalAudioPlayer />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AudioPlayerProvider>
          <AppContent />
        </AudioPlayerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
