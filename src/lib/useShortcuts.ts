import { useEffect, useRef, useState } from 'react';

import { NAV } from '../components/nav-config';

// Global keyboard layer: Cmd/Ctrl+K opens the palette, and `g` followed by a
// surface letter jumps directly. The `g` chord expires after 1.2s so a stray
// keypress does not silently arm a jump.

const CHORD_TIMEOUT_MS = 1200;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface ShortcutHandlers {
  onOpenPalette: () => void;
  onNavigate: (surface: string) => void;
  /** True while the palette is open, so we stop handling page-level keys. */
  paletteOpen: boolean;
}

export function useShortcuts({ onOpenPalette, onNavigate, paletteOpen }: ShortcutHandlers) {
  const [chordArmed, setChordArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function disarm() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setChordArmed(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;

      if (modified && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        disarm();
        onOpenPalette();
        return;
      }

      if (paletteOpen || modified || event.altKey || isTypingTarget(event.target)) return;

      if (chordArmed) {
        const surface = NAV.find((entry) => entry.shortcut === event.key.toLowerCase());
        disarm();
        if (surface) {
          event.preventDefault();
          onNavigate(surface.id);
        }
        return;
      }

      if (event.key === 'g') {
        event.preventDefault();
        setChordArmed(true);
        timer.current = setTimeout(disarm, CHORD_TIMEOUT_MS);
        return;
      }

      // `/` is the near-universal "focus search" key; route it to the palette
      // so there is one place to search rather than two.
      if (event.key === '/') {
        event.preventDefault();
        onOpenPalette();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [chordArmed, onNavigate, onOpenPalette, paletteOpen]);

  return { chordArmed };
}
