// useCompanionGame.ts — wraps companion-store.js for V2 React tree.
// Subscribes to store updates so components re-render on any mutation.
// All game actions are passed through unchanged — no logic lives here.
// Also owns personality trait derivation and memory mark persistence.

import { useState, useEffect, useCallback } from 'react';
import * as store from '@/lib/companion-store';
import type { Session } from '@/types/session';

// ─── Re-exported game state shape ────────────────────────────────────────────

export interface CatStats {
  hunger:    number;
  energy:    number;
  happiness: number;
  health:    number;
  shine:     number;
}

export interface CatAppearance {
  weight:              'thin' | 'normal' | 'plump';
  furQuality:          'dull' | 'normal' | 'shiny' | 'glowing';
  sizeMultiplier:      number;
  equippedAccessories: string[];
  shinyVariant:        string | null;
}

export type LifeStage = 'kitten' | 'adolescent' | 'youngAdult' | 'adult' | 'elder';
export type CatStatus = 'alive' | 'lost';

export interface CatInventory {
  foods:          Record<string, number>;
  accessories:    string[];
  unlockedRooms:  string[];
}

export interface CatState {
  id:           string;
  breed:        string;
  name:         string;
  adoptedAt:    string;
  lastSeenAt:   string;
  lastFedAt:    string;
  stats:        CatStats;
  growthXP:     number;
  lifeStage:    LifeStage;
  status:       CatStatus;
  appearance:   CatAppearance;
  room:         { tier: number; key: string };
  inventory:    CatInventory;
  streakDays:   number;
}

export interface MemorialEntry {
  id:             string;
  name:           string;
  breed:          string;
  adoptedAt:      string;
  lostAt:         string;
  daysLived:      number;
  finalLifeStage: LifeStage;
}

// ─── Personality trait system ─────────────────────────────────────────────────

export interface PersonalityTrait {
  name:  string;
  badge: string;
  color: string;
  bonus: string;       // short human-readable bonus description
}

const TRAIT_MAP: Record<string, PersonalityTrait> = {
  architect:   { name: 'Methodical',  badge: '📐', color: '#c084fc', bonus: '+5% happiness decay resistance' },
  builder:     { name: 'Prolific',    badge: '🔨', color: 'var(--amber)', bonus: '+10% shine from feed' },
  detective:   { name: 'Vigilant',    badge: '🔍', color: 'var(--cyan)',  bonus: '+5% health passive' },
  commander:   { name: 'Bold',        badge: '⚡', color: '#f87171',      bonus: '+10% energy from sleep' },
  guardian:    { name: 'Steadfast',   badge: '🛡️', color: 'var(--green)', bonus: '+5% max health' },
  storyteller: { name: 'Expressive',  badge: '📝', color: '#fb923c',      bonus: '+5% happiness from play' },
  ghost:       { name: 'Mysterious',  badge: '👻', color: 'var(--text-muted)', bonus: 'Occasional translucent shimmer' },
};

/**
 * Derives the cat's personality trait from the developer's last 14 days of sessions.
 * Returns null if there aren't enough sessions to determine a pattern.
 */
export function derivePersonalityTrait(sessions: Session[]): PersonalityTrait | null {
  const cutoffMs = Date.now() - 14 * 86_400_000;
  const recent   = sessions.filter(
    (s) => new Date(s.ended_at || s.started_at).getTime() > cutoffMs,
  );
  if (recent.length < 5) return null;

  const counts: Record<string, number> = {};
  for (const s of recent) {
    counts[s.cat_type] = (counts[s.cat_type] || 0) + 1;
  }

  const [dominant] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!dominant) return null;

  return TRAIT_MAP[dominant[0]] ?? null;
}

// ─── Memory marks ─────────────────────────────────────────────────────────────

export interface MemoryMark {
  type: string;    // 'scar' | 'gold-stripe' | 'star-mark' | 'big-run-blaze' | 'crown-mark'
  date: string;    // ISO-8601 when awarded
}

const MARKS_KEY_PREFIX = 'meow-marks-';

function loadMarks(catId: string): MemoryMark[] {
  try {
    const raw = localStorage.getItem(MARKS_KEY_PREFIX + catId);
    return raw ? (JSON.parse(raw) as MemoryMark[]) : [];
  } catch {
    return [];
  }
}

function saveMarks(catId: string, marks: MemoryMark[]): void {
  try {
    localStorage.setItem(MARKS_KEY_PREFIX + catId, JSON.stringify(marks));
  } catch {
    // quota exceeded — silently skip
  }
}

// ─── Drawer state ─────────────────────────────────────────────────────────────

export interface DrawerState {
  foodOpen:      boolean;
  wardrobeOpen:  boolean;
  roomOpen:      boolean;
  setFoodOpen:      (v: boolean) => void;
  setWardrobeOpen:  (v: boolean) => void;
  setRoomOpen:      (v: boolean) => void;
}

