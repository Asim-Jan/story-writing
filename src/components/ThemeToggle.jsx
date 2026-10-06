import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

// ORDNANCE: mode toggles STATE their mode — a labelled button, no icon-only chip.
export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`btn sm ${className}`}
      title={theme === 'dark' ? 'Switch to sheet (light)' : 'Switch to night chart (dark)'}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      <span>{theme === 'dark' ? 'Theme: Night' : 'Theme: Sheet'}</span>
    </button>
  );
}
