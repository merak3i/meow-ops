import type { Session } from '@/types/session';
import type { CatState, MemorialEntry } from '@/companion-v2/useCompanionGame';

export interface CompanionStoreState {
  cat: CatState | null;
  memorial: MemorialEntry[];
}

export function subscribe(fn: (state: CompanionStoreState) => void): () => void;
export function getState(): CompanionStoreState;
export function getCat(): CatState | null;
export function hasCat(): boolean;
export function getMemorial(): MemorialEntry[];
export function getMood(cat: CatState | null): string;
export function adoptKitten(breedKey: string, name: string): void;
export function feed(foodKey: string): void;
export function play(): void;
export function groom(): void;
export function sleep(): void;
export function purchaseAccessory(key: string): void;
export function toggleAccessory(key: string): void;
export function setRoom(roomKey: string): void;
export function claimSessionRewards(sessions: Session[]): void;
export function claimPomodoroRewards(history: Array<{ id: string }>): void;
export function rollDailyStreakBonus(streakDays: number): void;
export function bury(): void;
export function devSetLastFed(daysAgo: number): void;
export const RUNAWAY_THRESHOLD_DAYS: number;
