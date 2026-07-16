import type { Comparison } from '@/types/loop';

export type DeltaTone = 'improving' | 'worsening' | 'neutral';
export interface DisplayDelta {
  metric: string;
  label: string;
  deltaPct: number;
  tone: DeltaTone;
}

export function deltaTone(deltaPct: number): DeltaTone;
export function formatSignedPercent(deltaPct: number): string;
export function selectRunDeltas(comparison: Comparison | null | undefined): DisplayDelta[];
