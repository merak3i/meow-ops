import type { LoopEntity, LoopGate, LoopStatus } from './types';

export const STALE_DAYS: number;
export function isGateStale(gate: LoopGate, now?: Date): boolean;
export function effectiveStatus(entity: LoopEntity, gates: readonly LoopGate[], now?: Date): LoopStatus;
