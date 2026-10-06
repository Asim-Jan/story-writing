import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

// ONE source of truth for theming: localStorage 'sw-theme' -> html[data-theme]
// (+ html.dark for Tailwind's class-based dark: variants — they must move together
// or the two theming systems disagree and half the UI renders the wrong theme).
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('sw-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    // first visit follows the system, and that choice is then persisted
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    localStorage.setItem('sw-theme', system);
    return system;
  });

  useEffect(() => {
    localStorage.setItem('sw-theme', theme);
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
