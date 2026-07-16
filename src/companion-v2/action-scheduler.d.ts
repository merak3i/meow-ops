import type { CompanionPose, TailState } from './pose-renderer.js';
export type CompanionAction = 'feed' | 'play' | 'groom' | 'sleep' | 'hungry' | 'session';
export interface ActionFrame { action: CompanionAction; pose: CompanionPose; tailState?: TailState; duration: number; offset: number; label: string; start: number; end: number }
export function enqueueAction(queue: ActionFrame[], action: CompanionAction, now?: number): ActionFrame[];
export function frameAt(queue: ActionFrame[], now?: number): ActionFrame | null;
export function scheduleBehavior(input: { hunger: number; hasLiveSession: boolean }): CompanionAction | null;
