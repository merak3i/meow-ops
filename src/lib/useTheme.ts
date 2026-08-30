import { useCallback, useState } from 'react';

// Theme lives on the document element so `:root[data-theme="light"]` repaints
// without a React re-render. main.jsx applies the stored value before first
// paint to avoid a flash of the wrong theme.

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'meow-ops-theme';

function current(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
    setTheme(next);
  }, []);

  return { theme, toggle };
}
