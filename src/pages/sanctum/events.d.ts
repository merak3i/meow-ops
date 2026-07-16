export type SanctumEventType = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';
export interface SanctumEventBeat { type: SanctumEventType; sessionId?: string; costStep?: number }
export interface EventSessionState { ghost: boolean; live: boolean }
export interface EventSnapshot { sessions: Map<string, EventSessionState>; selectedId: string | null; totalCost: number; contextId: string | null }
export const EVENT_DURATIONS: Readonly<Record<SanctumEventType, number>>;
export const LIVE_SESSION_WINDOW_MS: number;
export function snapshotSessions(sessions: Array<{ session_id: string; is_ghost?: boolean; ended_at?: string }>, selectedId: string | null, totalCost: number, contextId?: string | null, now?: number): EventSnapshot;
export function diffEventSnapshots(previous: EventSnapshot | null, next: EventSnapshot): SanctumEventBeat[];
