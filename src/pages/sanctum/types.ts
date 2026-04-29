// Shared types for the Scrying Sanctum visualizer. Pulled out of the
// monolithic ScryingSanctum.tsx as part of the file-split refactor — having
// types in one place makes them safe to consume from any sub-module without
// triggering circular imports through component files.

import type { Session } from '@/types/session';

// ─── Perf level ──────────────────────────────────────────────────────────────

export type PerfLevel = 'low' | 'normal' | 'ornate';

export interface PerfStats {
  fps: number;
  ms: number;
  calls: number;
  triangles: number;
  geometries: number;
}

// ─── Class config (pixel-art champion class metadata) ────────────────────────

export interface ClassConfig {
  color:    string;
  emissive: string;
  label:    string;
  aura:     string;
}

// ─── Per-session identity ────────────────────────────────────────────────────

export interface SessionIdentifier {
  /** "feat-llm-sun" or "#A4F2" — what shows above the character + in the roster. */
  tag:        string;
  /** 4-char uppercase hex from session_id, always present. */
  hashShort:  string;
  /** Curated accent color, drives banner/aura/tag tinting. */
  accent:     string;
  /** Index 0..6 — exposed so visual axes (banner shape, etc.) can vary independently. */
  accentIdx:  number;
}

// ─── Eternal stats (the Lich King's domain) ──────────────────────────────────

export interface EternalStats {
  totalSpend:    number;  // sum of estimated_cost_usd across every session
  totalTokens:   number;  // sum of total_tokens across every session
  totalSessions: number;  // count of all sessions ever parsed
  ghostCount:    number;  // count of sessions where is_ghost === true
}

// ─── Movement profile (per-class wandering personality) ──────────────────────

export interface MovementProfile {
  speed: number;        // multiplier on base 1.5
  bounceAmp: number;    // walk bounce amplitude
  idlePauseMin: number; // min seconds idle before next move
  idlePauseMax: number; // max seconds
  breatheSpeed: number; // idle sway speed
  breatheAmp: number;   // idle sway amplitude
  prefersEdge: boolean; // stalks edges vs wanders freely
  prefersAllies: boolean; // stays near parent
}

// ─── Character quotes ────────────────────────────────────────────────────────

export type QuoteFn = (s: Session) => string;

// ─── Signature moves (5 per class, triggered by milestones) ──────────────────

export interface SignatureMove {
  name: string;
  trigger: (s: Session) => boolean;
  emoji: string;     // shown in speech bubble
  quote: string | QuoteFn;
}

// ─── Positioned node (champion ready to render) ──────────────────────────────

export interface PositionedNode {
  session:  Session;
  depth:    number;
  idx:      number;
  total:    number;
  pos:      [number, number, number];
  cls:      ClassConfig;
  name:     string;
  role:     string;
}
