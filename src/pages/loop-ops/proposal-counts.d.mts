import type { Decision, Proposal } from '@/types/loop';

export function countOpenProposals(proposals: readonly Proposal[], decisions: readonly Decision[]): Map<string, number>;
