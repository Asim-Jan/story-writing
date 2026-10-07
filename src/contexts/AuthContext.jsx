import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for stored auth on mount
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));

      // Verify token is still valid
      fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${storedToken}`
        },
        credentials: 'include'
      })
        .then(async res => {
          if (res.status === 401 || res.status === 403) {
            // Expired or revoked: sign out. (This used to leave the app on "Loading..." forever,
            // because logout() never cleared the loading flag.)
            await logout();
            return;
          }
          if (!res.ok) return; // server restarting etc.: keep the stored session and carry on
          const data = await res.json();
          setUser(data.user);
          localStorage.setItem('user', JSON.stringify(data.user));
        })
        .catch(() => { /* network error: keep the stored session */ })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // A 401 from ANY in-app fetch (useBook dispatches auth:expired) signs out.
  useEffect(() => {
    const onExpired = () => { logout(); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
    // AFTER the token lands — the subscription context refetches on this
    // event; firing it first made the refetch run with no token (→ free tier
    // until a full reload).
    window.dispatchEvent(new CustomEvent('auth:changed'));
  };

  // Portal-linked sessions (signed in with SAI Cloud) sign out through /auth/portal/logout, which also clears the
  // ID-token cookie; `everywhere` additionally returns the SAI Cloud end-session URL and we go there.
  const logout = async ({ everywhere = false } = {}) => {
    let portalRedirect = null;
    try {
      let viaPortal = false;
      try { viaPortal = !!JSON.parse(localStorage.getItem('user') || 'null')?.portalLinked; } catch { /* unreadable: treat as a password session */ }
      if (viaPortal) {
        const res = await fetch('/auth/portal/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ everywhere: everywhere === true })
        });
        if (res.ok) portalRedirect = (await res.json()).redirect || null;
      } else {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include'
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setToken(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new CustomEvent('auth:changed'));
      if (portalRedirect) window.location.assign(portalRedirect);
    }
  };

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    login,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
