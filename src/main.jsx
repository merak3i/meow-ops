import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Apply theme attribute before render to avoid a flash of the wrong theme
// on first paint. Reads stored preference, falls back to OS preference.
(function applyInitialTheme() {
  try {
    const stored = localStorage.getItem('meow-ops-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
      return;
    }
  } catch { /* localStorage blocked — fall through to media query */ }
  const prefersLight = typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark');
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
