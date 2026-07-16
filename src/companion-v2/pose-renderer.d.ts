import type { CompanionState } from '@/state/companionMachine';

export type CompanionPose = 'sit' | 'loaf' | 'curl' | 'eat' | 'pounce' | 'play' | 'groom' | 'stretch' | 'desk';
export type TailState = 'upright' | 'sway' | 'tucked' | 'flick' | 'puffed';
export const COMPANION_POSES: CompanionPose[];
export function buildPoseSprite(source: readonly string[], pose?: CompanionPose, elapsedMs?: number): string[];
export function buildTailSprite(tailState?: TailState, frame?: number): string[];
export function poseForState(state: CompanionState): CompanionPose;
export function tailForState(state: CompanionState): TailState;