// ─── Hook return ─────────────────────────────────────────────────────────────

export interface UseCompanionGameReturn {
  cat:         CatState | null;
  memorial:    MemorialEntry[];
  mood:        string;
  trait:       PersonalityTrait | null;
  memoryMarks: MemoryMark[];
  drawers:     DrawerState;
  actions: {
    adopt:           (breed: string, name: string) => void;
    feed:            (foodKey: string) => void;
    play:            () => void;
    groom:           () => void;
    sleep:           () => void;
    purchaseAccessory: (key: string) => void;
    toggleAccessory: (key: string) => void;
    setRoom:         (roomKey: string) => void;
    bury:            () => void;
    claimSessions:   (sessions: Session[]) => void;
    claimPomodoros:  (history: { id: string }[]) => void;
    rollDailyStreak: (streakDays: number) => void;
    addMemoryMark:   (mark: MemoryMark) => void;
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCompanionGame(sessions: Session[]): UseCompanionGameReturn {
  const [gameState, setGameState] = useState<ReturnType<typeof store.getState>>(
    () => store.getState(),
  );

  // Drawer open/close state
  const [foodOpen,     setFoodOpen]     = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [roomOpen,     setRoomOpen]     = useState(false);

  // Subscribe to store mutations
  useEffect(() => {
    const unsub = store.subscribe((next: ReturnType<typeof store.getState>) => {
      setGameState({ ...next });
    });
    return unsub;
  }, []);

  // Auto-claim session rewards once on mount / when sessions change
  useEffect(() => {
    if (sessions.length > 0 && store.hasCat()) {
      store.claimSessionRewards(sessions);
    }
  // Only re-run when the session count changes (avoid infinite loops)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length]);

  const cat      = (gameState.cat as CatState | null) ?? null;
  const memorial = (gameState.memorial ?? []) as MemorialEntry[];
  const mood     = store.getMood(cat);

  // ── Memory marks ──────────────────────────────────────────────────────────
  // Scoped to cat.id — clears automatically when a new cat is adopted.

  const [memoryMarks, setMemoryMarks] = useState<MemoryMark[]>(() =>
    cat ? loadMarks(cat.id) : [],
  );

  // Reload marks when cat changes (new adoption or bury)
  useEffect(() => {
    setMemoryMarks(cat ? loadMarks(cat.id) : []);
  }, [cat?.id]);

  // ── Personality trait ──────────────────────────────────────────────────────
  // Pure derivation from sessions — no persistence needed.
  const trait = derivePersonalityTrait(sessions);

  // ── Actions ────────────────────────────────────────────────────────────────

  const adopt = useCallback((breed: string, name: string) => {
    store.adoptKitten(breed, name);
  }, []);

  const feed = useCallback((foodKey: string) => {
    store.feed(foodKey);
  }, []);

  const play = useCallback(() => {
    store.play();
  }, []);

  const groom = useCallback(() => {
    store.groom();
  }, []);

  const sleep = useCallback(() => {
    store.sleep();
  }, []);

  const purchaseAccessory = useCallback((key: string) => {
    store.purchaseAccessory(key);
  }, []);

  const toggleAccessory = useCallback((key: string) => {
    store.toggleAccessory(key);
  }, []);

  const setRoom = useCallback((roomKey: string) => {
    store.setRoom(roomKey);
  }, []);

  const bury = useCallback(() => {
    store.bury();
  }, []);

  const claimSessions = useCallback((s: Session[]) => {
    store.claimSessionRewards(s);
  }, []);

  const claimPomodoros = useCallback((history: { id: string }[]) => {
    store.claimPomodoroRewards(history);
  }, []);

  const rollDailyStreak = useCallback((streakDays: number) => {
    store.rollDailyStreakBonus(streakDays);
  }, []);

  const addMemoryMark = useCallback((mark: MemoryMark) => {
    if (!cat) return;
    setMemoryMarks((prev) => {
      if (prev.some((m) => m.type === mark.type)) return prev; // already awarded
      const next = [...prev, mark];
      saveMarks(cat.id, next);
      return next;
    });
  }, [cat]);

  return {
    cat,
    memorial,
    mood,
    trait,
    memoryMarks,
    drawers: {
      foodOpen,
      wardrobeOpen,
      roomOpen,
      setFoodOpen,
      setWardrobeOpen,
      setRoomOpen,
    },
    actions: {
      adopt,
      feed,
      play,
      groom,
      sleep,
      purchaseAccessory,
      toggleAccessory,
      setRoom,
      bury,
      claimSessions,
      claimPomodoros,
      rollDailyStreak,
      addMemoryMark,
    },
  };
}
