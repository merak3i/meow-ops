export type SanctumEventType = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';
export interface SanctumEventBeat { type: SanctumEventType; sessionId?: string; costStep?: number }
export interface EventSnapshot { sessions: Map<string, boolean>; selectedId: string | null; totalCost: number }
export const EVENT_DURATIONS: Readonly<Record<SanctumEventType, number>>;
export function snapshotSessions(sessions: Array<{ session_id: string; is_ghost?: boolean }>, selectedId: string | null, totalCost: number): EventSnapshot;
export function diffEventSnapshots(previous: EventSnapshot | null, next: EventSnapshot): SanctumEventBeat[];
