import type { NodeType, NodeStatus, EdgeStatus, PayloadType } from './types';

// ── Canvas geometry ───────────────────────────────────────────────────────────
export const NODE_W      = 168;   // champion card width  (SVG units)
export const NODE_H      = 100;   // champion card height (SVG units)
export const CANVAS_W    = 1120;  // default SVG viewBox width
export const CANVAS_H    = 500;   // default SVG viewBox height

// ── Champion metadata ─────────────────────────────────────────────────────────
export const CHAMPION_META: Record<NodeType, {
  sigil: string;
  role: string;
  accentColor: string;     // primary text / icon color
  borderColor: string;     // card border
  glowColor: string;       // CSS box-shadow color
}> = {
  argent_vanguard: {
    sigil: '⚔',
    role: 'Input Sentry',
    accentColor: '#d4aa6a',
    borderColor: '#3d2e0f',
    glowColor: 'rgba(212,170,106,0.18)',
  },
  ebon_blade_scout: {
    sigil: '◈',
    role: 'Research Scout',
    accentColor: '#7eb8d4',
    borderColor: '#0f2030',
    glowColor: 'rgba(126,184,212,0.18)',
  },
  dalaran_archmage: {
    sigil: '✦',
    role: 'LLM Archmage',
    accentColor: '#b48fe8',
    borderColor: '#25103d',
    glowColor: 'rgba(180,143,232,0.18)',
  },
  argent_herald: {
    sigil: '⟴',
    role: 'Output Emissary',
    accentColor: '#d4aa6a',
    borderColor: '#3d2e0f',
    glowColor: 'rgba(212,170,106,0.18)',
  },
};

// ── Status colors ─────────────────────────────────────────────────────────────
export const NODE_STATUS_COLOR: Record<NodeStatus, string> = {
  idle:      '#3a3c4e',
  active:    '#4aff8c',
  completed: '#4a9eff',
  error:     '#ff4a4a',
};

export const EDGE_COLOR: Record<EdgeStatus, string> = {
  healthy: '#4a9eff',
  choked:  '#4a9eff',
  severed: '#ff4a4a',
};

export const EDGE_OPACITY: Record<EdgeStatus, number> = {
  healthy: 1,
  choked:  0.28,
  severed: 0.9,
};

// ── Runestone (payload packet) colors ─────────────────────────────────────────
export const RUNESTONE_COLOR: Record<PayloadType, string> = {
  json:  '#4aff8c',
  text:  '#4a9eff',
  error: '#ff4a4a',
};

export const RUNESTONE_GLOW: Record<PayloadType, string> = {
  json:  'rgba(74,255,140,0.55)',
  text:  'rgba(74,158,255,0.55)',
  error: 'rgba(255,74,74,0.7)',
};

// ── Bezier path builder ───────────────────────────────────────────────────────
// source / target are the center-point coordinates of the nodes.
// Entry = right edge of source; Exit = left edge of target.
export function buildLeyLinePath(
  sx: number, sy: number,
  tx: number, ty: number,
): string {
  const ex  = sx + NODE_W / 2;   // edge exit point
  const en  = tx - NODE_W / 2;   // edge entry point
  const dx  = en - ex;
  const cp1x = ex + dx * 0.45;
  const cp2x = en - dx * 0.45;
  return `M ${ex} ${sy} C ${cp1x} ${sy} ${cp2x} ${ty} ${en} ${ty}`;
}
