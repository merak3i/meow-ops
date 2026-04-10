// useCompanionGame.ts — wraps companion-store.js for V2 React tree.
// Subscribes to store updates so components re-render on any mutation.
// All game actions are passed through unchanged — no logic lives here.

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
  cat:      CatState | null;
  memorial: MemorialEntry[];
  mood:     string;
  drawers:  DrawerState;
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

  return {
    cat,
    memorial,
    mood,
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
    },
  };
}
