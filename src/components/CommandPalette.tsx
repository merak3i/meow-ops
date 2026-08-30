import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar, Moon, RefreshCw, Sun, Search, type LucideIcon,
} from 'lucide-react';

import { NAV_LOCATIONS } from './nav-config';

// Command palette. The app had sixteen mouse-only sidebar buttons and no
// keyboard path to anything; this is the primary way to move around now, and
// the sidebar is the discoverable fallback.

export interface Command {
  id: string;
  label: string;
  group: string;
  description?: string;
  icon?: LucideIcon;
  keywords: readonly string[];
  run: () => void;
}

/**
 * Subsequence match, the same rule Linear and VS Code use: the query letters
 * must appear in order but need not be adjacent, so "uc" finds "Usage · Cost".
 * Returns a score where lower is better, or null for no match.
 */
function score(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const direct = t.indexOf(q);
  if (direct === 0) return 0;
  if (direct > 0) return 1 + direct * 0.01;

  let cursor = 0;
  let gaps = 0;
  for (const char of q) {
    const found = t.indexOf(char, cursor);
    if (found === -1) return null;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 100 + gaps;
}

function rank(query: string, command: Command): number | null {
  const candidates = [command.label, ...command.keywords, command.description ?? ''];
  let best: number | null = null;
  for (const candidate of candidates) {
    const value = score(query, candidate);
    if (value === null) continue;
    // Keyword and description hits rank below label hits.
    const weighted = candidate === command.label ? value : value + 40;
    if (best === null || weighted < best) best = weighted;
  }
  return best;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (surface: string, tab?: string | null) => void;
  onSync: () => void;
  onSetDateRange: (range: number | string) => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
}

const DATE_PRESETS: readonly { value: number | string; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

export function CommandPalette({
  open, onClose, onNavigate, onSync, onSetDateRange, onToggleTheme, theme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const navCommands: Command[] = NAV_LOCATIONS.map((location) => ({
      id: `go:${location.path}`,
      label: location.label,
      group: location.group,
      description: location.description,
      icon: location.icon,
      keywords: location.keywords,
      run: () => onNavigate(location.surfaceId, location.tabId),
    }));

    const actionCommands: Command[] = [
      {
        id: 'action:sync',
        label: 'Sync sessions now',
        group: 'Actions',
        description: 'Re-parse local session files and reload.',
        icon: RefreshCw,
        keywords: ['refresh', 'reload', 'import', 'parse', 'update'],
        run: onSync,
      },
      {
        id: 'action:theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: ['theme', 'dark', 'light', 'appearance', 'colour', 'color'],
        run: onToggleTheme,
      },
      ...DATE_PRESETS.map((preset) => ({
        id: `range:${preset.value}`,
        label: `Date range: ${preset.label}`,
        group: 'Actions',
        icon: Calendar,
        keywords: ['filter', 'period', 'range', 'date', String(preset.value)],
        run: () => onSetDateRange(preset.value),
      })),
    ];

    return [...navCommands, ...actionCommands];
  }, [onNavigate, onSync, onSetDateRange, onToggleTheme, theme]);

  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((command) => ({ command, value: rank(query.trim(), command) }))
      .filter((entry): entry is { command: Command; value: number } => entry.value !== null)
      .sort((a, b) => a.value - b.value)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (!open) { setQuery(''); setActive(0); }
  }, [open]);

  const commit = useCallback((command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  }, [onClose]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      setActive((index) => (results.length ? (index + 1) % results.length : 0));
      return;
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); commit(results[active]); }
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results.length]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div
      className="mo-palette__backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="mo-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 'var(--sp-4)' }}>
          <Search size={15} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            autoFocus
            className="mo-palette__input"
            placeholder="Go to a surface, or run a command"
            aria-label="Search commands"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="mo-palette__list" ref={listRef}>
          {results.length === 0 && <p className="mo-palette__empty">Nothing matches “{query}”.</p>}
          {results.map((command, index) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            const Icon = command.icon;
            return (
              <div key={command.id}>
                {showGroup && <p className="mo-palette__group mo-eyebrow">{command.group}</p>}
                <button
                  type="button"
                  className="mo-palette__item"
                  data-active={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => commit(command)}
                >
                  {Icon && <Icon size={14} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }} />}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{command.label}</span>
                    {command.description && (
                      <span style={{ display: 'block', fontSize: 'var(--fs-meta)', color: 'var(--text-muted)' }}>
                        {command.description}
                      </span>
                    )}
                  </span>
                  {index === active && (
                    <span className="mo-palette__hint">
                      <kbd className="mo-kbd">↵</kbd>
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mo-palette__footer">
          <span><kbd className="mo-kbd">↑</kbd> <kbd className="mo-kbd">↓</kbd> navigate</span>
          <span><kbd className="mo-kbd">↵</kbd> open</span>
          <span><kbd className="mo-kbd">esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}><kbd className="mo-kbd">g</kbd> then a letter jumps</span>
        </div>
      </div>
    </div>
  );
}
