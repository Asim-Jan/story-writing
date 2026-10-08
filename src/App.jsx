import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AudioPlayerProvider } from './contexts/AudioPlayerContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { SubscriptionProvider } from './contexts/SubscriptionContext';
import FictionWritingStudio from './components/FictionWritingStudio';
import BooksList from './components/BooksList';
import AuthPage from './components/AuthPage';
import GlobalAudioPlayer from './components/GlobalAudioPlayer';
import AdminDashboard from './components/AdminDashboard';
import EmailVerificationPage from './components/EmailVerificationPage';
import EmailVerificationBanner from './components/EmailVerificationBanner';
import { PortalDonePage, PortalLinkPage, PortalErrorPage } from './components/PortalAuthPages';

function AppContent() {
  const { user, loading, login, isAuthenticated } = useAuth();
  const [currentView, setCurrentView] = useState('list'); // 'list', 'editor', or 'admin'
  const [selectedBookId, setSelectedBookId] = useState(null);

  // Check URL on mount to see if we should open a specific book, admin panel, or verification page
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const path = window.location.pathname;

    // Links from emails (public routes). Matched on the PATH: both links carry ?token=, so the
    // query alone can't tell a verification link from a password reset.
    if (path === '/verify-email') {
      setCurrentView('verify-email');
      return;
    }
    if (path === '/reset-password') {
      setCurrentView('reset-password');
      return;
    }
    // Sign in with SAI Cloud: the pages the round trip lands on (public routes)
    if (path === '/auth/portal/done') { setCurrentView('portal-done'); return; }
    if (path === '/auth/portal/link') { setCurrentView('portal-link'); return; }
    if (path === '/auth/portal/error') { setCurrentView('portal-error'); return; }

    if (isAuthenticated) {
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

  // Listen for book creation events to update the bookId after first save
  useEffect(() => {
    const handleBookCreated = (event) => {
      const { bookId } = event.detail;
      if (bookId) {
        setSelectedBookId(bookId);
      }
    };

    window.addEventListener('bookCreated', handleBookCreated);
    return () => window.removeEventListener('bookCreated', handleBookCreated);
  }, []);

  const onPortalSignedIn = useCallback((u, t, returnTo) => {
    // the URL first: the effect above opens ?book=... once the user is set
    window.history.replaceState({}, '', returnTo || '/');
    setCurrentView('list');
    login(u, t);
  }, [login]);

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

  // SAI Cloud sign-in landing pages. onPortalSignedIn stores the session exactly as the password login does.
  if (currentView === 'portal-done' || currentView === 'portal-link') {
    const Page = currentView === 'portal-done' ? PortalDonePage : PortalLinkPage;
    return <Page onSignedIn={onPortalSignedIn} />;
  }
  if (currentView === 'portal-error') {
    return <PortalErrorPage />;
  }

  // Show email verification page (public route - no auth required)
  if (currentView === 'verify-email') {
    return <EmailVerificationPage />;
  }

  // Password reset link (public route): the auth page opens on "choose a new password"
  if (currentView === 'reset-password') {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    return <AuthPage initialResetToken={token} onAuthSuccess={(u, t) => { window.history.replaceState({}, '', '/'); setCurrentView('list'); login(u, t); }} />;
  }

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
      {/* Email Verification Banner - shown on all pages if email not verified */}
      <EmailVerificationBanner user={user} />

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
        <SubscriptionProvider>
          <AudioPlayerProvider>
            <AppContent />
          </AudioPlayerProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
