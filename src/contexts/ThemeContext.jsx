import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

// ONE source of truth for theming: localStorage 'sw-theme' -> html[data-theme]
// (+ html.dark for Tailwind's class-based dark: variants — they must move together
// or the two theming systems disagree and half the UI renders the wrong theme).
// The saved CHOICE is 'light', 'dark' or 'system' (follow the device, live); `theme` is what it resolves to.
const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const CHOICES = ['light', 'dark', 'system'];

export function ThemeProvider({ children }) {
  const [choice, setChoice] = useState(() => {
    const saved = localStorage.getItem('sw-theme');
    return CHOICES.includes(saved) ? saved : 'system';
  });
  const [system, setSystem] = useState(systemTheme);
  const theme = choice === 'system' ? system : choice;

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  useEffect(() => {
    localStorage.setItem('sw-theme', choice);
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
  }, [choice, theme]);

  const setTheme = (c) => { if (CHOICES.includes(c)) setChoice(c); };
  const toggleTheme = () => setChoice(theme === 'light' ? 'dark' : 'light');

  return (
    <ThemeContext.Provider value={{ theme, choice, setTheme, toggleTheme }}>
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
