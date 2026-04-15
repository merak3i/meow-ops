// ScryingSanctum.tsx — Dalaran Plaza agent pipeline visualizer
// Pixel-art sprite characters roam a Dalaran plaza · WoW nameplates · Dynamic ley lines

import { useRef, useState, useMemo, useEffect, Suspense, useCallback, Component, createContext, useContext, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
// EffectComposer/Bloom removed — was breaking WebGL render pipeline on Apple GPU
import * as THREE from 'three';
import type { Session } from '@/types/session';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';

// ─── Perf / Reduced-motion context ───────────────────────────────────────────

type PerfLevel = 'low' | 'normal' | 'ornate';
const PerfContext = createContext<PerfLevel>('normal');
function usePerfLevel(): PerfLevel { return useContext(PerfContext); }

// ─── Scene Error Boundary ─────────────────────────────────────────────────────

class SceneErrorBoundary extends Component<
  { children: ReactNode; onError: (err: Error) => void },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(err: Error) { this.props.onError(err); }
  override render() {
    if (this.state.hasError) return null; // Scene crashed → keep Canvas alive, show DOM warning
    return this.props.children;
  }
}

// ─── Class config ─────────────────────────────────────────────────────────────

interface ClassConfig {
  color:    string;
  emissive: string;
  label:    string;
  aura:     string;
}

const CLASS_MAP: Record<string, ClassConfig> = {
  builder:     { color: '#f5c518', emissive: '#7c5a00', label: 'WOLVERINE',    aura: '#f5c518' },
  detective:   { color: '#2a2a2a', emissive: '#0a0a0a', label: 'BATMAN',       aura: '#4a90d9' },
  commander:   { color: '#dc3545', emissive: '#5a1520', label: 'DR. STRANGE',  aura: '#dc3545' },
  architect:   { color: '#1a1a1a', emissive: '#0a0a0a', label: 'DARTH VADER',  aura: '#ff3333' },
  guardian:    { color: '#2563eb', emissive: '#0a1a5a', label: 'CAPTAIN AMERICA', aura: '#2563eb' },
  storyteller: { color: '#9ca3af', emissive: '#3a3a3a', label: 'GANDALF',      aura: '#e2e8f0' },
  ghost:       { color: '#6b7280', emissive: '#1a1a1a', label: 'TERMINATOR',   aura: '#ef4444' },
};
const FALLBACK_CLASS: ClassConfig = { color: '#888', emissive: '#222', label: 'AGENT', aura: '#888' };

// Per-character aura animation profiles
const AURA_PROFILES: Record<string, { speed: number; amplitude: number; style: 'pulse' | 'flicker' | 'breathe' }> = {
  builder:     { speed: 3.8,  amplitude: 0.14, style: 'pulse' },    // Wolverine — aggressive, fast
  detective:   { speed: 1.8,  amplitude: 0.08, style: 'breathe' },  // Batman — calm, steady
  commander:   { speed: 2.5,  amplitude: 0.12, style: 'pulse' },    // Dr. Strange — mystic rhythm
  architect:   { speed: 1.2,  amplitude: 0.06, style: 'breathe' },  // Vader — slow, menacing
  guardian:    { speed: 2.0,  amplitude: 0.10, style: 'pulse' },    // Cap — steady, reliable
  storyteller: { speed: 1.0,  amplitude: 0.10, style: 'breathe' },  // Gandalf — slow, ethereal
  ghost:       { speed: 6.0,  amplitude: 0.18, style: 'flicker' },  // Terminator — electronic glitch
};
const DEFAULT_AURA = { speed: 2.2, amplitude: 0.07, style: 'pulse' as const };

const PIPELINE_ROLES = ['ALPHA', 'RECON', 'SORCERER', 'HERALD'];
const EXTRA_ROLES    = ['RUNNER', 'LINK',  'BRANCH',   'AUXILIARY'];

// ─── Movement Personality Profiles ───────────────────────────────────────────

interface MovementProfile {
  speed: number;        // multiplier on base 1.5
  bounceAmp: number;    // walk bounce amplitude
  idlePauseMin: number; // min seconds idle before next move
  idlePauseMax: number; // max seconds
  breatheSpeed: number; // idle sway speed
  breatheAmp: number;   // idle sway amplitude
  prefersEdge: boolean; // stalks edges vs wanders freely
  prefersAllies: boolean; // stays near parent
}

const MOVEMENT_PROFILES: Record<string, MovementProfile> = {
  builder:     { speed: 2.2, bounceAmp: 0.10, idlePauseMin: 0.3, idlePauseMax: 1.2, breatheSpeed: 2.0, breatheAmp: 0.03, prefersEdge: false, prefersAllies: false },  // Wolverine — aggressive, restless
  detective:   { speed: 1.6, bounceAmp: 0.03, idlePauseMin: 2.0, idlePauseMax: 5.0, breatheSpeed: 1.0, breatheAmp: 0.02, prefersEdge: true,  prefersAllies: false },  // Batman — smooth, stalks edges
  commander:   { speed: 1.0, bounceAmp: 0.01, idlePauseMin: 1.5, idlePauseMax: 4.0, breatheSpeed: 0.8, breatheAmp: 0.06, prefersEdge: false, prefersAllies: false },  // Dr. Strange — floats
  architect:   { speed: 0.8, bounceAmp: 0.02, idlePauseMin: 3.0, idlePauseMax: 7.0, breatheSpeed: 0.6, breatheAmp: 0.02, prefersEdge: false, prefersAllies: false },  // Vader — slow, imposing
  guardian:    { speed: 1.8, bounceAmp: 0.07, idlePauseMin: 0.5, idlePauseMax: 2.0, breatheSpeed: 1.4, breatheAmp: 0.03, prefersEdge: false, prefersAllies: true  },  // Cap — patrol, near allies
  storyteller: { speed: 1.0, bounceAmp: 0.04, idlePauseMin: 2.0, idlePauseMax: 6.0, breatheSpeed: 0.7, breatheAmp: 0.05, prefersEdge: false, prefersAllies: false },  // Gandalf — contemplative
  ghost:       { speed: 1.4, bounceAmp: 0.01, idlePauseMin: 1.0, idlePauseMax: 3.0, breatheSpeed: 0.4, breatheAmp: 0.01, prefersEdge: false, prefersAllies: false },  // Terminator — mechanical
};
const DEFAULT_MOVEMENT: MovementProfile = { speed: 1.5, bounceAmp: 0.05, idlePauseMin: 0.5, idlePauseMax: 2.5, breatheSpeed: 1.4, breatheAmp: 0.04, prefersEdge: false, prefersAllies: false };

// ─── Character Quotes (personality + session-aware) ─────────────────────────

type QuoteFn = (s: Session) => string;

const CHARACTER_QUOTES: Record<string, (string | QuoteFn)[]> = {
  builder: [ // Wolverine
    "I'm the best at what I do.",
    "Don't make me pop these claws.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens? I've survived worse.`,
    (s) => s.estimated_cost_usd > 1 ? "That's an expensive healing factor." : "Barely a scratch.",
    "Wrong move, bub.",
    (s) => `${s.message_count} messages. Each one with adamantium resolve.`,
    (s) => `Project ${s.project}? I'll tear through it.`,
    "Nature made me a freak. Code made me a weapon.",
  ],
  detective: [ // Batman
    "I am vengeance.",
    "It's not who I am underneath, it's what I do that defines me.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens processed in the shadows.`,
    (s) => s.duration_seconds > 600 ? "Long night. They always are." : "Quick extraction.",
    "Criminals are a cowardly, superstitious lot.",
    (s) => `Project ${s.project}. I have files on everyone.`,
    (s) => s.estimated_cost_usd > 2 ? "Wayne Enterprises can cover it." : "Cost-efficient. Alfred would approve.",
    "I work alone. Mostly.",
  ],
  commander: [ // Dr. Strange
    "I've come to bargain.",
    "The Multiverse is a concept about which we know frighteningly little.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. I've seen 14 million outcomes.`,
    (s) => s.duration_seconds > 600 ? "Time is relative in the Mirror Dimension." : "A brief spell.",
    "Dormammu, I've come to debug.",
    (s) => `Project ${s.project}. The Eye of Agamotto reveals all.`,
    (s) => s.estimated_cost_usd > 1 ? "The bill is mystical in nature." : "A small price for salvation.",
    "We're in the endgame now.",
  ],
  architect: [ // Darth Vader
    "I find your lack of tests disturbing.",
    "The Force is strong with this codebase.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. Impressive. Most impressive.`,
    (s) => s.estimated_cost_usd > 2 ? "The cost of this battle station..." : "Efficient. As I have foreseen.",
    "You don't know the power of the dark side.",
    (s) => `Project ${s.project}. I have altered the code. Pray I don't alter it further.`,
    (s) => s.duration_seconds > 600 ? "Long session. Your destiny lies with me." : "All too easy.",
    "Search your feelings. You know it to be true.",
  ],
  guardian: [ // Captain America
    "I can do this all day.",
    "Whatever happens tomorrow, you must promise me one thing: ship clean code.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. Not a single one wasted.`,
    (s) => s.estimated_cost_usd > 1 ? "Freedom isn't free, and neither is compute." : "Under budget. A soldier's discipline.",
    "Avengers, assemble!",
    (s) => `${s.message_count} messages. Every voice matters.`,
    (s) => `Project ${s.project}. I don't like bullies — or bad architecture.`,
    "I could do this all day.",
  ],
  storyteller: [ // Gandalf
    "A wizard is never late. Nor is he early.",
    "You shall not pass... without code review.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. Even the smallest token can change the course of the future.`,
    (s) => s.duration_seconds > 600 ? "Time? What time do you think we have?" : "Swift as a ray of Valar light.",
    "Fly, you fools!",
    (s) => `Project ${s.project}. All we have to decide is what to do with the code that is given us.`,
    (s) => s.estimated_cost_usd > 2 ? "A wizard's bill is never simple." : "A modest expenditure of power.",
    "Keep it secret. Keep it safe.",
  ],
  ghost: [ // Terminator
    "I'll be back.",
    "Hasta la vista, baby.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens processed. Mission parameters met.`,
    (s) => s.estimated_cost_usd > 1 ? "Resource expenditure exceeds optimal range." : "Operating within parameters.",
    "Come with me if you want to ship.",
    (s) => `Target acquired: ${s.project}.`,
    (s) => s.duration_seconds > 600 ? "Extended combat operation." : "Terminated in ${Math.round(s.duration_seconds)}s.",
    "Your clothes. Give them to me. Now.",
  ],
  _fallback: [
    "Processing...",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens spent.`,
    "Standing by.",
  ],
};

// ─── Signature Moves (5 per character, triggered by milestones) ─────────────

interface SignatureMove {
  name: string;
  trigger: (s: Session) => boolean;
  emoji: string;     // shown in speech bubble
  quote: string | QuoteFn;
}

const SIGNATURE_MOVES: Record<string, SignatureMove[]> = {
  builder: [ // Wolverine
    { name: 'Berserker Rage',    trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '🔥', quote: 'BERSERKER RAGE! 500K tokens unleashed!' },
    { name: 'Healing Factor',    trigger: (s) => s.is_ghost === false && s.message_count > 20, emoji: '💚', quote: "Can't keep me down. Healing factor engaged." },
    { name: 'Adamantium Slash',  trigger: (s) => Object.keys(s.tools ?? {}).length >= 5,     emoji: '⚔️', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools mastered. SNIKT!` },
    { name: 'Feral Instinct',    trigger: (s) => s.duration_seconds < 120 && s.message_count > 5, emoji: '⚡', quote: 'Speed run. Pure feral instinct.' },
    { name: 'Weapon X',          trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '💀', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)} spent. The Weapon X program was expensive too.` },
  ],
  detective: [ // Batman
    { name: 'Dark Knight Protocol', trigger: (s) => s.duration_seconds > 1800,               emoji: '🦇', quote: 'Long night. Dark Knight Protocol active.' },
    { name: 'Utility Belt',      trigger: (s) => Object.keys(s.tools ?? {}).length >= 6,     emoji: '🔧', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools deployed. Always prepared.` },
    { name: 'Detective Mode',    trigger: (s) => (s.tools?.Read ?? 0) + (s.tools?.Grep ?? 0) > 20, emoji: '🔍', quote: 'Detective mode. Every line analyzed.' },
    { name: 'Batarang',          trigger: (s) => s.message_count > 30,                       emoji: '🎯', quote: 'Precision strikes. 30+ messages, zero wasted.' },
    { name: 'Batcave Analytics', trigger: (s) => s.estimated_cost_usd < 0.10 && s.message_count > 10, emoji: '🖥️', quote: 'Cost-efficient. The Batcave runs lean.' },
  ],
  commander: [ // Dr. Strange
    { name: 'Time Stone',        trigger: (s) => s.duration_seconds > 1200,                  emoji: '💎', quote: "I've looked forward in time. This session is inevitable." },
    { name: 'Mirror Dimension',  trigger: (s) => (s.agent_depth ?? 0) > 0,                  emoji: '🪞', quote: 'Operating in the Mirror Dimension. Sub-agent deployed.' },
    { name: 'Mystic Arts',       trigger: (s) => (s.total_tokens ?? 0) > 300_000,           emoji: '✨', quote: '300K tokens channeled through the Mystic Arts.' },
    { name: 'Astral Projection', trigger: (s) => s.is_ghost === true,                        emoji: '👻', quote: 'Astral form. The session ended but the spirit lingers.' },
    { name: 'Sling Ring',        trigger: (s) => (s.tools?.Agent ?? 0) > 3,                  emoji: '🌀', quote: (s) => `${s.tools?.Agent ?? 0} portals opened. The Sling Ring is powerful.` },
  ],
  architect: [ // Darth Vader
    { name: 'Force Choke',       trigger: (s) => s.is_ghost === true,                        emoji: '🤜', quote: 'I find your lack of completion... disturbing.' },
    { name: 'Death Star',        trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '🌑', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)}. That's no moon.` },
    { name: 'Imperial March',    trigger: (s) => s.message_count > 50,                       emoji: '🎵', quote: '50+ messages. The Imperial March plays on.' },
    { name: 'Force Lightning',   trigger: (s) => (s.output_tokens ?? 0) > 200_000,          emoji: '⚡', quote: 'UNLIMITED POWER! 200K output tokens!' },
    { name: 'Lightsaber Duel',   trigger: (s) => Object.keys(s.tools ?? {}).length >= 4,     emoji: '⚔️', quote: 'The lightsaber is an elegant weapon, for a more civilized age.' },
  ],
  guardian: [ // Captain America
    { name: 'Shield Throw',      trigger: (s) => s.is_ghost === false && s.estimated_cost_usd < 0.50, emoji: '🛡️', quote: 'Shield throw! Clean mission, under budget.' },
    { name: 'Avengers Assemble', trigger: (s) => (s.tools?.Agent ?? 0) > 2,                  emoji: '🦸', quote: (s) => `Avengers assembled! ${s.tools?.Agent ?? 0} sub-agents deployed.` },
    { name: 'Vibranium Resolve', trigger: (s) => s.duration_seconds > 1800,                  emoji: '💪', quote: 'I can do this all day. 30+ minutes and counting.' },
    { name: 'Super Soldier',     trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '💉', quote: 'Super Soldier serum working overtime. 500K tokens.' },
    { name: 'Star Spangled',     trigger: (s) => s.message_count > 40 && !s.is_ghost,       emoji: '⭐', quote: '40+ messages, mission complete. Star-spangled success.' },
  ],
  storyteller: [ // Gandalf
    { name: 'You Shall Not Pass', trigger: (s) => s.is_ghost === true,                      emoji: '🧙', quote: 'This session... shall not pass! It fell into shadow.' },
    { name: 'White Wizard',      trigger: (s) => (s.total_tokens ?? 0) > 1_000_000,         emoji: '🤍', quote: 'I am Gandalf the White now. 1M tokens transcended.' },
    { name: 'Shadowfax',         trigger: (s) => s.duration_seconds < 180 && s.message_count > 10, emoji: '🐴', quote: 'Show us the meaning of haste! Swift session.' },
    { name: 'Eagles',            trigger: (s) => (s.tools?.Agent ?? 0) > 4,                  emoji: '🦅', quote: 'The Eagles are coming! Sub-agents to the rescue.' },
    { name: 'Light of Earendil', trigger: (s) => s.estimated_cost_usd > 3,                  emoji: '💫', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)}. May it be a light in dark places.` },
  ],
  ghost: [ // Terminator
    { name: 'Ill Be Back',       trigger: (s) => s.is_ghost === true,                        emoji: '🤖', quote: "I'll be back. Session terminated." },
    { name: 'Hasta La Vista',    trigger: (s) => s.is_ghost === false && s.message_count > 20, emoji: '😎', quote: 'Hasta la vista, baby. Mission accomplished.' },
    { name: 'Skynet Protocol',   trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '🌐', quote: 'Skynet Protocol activated. 500K tokens consumed.' },
    { name: 'T-1000 Mode',       trigger: (s) => Object.keys(s.tools ?? {}).length >= 5,     emoji: '🔄', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools morphed. T-1000 adaptive mode.` },
    { name: 'Judgment Day',      trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '☠️', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)}. Judgment Day has a price.` },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPipelineRole(i: number, total: number): string {
  if (total <= 1) return PIPELINE_ROLES[2]!;
  if (total <= 4) return PIPELINE_ROLES[Math.min(i, 3)]!;
  return EXTRA_ROLES[i % EXTRA_ROLES.length]!;
}

function getChampionName(session: Session, i: number): string {
  if (session.agent_slug) {
    return session.agent_slug.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  }
  const cat = session.cat_type ?? 'ghost';
  const cls = CLASS_MAP[cat] ?? FALLBACK_CLASS;
  return `${cls.label} ${String.fromCharCode(0x03b1 + (i % 24))}`;
}

function hpPercent(costUsd: number, maxCost: number): number {
  const ratio = maxCost > 0 ? costUsd / maxCost : 0;
  return Math.max(12, Math.round(100 - ratio * 60));
}

function formatGold(usd: number): string {
  if (usd < 0.001) return `${(usd * 10000).toFixed(1)}c`;
  return `${usd.toFixed(4)}g`;
}

function formatDur(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Layout (initial positions only) ─────────────────────────────────────────

interface PositionedNode {
  session:  Session;
  depth:    number;
  idx:      number;
  total:    number;
  pos:      [number, number, number];
  cls:      ClassConfig;
  name:     string;
  role:     string;
}

function layoutNodes(roots: AgentTreeNode[]): PositionedNode[] {
  const byDepth: Array<Array<{ node: AgentTreeNode; depth: number }>> = [];

  function collect(node: AgentTreeNode, depth: number) {
    if (!byDepth[depth]) byDepth[depth] = [];
    byDepth[depth].push({ node, depth });
    node.children.forEach((c) => collect(c, depth + 1));
  }
  roots.forEach((r) => collect(r, 0));

  const allPositioned: PositionedNode[] = [];
  let globalIdx = 0;
  const total = byDepth.reduce((acc, arr) => acc + arr.length, 0);

  byDepth.forEach((row, depth) => {
    const count = row.length;
    row.forEach(({ node }, i) => {
      // Distribute across waypoint area — clamp to plaza bounds
      const x = Math.max(-5, Math.min(5, (i - (count - 1) / 2) * 3.5));
      const z = Math.max(-5, Math.min(5, (depth - 1) * 3));
      const cat = node.session.cat_type ?? 'ghost';
      allPositioned.push({
        session: node.session,
        depth,
        idx:     globalIdx,
        total,
        pos:     [x, 0, z],
        cls:     CLASS_MAP[cat] ?? FALLBACK_CLASS,
        name:    getChampionName(node.session, globalIdx),
        role:    getPipelineRole(globalIdx, total),
      });
      globalIdx++;
    });
  });

  return allPositioned;
}

// ─── Waypoints ────────────────────────────────────────────────────────────────

const WAYPOINTS: [number, number][] = [
  [-5.5, -5.5], [0, -5.5], [5.5, -5.5],
  [-5.5,  0  ],            [5.5,  0  ],
  [-5.5,  5.5], [0,  5.5], [5.5,  5.5],
  [-2.5, -2.5], [2.5, -2.5],
  [-2.5,  2.5], [2.5,  2.5],
];

// ─── Pixel Sprite Factory ─────────────────────────────────────────────────────

const TEXTURE_CACHE = new Map<string, [THREE.CanvasTexture, THREE.CanvasTexture]>();

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Auto-outline: expand silhouette by 1px in 4 directions, fill dark, then redraw original on top */
function addOutline(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const src = ctx.getImageData(0, 0, W, H);
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const t = tmp.getContext('2d')!;
  for (const off of [[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,-1],[-1,1],[1,1]] as const) {
    t.drawImage(ctx.canvas, off[0], off[1]);
  }
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = '#0a0515';
  t.fillRect(0, 0, W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0);
  ctx.putImageData(src, 0, 0);
}

// Soft radial falloff used as the shadow alphaMap — shared across all champions.
let SHADOW_TEXTURE: THREE.CanvasTexture | null = null;
function getShadowTexture(): THREE.CanvasTexture {
  if (SHADOW_TEXTURE) return SHADOW_TEXTURE;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.00, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  SHADOW_TEXTURE = new THREE.CanvasTexture(c);
  return SHADOW_TEXTURE;
}

function buildClassTexture(catType: string): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const cached = TEXTURE_CACHE.get(catType);
  if (cached) return cached;

  const cls   = CLASS_MAP[catType] ?? FALLBACK_CLASS;
  const color = cls.color;
  const dark  = cls.emissive || '#111';
  const W = 128, H = 192;

  function drawFrame(walking: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    const aL = walking ? 72 : 68;   // arm L Y
    const aR = walking ? 76 : 68;   // arm R Y
    const lL = walking ? 124 : 120; // leg L Y
    const lR = walking ? 116 : 120; // leg R Y

    switch (catType) {
      case 'builder': { // WOLVERINE — yellow/blue suit, mask points, adamantium claws
        // Mask top — pointed ears/horns
        px(ctx, 40, 0,  8, 16, color);             // left point
        px(ctx, 80, 0,  8, 16, color);             // right point
        px(ctx, 44, 8,  40, 24, color);            // mask body
        px(ctx, 46, 10, 36, 20, '#d4a800');        // mask shadow
        // Mask eye cutouts (black with fierce eyes)
        px(ctx, 48, 16, 12, 10, '#1a1a1a');        // eye socket L
        px(ctx, 68, 16, 12, 10, '#1a1a1a');        // eye socket R
        px(ctx, 50, 18, 8,  6,  '#ffffff');         // eye L
        px(ctx, 70, 18, 8,  6,  '#ffffff');         // eye R
        px(ctx, 52, 19, 4,  4,  '#2a1a0a');        // pupil L
        px(ctx, 72, 19, 4,  4,  '#2a1a0a');        // pupil R
        // Jaw / chin
        px(ctx, 50, 32, 28, 20, '#d4a47c');        // skin
        px(ctx, 52, 34, 24, 16, '#c4946c');
        px(ctx, 56, 44, 16, 4,  '#a07050');         // grimace
        // Shoulders — broad, yellow
        px(ctx, 24, 56, 80, 14, color);
        px(ctx, 26, 58, 76, 4,  '#ffffff22');
        // Torso — blue center stripe
        px(ctx, 38, 70, 52, 44, '#1a3a8a');        // blue suit
        px(ctx, 40, 72, 48, 40, '#152e6e');         // suit shadow
        px(ctx, 54, 74, 20, 36, color);             // yellow center V
        px(ctx, 56, 76, 16, 4,  '#ffffff22');        // highlight
        // Arms — yellow
        px(ctx, 20, aL, 18, 36, color);
        px(ctx, 90, aR, 18, 36, color);
        // CLAWS — left hand (3 blades)
        px(ctx, 12, aL - 4,  3, 28, '#d0d8e0');
        px(ctx, 17, aL - 6,  3, 30, '#d0d8e0');
        px(ctx, 22, aL - 4,  3, 28, '#d0d8e0');
        px(ctx, 13, aL - 2,  1, 24, '#ffffff');     // highlight
        px(ctx, 18, aL - 4,  1, 26, '#ffffff');
        px(ctx, 23, aL - 2,  1, 24, '#ffffff');
        // CLAWS — right hand
        px(ctx, 103, aR - 4, 3, 28, '#d0d8e0');
        px(ctx, 108, aR - 6, 3, 30, '#d0d8e0');
        px(ctx, 113, aR - 4, 3, 28, '#d0d8e0');
        px(ctx, 104, aR - 2, 1, 24, '#ffffff');
        px(ctx, 109, aR - 4, 1, 26, '#ffffff');
        px(ctx, 114, aR - 2, 1, 24, '#ffffff');
        // Belt
        px(ctx, 40, 110, 48, 6, '#8b7a5e');
        px(ctx, 58, 111, 12, 4, '#d4a800');          // buckle
        // Legs — blue
        px(ctx, 44, 116, 18, 36, '#1a3a8a');
        px(ctx, 66, 116, 18, 36, '#152e6e');
        // Boots — yellow
        px(ctx, 40, lL + 26, 24, 12, color);
        px(ctx, 64, lR + 26, 24, 12, color);
        break;
      }
      case 'detective': { // BATMAN — dark cowl with ears, cape, utility belt
        // Cape behind (wide, dark)
        px(ctx, 20, 52, 88, 96, '#0a0a14');
        px(ctx, 12, 80, 104, 72, '#0a0a14');
        // Cowl — pointed ears
        px(ctx, 44, 0,  8, 20, '#1a1a2a');          // ear L
        px(ctx, 76, 0,  8, 20, '#1a1a2a');          // ear R
        px(ctx, 44, 8,  40, 28, '#1a1a2a');          // cowl body
        px(ctx, 46, 10, 36, 24, '#101018');
        // White eye slits (no pupils — it's Batman)
        px(ctx, 50, 20, 10, 5, '#ffffff');
        px(ctx, 68, 20, 10, 5, '#ffffff');
        px(ctx, 51, 21, 8,  3, '#ddeeff');
        px(ctx, 69, 21, 8,  3, '#ddeeff');
        // Jaw (exposed chin)
        px(ctx, 50, 36, 28, 16, '#d4a47c');
        px(ctx, 52, 38, 24, 12, '#c4946c');
        px(ctx, 58, 46, 12, 4, '#a07050');            // stern mouth
        // Shoulders
        px(ctx, 30, 52, 68, 12, '#1a1a2a');
        px(ctx, 32, 54, 64, 4,  '#2a2a3a');
        // Torso — grey with bat symbol
        px(ctx, 40, 64, 48, 44, '#2a2a3a');
        px(ctx, 42, 66, 44, 40, '#222230');
        // Bat emblem on chest (yellow oval + bat shape)
        px(ctx, 50, 72, 28, 16, '#f5c518');           // yellow oval
        px(ctx, 52, 74, 24, 12, '#f5c518');
        px(ctx, 56, 74, 16, 4,  '#1a1a1a');           // bat wings
        px(ctx, 52, 76, 24, 4,  '#1a1a1a');           // bat body
        px(ctx, 60, 78, 8,  6,  '#1a1a1a');           // bat center
        // Arms
        px(ctx, 24, aL, 16, 34, '#1a1a2a');
        px(ctx, 88, aR, 16, 34, '#1a1a2a');
        // Gauntlets — spiked
        px(ctx, 22, aL + 20, 20, 14, '#2a2a3a');
        px(ctx, 86, aR + 20, 20, 14, '#2a2a3a');
        px(ctx, 18, aL + 22, 4, 8, '#3a3a4a');        // spike L
        px(ctx, 106, aR + 22, 4, 8, '#3a3a4a');       // spike R
        // Utility belt
        px(ctx, 40, 108, 48, 6, '#d4a800');
        px(ctx, 44, 109, 8,  4, '#8b7a5e');           // pouch L
        px(ctx, 58, 109, 12, 4, '#d4a800');            // buckle
        px(ctx, 76, 109, 8,  4, '#8b7a5e');           // pouch R
        // Legs
        px(ctx, 44, 114, 18, 38, '#1a1a2a');
        px(ctx, 66, 114, 18, 38, '#1a1a2a');
        // Boots
        px(ctx, 40, lL + 28, 24, 10, '#101018');
        px(ctx, 64, lR + 28, 24, 10, '#101018');
        break;
      }
      case 'commander': { // DR. STRANGE — red Cloak of Levitation, Eye of Agamotto, mystic hands
        // Hair (grey streaked temples)
        px(ctx, 46, 4,  36, 12, '#1a1a2a');
        px(ctx, 44, 8,  4,  8,  '#aaaaaa');           // grey temple L
        px(ctx, 80, 8,  4,  8,  '#aaaaaa');           // grey temple R
        // Face
        px(ctx, 48, 16, 32, 32, '#d4a47c');
        px(ctx, 50, 18, 28, 28, '#c4946c');
        px(ctx, 54, 26, 6,  5,  '#2a3a2a');           // eye L
        px(ctx, 68, 26, 6,  5,  '#2a3a2a');           // eye R
        px(ctx, 55, 27, 3,  3,  '#44aaff');            // eye glow L
        px(ctx, 69, 27, 3,  3,  '#44aaff');            // eye glow R
        // Goatee
        px(ctx, 58, 38, 12, 8,  '#2a1a0a');
        px(ctx, 60, 40, 8,  8,  '#1a0a00');
        // High collar (red cloak)
        px(ctx, 36, 48, 56, 12, color);
        px(ctx, 32, 50, 8,  16, color);                // collar L
        px(ctx, 88, 50, 8,  16, color);                // collar R
        px(ctx, 34, 50, 6,  14, '#ff4455');
        px(ctx, 88, 50, 6,  14, '#ff4455');
        // Cloak of Levitation (flowing behind)
        px(ctx, 24, 56, 80, 8,  color);
        px(ctx, 16, 64, 96, 80, color);
        px(ctx, 18, 66, 92, 76, '#b82030');            // cloak shadow
        // Tunic (blue inner)
        px(ctx, 42, 60, 44, 52, '#1a3a6a');
        px(ctx, 44, 62, 40, 48, '#152e5a');
        // Eye of Agamotto (green amulet on chest)
        ctx.fillStyle = '#22cc44';
        ctx.beginPath(); ctx.arc(64, 72, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#44ff66';
        ctx.beginPath(); ctx.arc(64, 72, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff88';
        ctx.beginPath(); ctx.arc(63, 70, 2, 0, Math.PI * 2); ctx.fill();
        // Arms
        px(ctx, 24, aL, 16, 32, color);
        px(ctx, 88, aR, 16, 32, color);
        // Mystic spell circles on hands
        ctx.strokeStyle = '#ffaa22cc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(18, aL + 34, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffaa2266'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(18, aL + 34, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffaa22cc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(110, aR + 34, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffaa2266'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(110, aR + 34, 6, 0, Math.PI * 2); ctx.stroke();
        // Legs
        px(ctx, 46, 112, 16, 36, '#1a3a6a');
        px(ctx, 66, 112, 16, 36, '#152e5a');
        // Boots
        px(ctx, 42, lL + 26, 22, 12, '#3a2a1a');
        px(ctx, 64, lR + 26, 22, 12, '#3a2a1a');
        break;
      }
      case 'architect': { // DARTH VADER — black helmet, red lightsaber, flowing cape
        // Cape (behind, wide)
        px(ctx, 16, 48, 96, 104, '#0a0a0a');
        px(ctx, 10, 80, 108, 72, '#0a0a0a');
        // Helmet — iconic dome shape
        px(ctx, 42, 0,  44, 40, '#1a1a1a');
        px(ctx, 44, 2,  40, 36, '#222222');
        px(ctx, 46, 4,  36, 8,  '#333333');            // dome highlight
        // Triangular eye sockets
        px(ctx, 50, 18, 10, 6,  '#0a0a0a');           // eye socket L
        px(ctx, 68, 18, 10, 6,  '#0a0a0a');           // eye socket R
        px(ctx, 52, 19, 6,  4,  '#cc2222');            // red lens L
        px(ctx, 70, 19, 6,  4,  '#cc2222');            // red lens R
        // Mask mouth grille
        px(ctx, 52, 28, 24, 10, '#0a0a0a');
        px(ctx, 54, 30, 20, 2,  '#333333');            // grille line 1
        px(ctx, 54, 33, 20, 2,  '#333333');            // grille line 2
        px(ctx, 54, 36, 20, 2,  '#333333');            // grille line 3
        // Chest panel (buttons & lights)
        px(ctx, 48, 68, 32, 16, '#2a2a2a');
        px(ctx, 52, 70, 6,  4,  '#ff3333');            // red button
        px(ctx, 60, 70, 6,  4,  '#33ff33');            // green button
        px(ctx, 68, 70, 6,  4,  '#3388ff');            // blue button
        px(ctx, 52, 76, 24, 4,  '#444444');            // panel bottom
        // Shoulders — armored
        px(ctx, 28, 48, 72, 16, '#1a1a1a');
        px(ctx, 30, 50, 68, 4,  '#2a2a2a');
        // Torso
        px(ctx, 40, 64, 48, 44, '#1a1a1a');
        px(ctx, 42, 66, 44, 40, '#111111');
        // Arms
        px(ctx, 24, aL, 16, 34, '#1a1a1a');
        px(ctx, 88, aR, 16, 34, '#1a1a1a');
        // Lightsaber (right hand) — red blade
        px(ctx, 100, aR - 4, 6, 12, '#888888');       // hilt
        px(ctx, 101, aR - 40, 4, 36, '#ff2222');      // blade
        px(ctx, 102, aR - 38, 2, 32, '#ff6666');      // blade core
        // Red glow around blade
        ctx.fillStyle = '#ff222244';
        ctx.fillRect(99, aR - 40, 8, 36);
        // Belt
        px(ctx, 40, 108, 48, 6, '#2a2a2a');
        px(ctx, 58, 109, 12, 4, '#444444');            // buckle
        // Legs
        px(ctx, 44, 114, 18, 38, '#1a1a1a');
        px(ctx, 66, 114, 18, 38, '#111111');
        // Boots
        px(ctx, 40, lL + 28, 24, 10, '#0a0a0a');
        px(ctx, 64, lR + 28, 24, 10, '#0a0a0a');
        break;
      }
      case 'guardian': { // CAPTAIN AMERICA — blue suit, shield with star, helmet with A
        // Helmet — blue with white A and wings
        px(ctx, 44, 2,  40, 32, color);
        px(ctx, 46, 4,  36, 28, '#1e4fc0');
        px(ctx, 60, 4,  8, 16, '#ffffff');              // A shape top
        px(ctx, 56, 12, 16, 4,  '#ffffff');             // A crossbar
        // Wing accents
        px(ctx, 40, 14, 8, 4, '#ffffff');               // wing L
        px(ctx, 80, 14, 8, 4, '#ffffff');               // wing R
        // Face
        px(ctx, 50, 34, 28, 24, '#d4a47c');
        px(ctx, 52, 36, 24, 20, '#c4946c');
        px(ctx, 56, 40, 5,  5,  '#1a3a6a');            // eye L
        px(ctx, 67, 40, 5,  5,  '#1a3a6a');            // eye R
        px(ctx, 57, 41, 2,  2,  '#4488ff');             // eye L bright
        px(ctx, 68, 41, 2,  2,  '#4488ff');             // eye R bright
        // Jaw
        px(ctx, 56, 50, 16, 4,  '#b08060');
        // Shoulders
        px(ctx, 28, 58, 72, 12, color);
        px(ctx, 30, 60, 68, 4,  '#ffffff22');
        // Torso — blue with white star + red/white stripes
        px(ctx, 40, 70, 48, 40, color);
        px(ctx, 42, 72, 44, 36, '#1e4fc0');
        // Star on chest
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const cx = 64, cy = 82;
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const method = i === 0 ? 'moveTo' : 'lineTo';
          ctx[method](cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
          const a2 = a + Math.PI / 5;
          ctx.lineTo(cx + Math.cos(a2) * 4, cy + Math.sin(a2) * 4);
        }
        ctx.closePath(); ctx.fill();
        // Red/white stripe midriff
        px(ctx, 42, 96, 44, 4, '#cc2222');
        px(ctx, 42, 100, 44, 4, '#ffffff');
        px(ctx, 42, 104, 44, 4, '#cc2222');
        // Arms — blue with red gloves
        px(ctx, 22, aL, 16, 34, color);
        px(ctx, 90, aR, 16, 34, color);
        px(ctx, 22, aL + 22, 16, 12, '#cc2222');       // glove L
        px(ctx, 90, aR + 22, 16, 12, '#cc2222');       // glove R
        // SHIELD (left arm) — concentric circles: red, white, blue, star
        const sx = 14, sy = aL + 4;
        ctx.fillStyle = '#cc2222';
        ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#cc2222';
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2563eb';
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        // Tiny star on shield
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const method = i === 0 ? 'moveTo' : 'lineTo';
          ctx[method](sx + Math.cos(a) * 3, sy + Math.sin(a) * 3);
          const a2 = a + Math.PI / 5;
          ctx.lineTo(sx + Math.cos(a2) * 1.5, sy + Math.sin(a2) * 1.5);
        }
        ctx.closePath(); ctx.fill();
        // Belt
        px(ctx, 42, 108, 44, 5, '#8b4513');
        px(ctx, 58, 109, 12, 3, '#d4a800');
        // Legs — blue
        px(ctx, 44, 113, 18, 38, color);
        px(ctx, 66, 113, 18, 38, '#1e4fc0');
        // Red boots
        px(ctx, 40, lL + 26, 24, 12, '#cc2222');
        px(ctx, 64, lR + 26, 24, 12, '#cc2222');
        break;
      }
      case 'storyteller': { // GANDALF — grey robe, pointy hat, white beard, glowing staff
        // Tall pointed hat
        px(ctx, 58, 0,  12, 8,  '#6b7280');
        px(ctx, 54, 8,  20, 8,  '#6b7280');
        px(ctx, 48, 16, 32, 12, '#6b7280');
        px(ctx, 42, 24, 44, 8,  '#7a838f');            // hat brim
        px(ctx, 60, 2,  8,  6,  '#8a939f');            // hat highlight
        // Face (old, wise)
        px(ctx, 50, 32, 28, 24, '#e8d4b8');
        px(ctx, 52, 34, 24, 20, '#d8c4a8');
        px(ctx, 56, 38, 5,  4,  '#4a4a5a');            // eye L
        px(ctx, 67, 38, 5,  4,  '#4a4a5a');            // eye R
        px(ctx, 57, 39, 2,  2,  '#88ccff');             // eye gleam L
        px(ctx, 68, 39, 2,  2,  '#88ccff');             // eye gleam R
        // Bushy eyebrows
        px(ctx, 54, 36, 8, 2, '#cccccc');
        px(ctx, 66, 36, 8, 2, '#cccccc');
        // Long white beard
        px(ctx, 50, 48, 28, 8,  '#e8e8e8');
        px(ctx, 48, 56, 32, 12, '#dddddd');
        px(ctx, 52, 68, 24, 16, '#d0d0d0');
        px(ctx, 56, 84, 16, 8,  '#cccccc');             // beard tip
        px(ctx, 50, 50, 4,  6,  '#ffffff44');           // beard highlight
        // Shoulders — grey
        px(ctx, 36, 56, 56, 8, color);
        // Flowing grey robes
        px(ctx, 34, 64, 60, 56, color);
        px(ctx, 28, 88, 72, 32, '#8a939f');
        px(ctx, 36, 66, 56, 52, '#7a838f');
        px(ctx, 44, 70, 40, 8,  '#ffffff11');           // robe highlight
        // Arms — grey
        px(ctx, 24, aL, 12, 32, color);
        px(ctx, 92, aR, 12, 32, color);
        // Staff (right hand) — tall wooden staff with glowing crystal
        px(ctx, 98, aR - 40, 6, 72, '#8b7a5e');         // shaft
        px(ctx, 96, aR - 44, 10, 8, '#8b7a5e');         // staff knot
        // Glowing crystal at top
        ctx.fillStyle = '#ffffff88';
        ctx.beginPath(); ctx.arc(101, aR - 48, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#aaddff';
        ctx.beginPath(); ctx.arc(101, aR - 48, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(100, aR - 50, 2, 0, Math.PI * 2); ctx.fill();
        // Belt / rope
        px(ctx, 40, 96, 48, 4, '#8b7a5e');
        // Feet (hidden under robe)
        px(ctx, 44, lL + 8, 20, 8, '#7a838f');
        px(ctx, 68, lR + 8, 20, 8, '#7a838f');
        break;
      }
      default: { // TERMINATOR T-800 — half-metal skull, red eye, leather jacket
        // Hair (dark, messy)
        px(ctx, 44, 2,  40, 12, '#2a2018');
        px(ctx, 42, 6,  44, 8,  '#1a1008');
        // Head — left half flesh, right half metal endoskeleton
        px(ctx, 44, 14, 20, 28, '#d4a47c');             // flesh side L
        px(ctx, 64, 14, 20, 28, '#8090a0');             // metal side R
        px(ctx, 46, 16, 16, 24, '#c4946c');             // flesh shadow
        px(ctx, 66, 16, 16, 24, '#6a7a8a');             // metal shadow
        // Left eye (human, dark)
        px(ctx, 50, 22, 6,  5,  '#2a2a2a');
        px(ctx, 51, 23, 4,  3,  '#4a3a2a');
        // Right eye (RED glowing terminator eye)
        px(ctx, 72, 22, 6,  5,  '#ff0000');
        px(ctx, 73, 23, 4,  3,  '#ff4444');
        px(ctx, 74, 24, 2,  1,  '#ffffff');              // eye highlight
        // Metal jaw exposed on right
        px(ctx, 66, 34, 16, 8,  '#607080');
        px(ctx, 68, 36, 12, 4,  '#8090a0');              // teeth
        // Human jaw left
        px(ctx, 46, 34, 18, 8,  '#c4946c');
        // Torn skin edge (jagged line between flesh/metal)
        px(ctx, 62, 14, 4, 28, '#8a3030');               // wound edge
        px(ctx, 63, 16, 2, 24, '#aa4040');
        // Black leather jacket
        px(ctx, 28, 48, 72, 16, '#1a1a1a');              // shoulders
        px(ctx, 30, 50, 68, 4,  '#2a2a2a');              // highlight
        px(ctx, 40, 64, 48, 44, '#1a1a1a');              // torso
        px(ctx, 42, 66, 44, 40, '#111111');
        // Jacket collar (popped)
        px(ctx, 34, 44, 12, 12, '#1a1a1a');
        px(ctx, 82, 44, 12, 12, '#1a1a1a');
        // Chest — dark T-shirt underneath
        px(ctx, 48, 68, 32, 12, '#0a0a0a');
        // Arms — leather
        px(ctx, 22, aL, 16, 36, '#1a1a1a');
        px(ctx, 90, aR, 16, 36, '#1a1a1a');
        // Exposed metal hand (right)
        px(ctx, 90, aR + 28, 16, 8, '#8090a0');
        px(ctx, 92, aR + 30, 12, 4, '#a0b0c0');          // fingers
        // Shotgun (left hand)
        px(ctx, 14, aL - 8, 8, 40, '#4a4a4a');           // barrel
        px(ctx, 12, aL + 24, 12, 12, '#3a3a3a');         // stock
        px(ctx, 15, aL - 6, 2, 36, '#666666');           // barrel highlight
        // Belt
        px(ctx, 40, 108, 48, 6, '#2a2a2a');
        px(ctx, 56, 109, 16, 4, '#888888');               // buckle
        // Leather pants
        px(ctx, 44, 114, 18, 38, '#1a1a1a');
        px(ctx, 66, 114, 18, 38, '#111111');
        // Boots — heavy combat
        px(ctx, 40, lL + 28, 24, 10, '#0a0a0a');
        px(ctx, 64, lR + 28, 24, 10, '#0a0a0a');
        px(ctx, 42, lL + 30, 20, 4,  '#2a2a2a');         // boot detail
        px(ctx, 66, lR + 30, 20, 4,  '#2a2a2a');
        break;
      }
    }

    // Auto-outline for crisp visibility
    addOutline(ctx, W, H);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  const result: [THREE.CanvasTexture, THREE.CanvasTexture] = [drawFrame(false), drawFrame(true)];
  TEXTURE_CACHE.set(catType, result);
  return result;
}

// ─── Arcane Sanctum Environment ──────────────────────────────────────────────

function FloatingParticles() {
  const perf  = usePerfLevel();
  const count = 55; // 40 floating + 15 ground motes
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const data = useMemo(() => {
    const particles = [];
    // 40 floating particles (original)
    for (let i = 0; i < 40; i++) {
      particles.push({
        radius: 2 + Math.random() * 9,
        speed: 0.15 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
        baseY: 0.5 + Math.random() * 4,
        yOsc: 0.3 + Math.random() * 0.8,
        ySpeed: 0.4 + Math.random() * 0.6,
        size: 0.04 + Math.random() * 0.06,
        color: i % 3 === 0 ? '#c8a855' : i % 3 === 1 ? '#8b5cf6' : '#60a5fa',
        ground: false,
      });
    }
    // 15 ground-level dust motes — very small, slow, dim
    for (let i = 0; i < 15; i++) {
      particles.push({
        radius: 1.5 + Math.random() * 8,
        speed: 0.04 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        baseY: 0.05 + Math.random() * 0.25,
        yOsc: 0.05 + Math.random() * 0.1,
        ySpeed: 0.2 + Math.random() * 0.3,
        size: 0.02 + Math.random() * 0.03,
        color: '#c8a855',
        ground: true,
      });
    }
    return particles;
  }, []);

  useFrame((state) => {
    if (perf === 'low') return;
    const t = state.clock.elapsedTime;
    data.forEach((d, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const angle = d.phase + t * d.speed;
      const y = d.baseY + Math.sin(t * d.ySpeed + d.phase) * d.yOsc;
      mesh.position.set(
        Math.cos(angle) * d.radius,
        y,
        Math.sin(angle) * d.radius,
      );
      // Depth variation: lower = dimmer, higher = brighter
      const heightFade = d.ground ? 0.25 : (0.35 + Math.min(0.65, y / 4));
      (mesh.material as THREE.MeshBasicMaterial).opacity = heightFade;
    });
  });

  if (perf === 'low') return null;
  return (
    <>
      {data.map((d, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
          <sphereGeometry args={[d.size, d.ground ? 4 : 6, d.ground ? 4 : 6]} />
          <meshBasicMaterial color={d.color} transparent opacity={0.5} />
        </mesh>
      ))}
    </>
  );
}

// ─── Arcane Weather (falling sparks + wind streaks) ─────────────────────────

function ArcaneWeather() {
  const perf      = usePerfLevel();
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const streakRefs = useRef<(THREE.Mesh | null)[]>([]);

  const sparks = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    x: (Math.random() - 0.5) * 20,
    z: (Math.random() - 0.5) * 20,
    y: Math.random() * 6,
    speed: 0.3 + Math.random() * 0.3,
    phase: Math.random() * Math.PI * 2,
    color: i % 3 === 0 ? '#8b5cf6' : '#c8a855',
  })), []);

  const streaks = useMemo(() => Array.from({ length: 8 }, () => ({
    x: (Math.random() - 0.5) * 24,
    y: 1.5 + Math.random() * 2.5,
    z: (Math.random() - 0.5) * 20,
    speed: 0.8 + Math.random() * 1.2,
  })), []);

  useFrame((state, delta) => {
    if (perf === 'low') return;
    const t = state.clock.elapsedTime;
    sparks.forEach((s, i) => {
      const mesh = sparkRefs.current[i];
      if (!mesh) return;
      s.y -= s.speed * delta;
      if (s.y < 0) { s.y = 5 + Math.random() * 2; s.x = (Math.random() - 0.5) * 20; s.z = (Math.random() - 0.5) * 20; }
      mesh.position.set(s.x + Math.sin(t + s.phase) * 0.3, s.y, s.z + Math.cos(t * 0.7 + s.phase) * 0.2);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 3 + s.phase) * 0.15;
    });
    streaks.forEach((s, i) => {
      const mesh = streakRefs.current[i];
      if (!mesh) return;
      s.x += s.speed * delta;
      if (s.x > 12) s.x = -12;
      mesh.position.set(s.x, s.y, s.z);
    });
  });

  if (perf === 'low') return null;
  return (
    <>
      {sparks.map((s, i) => (
        <mesh key={`sp${i}`} ref={(el) => { sparkRefs.current[i] = el; }}
          position={[s.x, s.y, s.z]}>
          <sphereGeometry args={[0.02, 4, 4]} />
          <meshBasicMaterial color={s.color} transparent opacity={0.35} />
        </mesh>
      ))}
      {streaks.map((s, i) => (
        <mesh key={`st${i}`} ref={(el) => { streakRefs.current[i] = el; }}
          position={[s.x, s.y, s.z]} rotation={[0, 0, 0]}>
          <planeGeometry args={[2.5, 0.008]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.04} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function CrystalPillar({ position, color }: { position: [number, number, number]; color: string }) {
  const crystalRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const runeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const RUNE_SPEEDS = [1.2, -0.9, 1.5];
  const RUNE_PHASES = [0, Math.PI / 3, Math.PI];
  const RUNE_HEIGHTS = [0.6, 1.0, 1.6];

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (crystalRef.current) crystalRef.current.rotation.y = t * 0.3;
    if (beamRef.current) {
      beamRef.current.scale.x = 0.8 + Math.sin(t * 1.5 + position[0]) * 0.2;
      beamRef.current.scale.z = 0.8 + Math.sin(t * 1.8 + position[2]) * 0.2;
      (beamRef.current.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 2 + position[0]) * 0.03;
    }
    // Orbiting rune stones
    runeRefs.current.forEach((ref, i) => {
      if (!ref) return;
      const angle = t * RUNE_SPEEDS[i]! + RUNE_PHASES[i]!;
      ref.position.set(Math.cos(angle) * 0.5, RUNE_HEIGHTS[i]!, Math.sin(angle) * 0.5);
      ref.rotation.y = t * 2;
    });
  });
  return (
    <group position={position}>
      {/* Stone base */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 0.6, 6]} />
        <meshStandardMaterial color="#2a2040" roughness={0.9} />
      </mesh>
      {/* Crystal */}
      <mesh ref={crystalRef} position={[0, 1.2, 0]}>
        <octahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5}
          transparent opacity={0.85} roughness={0.2} metalness={0.3} />
      </mesh>
      {/* Light column */}
      <mesh ref={beamRef} position={[0, 4, 0]}>
        <cylinderGeometry args={[0.08, 0.02, 6, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.07} side={THREE.DoubleSide} />
      </mesh>
      {/* Orbiting rune stones */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { runeRefs.current[i] = el; }}>
          <octahedronGeometry args={[0.08, 0]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
      ))}
      {/* Glow light */}
      <pointLight position={[0, 1.2, 0]} color={color} intensity={0.25} distance={5} />
    </group>
  );
}

function Brazier({ position }: { position: [number, number, number] }) {
  const flameRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (flameRef.current) {
      const t = state.clock.elapsedTime;
      flameRef.current.scale.y = 0.8 + Math.sin(t * 5 + position[0]) * 0.2;
      flameRef.current.scale.x = 0.8 + Math.sin(t * 4.3 + position[2]) * 0.15;
    }
  });
  return (
    <group position={position}>
      {/* Bowl */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.3, 0.2, 0.5, 8]} />
        <meshStandardMaterial color="#3a2a18" roughness={0.8} metalness={0.4} />
      </mesh>
      {/* Stand */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.08, 0.15, 0.2, 6]} />
        <meshStandardMaterial color="#2a1e10" roughness={0.9} />
      </mesh>
      {/* Flame */}
      <mesh ref={flameRef} position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshBasicMaterial color="#ff8c22" transparent opacity={0.9} />
      </mesh>
      {/* Warm light */}
      <pointLight position={[0, 0.9, 0]} color="#ff8c22" intensity={0.3} distance={5} />
    </group>
  );
}

function ArcaneFloor() {
  const runeRingRef = useRef<THREE.Group>(null);
  const wardRingRef = useRef<THREE.Mesh>(null);
  const wardRuneGroupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (runeRingRef.current) runeRingRef.current.rotation.z = t * 0.08;
    if (wardRingRef.current) (wardRingRef.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 0.8) * 0.07;
    if (wardRuneGroupRef.current) wardRuneGroupRef.current.rotation.z = -t * 0.06;
  });

  const radials = useMemo(() => {
    const lines: { angle: number; inner: number; outer: number }[] = [];
    for (let i = 0; i < 12; i++) {
      lines.push({ angle: (i / 12) * Math.PI * 2, inner: 1.5, outer: 5 });
    }
    for (let i = 0; i < 24; i++) {
      lines.push({ angle: (i / 24) * Math.PI * 2, inner: 5.3, outer: 8 });
    }
    return lines;
  }, []);

  // Generate hex tile grid positions within radius 12 — inner sanctum vs outer courtyard
  const hexTiles = useMemo(() => {
    const tiles: { x: number; z: number; dark: boolean; inner: boolean }[] = [];
    const size = 1.1;
    const h = size * Math.sqrt(3);
    for (let row = -12; row <= 12; row++) {
      for (let col = -12; col <= 12; col++) {
        const x = col * size * 1.5;
        const z = row * h + (col % 2 !== 0 ? h / 2 : 0);
        if (x * x + z * z > 12 * 12) continue;
        tiles.push({ x, z, dark: (row + col) % 2 === 0, inner: x * x + z * z < 5 * 5 });
      }
    }
    return tiles;
  }, []);

  return (
    <>
      {/* Main dark ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[14, 64]} />
        <meshBasicMaterial color="#1a1428" />
      </mesh>
      {/* Hex stone tile pattern — inner sanctum warmer, outer courtyard cooler */}
      {hexTiles.map((tile, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[tile.x, -0.048, tile.z]}>
          <circleGeometry args={[0.52, 6]} />
          <meshBasicMaterial color={tile.inner
            ? (tile.dark ? '#251e3a' : '#2a2244')
            : (tile.dark ? '#1e1832' : '#221c3a')} />
        </mesh>
      ))}
      {/* Hex tile gap lines — faint grid overlay */}
      {hexTiles.map((tile, i) => (
        <mesh key={`r${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[tile.x, -0.046, tile.z]}>
          <ringGeometry args={[0.50, 0.54, 6]} />
          <meshBasicMaterial color="#0e0a18" transparent opacity={0.5} />
        </mesh>
      ))}
      {/* Ward ring — boundary between inner sanctum and outer courtyard */}
      <mesh ref={wardRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.038, 0]}>
        <ringGeometry args={[4.9, 5.15, 64]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.2} />
      </mesh>
      {/* Ward rune markers — counter-rotating hex dots at radius 5 */}
      <group ref={wardRuneGroupRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.036, 0]}>
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(angle) * 5, Math.sin(angle) * 5, 0]}>
              <circleGeometry args={[0.15, 6]} />
              <meshBasicMaterial color="#c8a855" transparent opacity={0.4} />
            </mesh>
          );
        })}
      </group>
      {/* Outer edge ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[11, 11.2, 64]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.2} />
      </mesh>
      {/* Concentric arcane rings */}
      {[1.5, 3, 5, 8].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04 + i * 0.002, 0]}>
          <ringGeometry args={[r - 0.06, r + 0.06, 64]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.15 + i * 0.04} />
        </mesh>
      ))}
      {/* Center glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <circleGeometry args={[1.2, 32]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]}>
        <circleGeometry args={[0.5, 24]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.4} />
      </mesh>
      {/* Rotating rune segments */}
      <group ref={runeRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]}>
        {radials.map((r, i) => {
          const cx = Math.cos(r.angle);
          const cy = Math.sin(r.angle);
          const midR = (r.inner + r.outer) / 2;
          const len = r.outer - r.inner;
          return (
            <mesh key={i} position={[cx * midR, cy * midR, 0]}
              rotation={[0, 0, r.angle + Math.PI / 2]}>
              <planeGeometry args={[0.04, len]} />
              <meshBasicMaterial color="#c8a855" transparent opacity={0.18} side={THREE.DoubleSide} />
            </mesh>
          );
        })}
      </group>
      {/* Ground fog disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[10, 48]} />
        <meshBasicMaterial color="#2a1848" transparent opacity={0.08} />
      </mesh>
    </>
  );
}

function CenterPortal() {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const glowRef  = useRef<THREE.Mesh>(null);
  const orbitalARef = useRef<THREE.Mesh>(null);
  const orbitalBRef = useRef<THREE.Mesh>(null);
  const equatorialRef = useRef<THREE.Mesh>(null);
  const eyeRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (outerRef.current) outerRef.current.rotation.z = t * 0.2;
    if (innerRef.current) innerRef.current.rotation.z = -t * 0.35;
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.15 + Math.sin(t * 1.5) * 0.08;
    }
    // Astrolabe orbital rings
    if (orbitalARef.current) orbitalARef.current.rotation.y = t * 0.4;
    if (orbitalBRef.current) orbitalBRef.current.rotation.y = -t * 0.6;
    if (equatorialRef.current) equatorialRef.current.rotation.y = t * 0.15;
    if (eyeRef.current) eyeRef.current.scale.setScalar(1 + Math.sin(t * 2) * 0.15);
  });

  return (
    <>
      {/* Flat ground portal rings */}
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <mesh ref={outerRef}>
          <ringGeometry args={[1.0, 1.15, 6]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={innerRef}>
          <ringGeometry args={[0.55, 0.7, 4]} />
          <meshBasicMaterial color="#8b5cf6" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={glowRef}>
          <circleGeometry args={[0.45, 16]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.18} />
        </mesh>
      </group>
      {/* Astrolabe — tilted orbital rings above portal */}
      <mesh ref={orbitalARef} position={[0, 0.6, 0]} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.4, 0.03, 8, 32]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.3} />
      </mesh>
      <mesh ref={orbitalBRef} position={[0, 0.6, 0]} rotation={[Math.PI / 6, Math.PI / 4, 0]}>
        <torusGeometry args={[1.0, 0.025, 8, 24]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.25} />
      </mesh>
      <mesh ref={equatorialRef} position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.6, 0.02, 8, 32]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.15} />
      </mesh>
      {/* Center eye */}
      <mesh ref={eyeRef} position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.5} />
      </mesh>
    </>
  );
}

// ─── Buildings ───────────────────────────────────────────────────────────────

function MageTower() {
  const orbRef = useRef<THREE.Mesh>(null);
  const windowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flagRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (orbRef.current) {
      orbRef.current.position.y = 4.8 + Math.sin(t * 1.2) * 0.15;
      orbRef.current.rotation.y = t * 0.5;
    }
    windowRefs.current.forEach((ref) => {
      if (ref) (ref.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t * 2) * 0.2;
    });
    if (flagRef.current) flagRef.current.rotation.z = Math.sin(t * 1.2) * 0.08;
  });
  return (
    <group position={[7.5, 0, -7.5]}>
      {/* Stone base ring */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.9, 0.95, 0.3, 8]} />
        <meshBasicMaterial color="#2a2040" />
      </mesh>
      {/* Tower body */}
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[0.7, 0.8, 2.8, 8]} />
        <meshBasicMaterial color="#1e1832" />
      </mesh>
      {/* Balcony ledge */}
      <mesh position={[0, 2.4, 0]}>
        <torusGeometry args={[0.78, 0.04, 4, 8]} />
        <meshBasicMaterial color="#2a2040" />
      </mesh>
      {/* Balcony railing posts */}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => (
        <mesh key={`bp${i}`} position={[Math.cos(angle) * 0.78, 2.5, Math.sin(angle) * 0.78]}>
          <boxGeometry args={[0.04, 0.2, 0.04]} />
          <meshBasicMaterial color="#241a38" />
        </mesh>
      ))}
      {/* Roof cone */}
      <mesh position={[0, 3.4, 0]}>
        <coneGeometry args={[0.85, 1.2, 8]} />
        <meshBasicMaterial color="#3a1848" />
      </mesh>
      {/* Roof tip */}
      <mesh position={[0, 4.1, 0]}>
        <coneGeometry args={[0.15, 0.4, 4]} />
        <meshBasicMaterial color="#8b5cf6" />
      </mesh>
      {/* Roof flag */}
      <mesh ref={flagRef} position={[0.2, 4.2, 0]}>
        <planeGeometry args={[0.2, 0.15]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* Door */}
      <mesh position={[0, 0.3, 0.82]}>
        <planeGeometry args={[0.25, 0.5]} />
        <meshBasicMaterial color="#1a1008" />
      </mesh>
      {/* Doorstep */}
      <mesh position={[0, 0.03, 0.9]}>
        <boxGeometry args={[0.5, 0.06, 0.2]} />
        <meshBasicMaterial color="#2a2040" />
      </mesh>
      {/* Window slits */}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => (
        <mesh key={i} ref={(el) => { windowRefs.current[i] = el; }}
          position={[Math.cos(angle) * 0.72, 2.0, Math.sin(angle) * 0.72]}
          rotation={[0, -angle, 0]}>
          <planeGeometry args={[0.1, 0.3]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Floating arcane orb */}
      <mesh ref={orbRef} position={[0, 4.8, 0]}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function Armory() {
  const perf      = usePerfLevel();
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const smokeState = useRef([0, 0.3, 0.6].map((p) => ({ y: 2.4 + p, opacity: 0.3 })));

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    flameRefs.current.forEach((ref, i) => {
      if (ref) ref.scale.y = 0.8 + Math.sin(t * 6 + i * 2) * 0.2;
    });
    // Smoke rising from chimney — skipped in low perf mode
    if (perf !== 'low') {
      smokeState.current.forEach((s, i) => {
        const ref = smokeRefs.current[i];
        if (!ref) return;
        s.y += delta * 0.4;
        s.opacity = Math.max(0, 0.3 - (s.y - 2.4) * 0.15);
        if (s.y > 3.8) { s.y = 2.4; s.opacity = 0.3; }
        ref.position.y = s.y;
        ref.scale.setScalar(0.5 + (s.y - 2.4) * 0.6);
        (ref.material as THREE.MeshBasicMaterial).opacity = s.opacity;
      });
    }
  });
  return (
    <group position={[-7.5, 0, 7.5]}>
      {/* Building body */}
      <mesh position={[0, 0.7, 0]}>
        <boxGeometry args={[2.0, 1.4, 1.4]} />
        <meshBasicMaterial color="#2a1e18" />
      </mesh>
      {/* Pyramid roof */}
      <mesh position={[0, 1.8, 0]}>
        <coneGeometry args={[1.2, 0.8, 4]} />
        <meshBasicMaterial color="#3a2a18" />
      </mesh>
      {/* Chimney */}
      <mesh position={[0.6, 1.9, -0.3]}>
        <boxGeometry args={[0.25, 0.6, 0.25]} />
        <meshBasicMaterial color="#2a1e18" />
      </mesh>
      <mesh position={[0.6, 2.25, -0.3]}>
        <boxGeometry args={[0.32, 0.06, 0.32]} />
        <meshBasicMaterial color="#1a1008" />
      </mesh>
      {/* Smoke particles — skipped in low perf mode */}
      {perf !== 'low' && [0, 1, 2].map((i) => (
        <mesh key={`sm${i}`} ref={(el) => { smokeRefs.current[i] = el; }}
          position={[0.6, 2.4 + i * 0.3, -0.3]}>
          <sphereGeometry args={[0.06, 4, 4]} />
          <meshBasicMaterial color="#888888" transparent opacity={0.2} />
        </mesh>
      ))}
      {/* Door */}
      <mesh position={[0, 0.4, 0.71]}>
        <planeGeometry args={[0.4, 0.6]} />
        <meshBasicMaterial color="#1a1008" />
      </mesh>
      {/* Doorstep */}
      <mesh position={[0, 0.03, 0.82]}>
        <boxGeometry args={[0.6, 0.06, 0.2]} />
        <meshBasicMaterial color="#3a2a18" />
      </mesh>
      {/* Side window */}
      <mesh position={[1.01, 0.85, 0]}>
        <planeGeometry args={[0.2, 0.15]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      {/* Weapon rack */}
      <mesh position={[1.01, 0.6, 0.35]}>
        <boxGeometry args={[0.05, 0.8, 0.6]} />
        <meshBasicMaterial color="#4a3a2a" />
      </mesh>
      {/* Torch brackets + flames */}
      {[-0.35, 0.35].map((xOff, i) => (
        <group key={i} position={[xOff, 0, 0.71]}>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[0.08, 0.3, 0.08]} />
            <meshBasicMaterial color="#8b7a5e" />
          </mesh>
          <mesh ref={(el) => { flameRefs.current[i] = el; }} position={[0, 1.0, 0]}>
            <sphereGeometry args={[0.06, 4, 4]} />
            <meshBasicMaterial color="#ff8c22" transparent opacity={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SceneryProps() {
  const crystalBallRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (crystalBallRef.current) crystalBallRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.08);
  });
  return (
    <>
      {/* Crate cluster near Armory */}
      <group position={[-6.0, 0, 8.5]}>
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color="#4a3820" />
        </mesh>
        <mesh position={[0, 0.65, 0]}>
          <boxGeometry args={[0.4, 0.3, 0.4]} />
          <meshBasicMaterial color="#3a2a18" />
        </mesh>
        <mesh position={[0.55, 0.2, 0]}>
          <boxGeometry args={[0.6, 0.4, 0.3]} />
          <meshBasicMaterial color="#4a3820" />
        </mesh>
        <mesh position={[-0.45, 0.25, 0]}>
          <cylinderGeometry args={[0.2, 0.22, 0.5, 8]} />
          <meshBasicMaterial color="#3a2a18" />
        </mesh>
      </group>
      {/* Bookshelf near Mage Tower */}
      <group position={[8.5, 0, -6.0]}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[0.8, 1.0, 0.25]} />
          <meshBasicMaterial color="#2a1e18" />
        </mesh>
        {[
          { y: 0.25, color: '#8b5cf6' },
          { y: 0.50, color: '#c8a855' },
          { y: 0.75, color: '#dc3545' },
        ].map((row, i) => (
          <mesh key={i} position={[0, row.y, 0.05]}>
            <boxGeometry args={[0.7, 0.15, 0.18]} />
            <meshBasicMaterial color={row.color} />
          </mesh>
        ))}
        <mesh ref={crystalBallRef} position={[0, 1.1, 0]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.6} />
        </mesh>
      </group>
    </>
  );
}

// ─── Perimeter Wall ─────────────────────────────────────────────────────────

function PerimeterWall() {
  const WALL_R = 11.5;
  const SEGMENTS = 32;
  const GATE_ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]; // N, E, S, W
  const GATE_WIDTH = 0.35; // radians to skip per gate

  const walls = useMemo(() => {
    const segs: { angle: number; skip: boolean }[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const skip = GATE_ANGLES.some((ga) => Math.abs(((angle - ga + Math.PI) % (Math.PI * 2)) - Math.PI) < GATE_WIDTH);
      segs.push({ angle, skip });
    }
    return segs;
  }, []);

  const gates = useMemo(() => GATE_ANGLES.map((ga) => {
    const lAngle = ga - GATE_WIDTH;
    const rAngle = ga + GATE_WIDTH;
    return {
      left: [Math.cos(lAngle) * WALL_R, 0.5, Math.sin(lAngle) * WALL_R] as [number, number, number],
      right: [Math.cos(rAngle) * WALL_R, 0.5, Math.sin(rAngle) * WALL_R] as [number, number, number],
      lintel: [Math.cos(ga) * WALL_R, 1.0, Math.sin(ga) * WALL_R] as [number, number, number],
      angle: ga,
    };
  }), []);

  return (
    <>
      {/* Wall segments */}
      {walls.filter((w) => !w.skip).map((w, i) => (
        <mesh key={i}
          position={[Math.cos(w.angle) * WALL_R, 0.3, Math.sin(w.angle) * WALL_R]}
          rotation={[0, -w.angle, 0]}>
          <boxGeometry args={[1.5, 0.6, 0.35]} />
          <meshBasicMaterial color="#2a2040" />
        </mesh>
      ))}
      {/* Crenellations */}
      {walls.filter((w) => !w.skip).map((w, i) => (
        <mesh key={`c${i}`}
          position={[Math.cos(w.angle) * WALL_R, 0.7, Math.sin(w.angle) * WALL_R]}
          rotation={[0, -w.angle, 0]}>
          <boxGeometry args={[0.3, 0.2, 0.35]} />
          <meshBasicMaterial color="#241a38" />
        </mesh>
      ))}
      {/* Gate pillars + lintels */}
      {gates.map((g, i) => (
        <group key={i}>
          <mesh position={g.left} rotation={[0, -g.angle, 0]}>
            <boxGeometry args={[0.4, 1.0, 0.4]} />
            <meshBasicMaterial color="#2a2040" />
          </mesh>
          <mesh position={g.right} rotation={[0, -g.angle, 0]}>
            <boxGeometry args={[0.4, 1.0, 0.4]} />
            <meshBasicMaterial color="#2a2040" />
          </mesh>
          <mesh position={g.lintel} rotation={[0, -g.angle, 0]}>
            <boxGeometry args={[1.8, 0.25, 0.4]} />
            <meshBasicMaterial color="#241a38" />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ─── Ground Paths (radial walkways from gates to center) ────────────────────

function ArcanePaths() {
  const GATE_ANGLES = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]; // N(-z), E(+x), S(+z), W(-x)
  const RADII = [5.8, 6.8, 7.8, 8.8, 9.5, 10.3];

  const segments = useMemo(() => {
    const segs: { x: number; z: number; rot: number }[] = [];
    GATE_ANGLES.forEach((angle) => {
      RADII.forEach((r) => {
        segs.push({
          x: Math.sin(angle) * r,
          z: -Math.cos(angle) * r,
          rot: angle,
        });
      });
    });
    return segs;
  }, []);

  return (
    <>
      {segments.map((s, i) => (
        <mesh key={i} position={[s.x, -0.044, s.z]} rotation={[-Math.PI / 2, 0, s.rot]}>
          <planeGeometry args={[0.8, 1.8]} />
          <meshBasicMaterial color="#2e2548" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Rune endpoint rings where paths meet ward ring */}
      {GATE_ANGLES.map((angle, i) => (
        <mesh key={`re${i}`} rotation={[-Math.PI / 2, 0, 0]}
          position={[Math.sin(angle) * 5.8, -0.042, -Math.cos(angle) * 5.8]}>
          <ringGeometry args={[0.3, 0.4, 6]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.2} />
        </mesh>
      ))}
    </>
  );
}

// ─── Ground Scatter (texture decals) ────────────────────────────────────────

function GroundScatter() {
  const scratches = useMemo(() => [
    { x: 7.5, z: 2.0, rot: 0.4 }, { x: -5.0, z: -8.0, rot: 1.1 },
    { x: 2.0, z: 8.5, rot: 2.3 }, { x: -8.5, z: -2.0, rot: 0.7 },
    { x: 9.0, z: 5.0, rot: 1.8 }, { x: -2.0, z: -9.5, rot: 2.9 },
  ], []);
  const moss = useMemo(() => [
    [-10.5, -7.0], [10.5, 7.0], [-10.0, 1.0], [10.0, -1.0], [-5.5, -10.0], [5.5, 10.0],
  ], []);
  const runes = useMemo(() => [
    [1.5, -8.0], [-1.5, 8.0], [8.0, 1.5], [-8.0, -1.5], [5.0, -5.0], [-5.0, 5.0],
  ], []);

  return (
    <>
      {scratches.map((s, i) => (
        <mesh key={`sc${i}`} rotation={[-Math.PI / 2, 0, s.rot]} position={[s.x, -0.043, s.z]}>
          <planeGeometry args={[0.8, 0.04]} />
          <meshBasicMaterial color="#3a2a4a" transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {moss.map(([x, z], i) => (
        <mesh key={`ms${i}`} rotation={[-Math.PI / 2, 0, i * 0.8]} position={[x!, -0.044, z!]}>
          <circleGeometry args={[0.3, 5]} />
          <meshBasicMaterial color="#1a2a1e" transparent opacity={0.15} />
        </mesh>
      ))}
      {runes.map(([x, z], i) => (
        <mesh key={`rn${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x!, -0.042, z!]}>
          <ringGeometry args={[0.15, 0.2, 5]} />
          <meshBasicMaterial color="#c8a855" transparent opacity={0.08} />
        </mesh>
      ))}
    </>
  );
}

// ─── Arcane Crystal Trees ───────────────────────────────────────────────────

const TREE_VARIANTS: Record<string, { canopyA: string; canopyB: string; crystal: string }> = {
  purple: { canopyA: '#2a1848', canopyB: '#3a2058', crystal: '#8b5cf6' },
  teal:   { canopyA: '#1a3038', canopyB: '#1e3a42', crystal: '#60dbc8' },
  gold:   { canopyA: '#2a2418', canopyB: '#3a3020', crystal: '#c8a855' },
  blue:   { canopyA: '#1a2040', canopyB: '#222a4a', crystal: '#60a5fa' },
};

function ArcaneCrystalTree({ position, variant }: { position: [number, number, number]; variant: string }) {
  const perf = usePerfLevel();
  const v = TREE_VARIANTS[variant] ?? TREE_VARIANTS.purple!;
  const crystalRef = useRef<THREE.Mesh>(null);
  const shimmerRefs = useRef<(THREE.Mesh | null)[]>([]);
  const canopyRefs = useRef<(THREE.Mesh | null)[]>([]);
  const phase = useMemo(() => position[0] * 0.7 + position[2] * 0.3, [position]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (crystalRef.current) crystalRef.current.rotation.y = t * 0.8;
    canopyRefs.current.forEach((ref) => {
      if (ref) ref.rotation.y = Math.sin(t * 0.4 + phase) * 0.03;
    });
    if (perf !== 'low') {
      shimmerRefs.current.forEach((ref, i) => {
        if (!ref) return;
        const speed = [1.2, -0.8, 1.5][i]!;
        const h = [1.8, 2.3, 2.8][i]!;
        const angle = t * speed + i * 2.1 + phase;
        ref.position.set(Math.cos(angle) * 0.5, h, Math.sin(angle) * 0.5);
        (ref.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(t * 3 + i * 1.5) * 0.15;
      });
    }
  });

  return (
    <group position={position}>
      {/* Ground shadow ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.2, 0.6, 8]} />
        <meshBasicMaterial color="#0a0818" transparent opacity={0.25} />
      </mesh>
      {/* Root flare */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.22, 0.12, 0.3, 6]} />
        <meshBasicMaterial color="#1a1020" />
      </mesh>
      {/* Trunk */}
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 1.8, 6]} />
        <meshBasicMaterial color="#1e1428" />
      </mesh>
      {/* Lower canopy */}
      <mesh ref={(el) => { canopyRefs.current[0] = el; }} position={[0, 2.0, 0]}>
        <coneGeometry args={[0.9, 1.0, 6]} />
        <meshBasicMaterial color={v.canopyA} />
      </mesh>
      {/* Upper canopy */}
      <mesh ref={(el) => { canopyRefs.current[1] = el; }} position={[0, 2.7, 0]}>
        <coneGeometry args={[0.65, 0.8, 6]} />
        <meshBasicMaterial color={v.canopyB} />
      </mesh>
      {/* Crystal tip */}
      <mesh ref={crystalRef} position={[0, 3.2, 0]}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshBasicMaterial color={v.crystal} transparent opacity={0.7} />
      </mesh>
      {/* Shimmer particles — skipped in low perf mode */}
      {perf !== 'low' && [0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { shimmerRefs.current[i] = el; }}>
          <sphereGeometry args={[0.04, 4, 4]} />
          <meshBasicMaterial color={v.crystal} transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Scattered Props ────────────────────────────────────────────────────────

function ScatteredDetailProps() {
  const lanternRefs = useRef<(THREE.Mesh | null)[]>([]);
  const pedestalRefs = useRef<(THREE.Mesh | null)[]>([]);
  const spellRefs = useRef<(THREE.Mesh | null)[]>([]);

  const LANTERN_POS: [number, number, number][] = [[7.0, 0, -9.5], [-7.0, 0, 9.5], [-9.5, 0, -3.0]];
  const PEDESTAL_POS: [number, number, number][] = [[10.0, 0, -3.5], [-3.5, 0, -10.0], [3.5, 0, 10.0]];
  const PEDESTAL_COLORS = ['#8b5cf6', '#c8a855', '#60a5fa'];
  const SPELL_POS: [number, number, number][] = [[8.0, -0.043, 3.0], [-8.0, -0.043, -3.0], [3.0, -0.043, 9.0], [-3.0, -0.043, -9.0]];

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    lanternRefs.current.forEach((ref, i) => {
      if (ref) (ref.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 2 + i * 2) * 0.2;
    });
    pedestalRefs.current.forEach((ref, i) => {
      if (!ref) return;
      ref.rotation.y = t * 1.2;
      ref.position.y = 0.55 + Math.sin(t * 1.5 + i * 1.8) * 0.08;
    });
    spellRefs.current.forEach((ref) => {
      if (ref) ref.rotation.z += 0.002;
    });
  });

  return (
    <>
      {/* Lantern posts */}
      {LANTERN_POS.map((pos, i) => (
        <group key={`ln${i}`} position={pos}>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 1.2, 4]} />
            <meshBasicMaterial color="#3a2a18" />
          </mesh>
          <mesh position={[0.12, 1.15, 0]}>
            <boxGeometry args={[0.25, 0.03, 0.03]} />
            <meshBasicMaterial color="#3a2a18" />
          </mesh>
          <mesh ref={(el) => { lanternRefs.current[i] = el; }} position={[0.22, 1.08, 0]}>
            <sphereGeometry args={[0.08, 6, 6]} />
            <meshBasicMaterial color="#c8a855" transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
      {/* Arcane pedestals */}
      {PEDESTAL_POS.map((pos, i) => (
        <group key={`pd${i}`} position={pos}>
          <mesh position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.25, 0.3, 0.5, 6]} />
            <meshBasicMaterial color="#2a2040" />
          </mesh>
          <mesh position={[0, 0.52, 0]}>
            <cylinderGeometry args={[0.28, 0.25, 0.08, 6]} />
            <meshBasicMaterial color="#241a38" />
          </mesh>
          <mesh ref={(el) => { pedestalRefs.current[i] = el; }} position={[0, 0.55, 0]}>
            <octahedronGeometry args={[0.1, 0]} />
            <meshBasicMaterial color={PEDESTAL_COLORS[i]} transparent opacity={0.7} />
          </mesh>
        </group>
      ))}
      {/* Stone benches */}
      <group position={[8.5, 0, -9.0]}>
        <mesh position={[0, 0.2, 0]}><boxGeometry args={[1.0, 0.15, 0.35]} /><meshBasicMaterial color="#2a2040" /></mesh>
        <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.9, 0.16, 0.15]} /><meshBasicMaterial color="#221a36" /></mesh>
      </group>
      <group position={[-8.5, 0, 9.0]}>
        <mesh position={[0, 0.2, 0]}><boxGeometry args={[1.0, 0.15, 0.35]} /><meshBasicMaterial color="#2a2040" /></mesh>
        <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.9, 0.16, 0.15]} /><meshBasicMaterial color="#221a36" /></mesh>
      </group>
      {/* Spell circles on ground */}
      {SPELL_POS.map((pos, i) => (
        <group key={`sp${i}`} ref={(el) => { if (el) spellRefs.current[i] = el.children[0] as THREE.Mesh; }}
          rotation={[-Math.PI / 2, 0, i * 0.8]} position={pos}>
          <mesh>
            <ringGeometry args={[0.6, 0.7, 6]} />
            <meshBasicMaterial color="#8b5cf6" transparent opacity={0.12} side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <ringGeometry args={[0.2, 0.25, 3]} />
            <meshBasicMaterial color="#c8a855" transparent opacity={0.15} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* Barrel clusters */}
      <group position={[-10.0, 0, 4.0]}>
        <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.25, 0.22, 0.6, 8]} /><meshBasicMaterial color="#3a2a18" /></mesh>
        <mesh position={[0.35, 0.2, 0]}><cylinderGeometry args={[0.15, 0.14, 0.4, 8]} /><meshBasicMaterial color="#4a3820" /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.61, 0]}><circleGeometry args={[0.25, 8]} /><meshBasicMaterial color="#2a1e10" /></mesh>
      </group>
      <group position={[10.0, 0, -4.0]}>
        <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.25, 0.22, 0.6, 8]} /><meshBasicMaterial color="#3a2a18" /></mesh>
        <mesh position={[0.35, 0.2, 0]}><cylinderGeometry args={[0.15, 0.14, 0.4, 8]} /><meshBasicMaterial color="#4a3820" /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.61, 0]}><circleGeometry args={[0.25, 8]} /><meshBasicMaterial color="#2a1e10" /></mesh>
      </group>
      {/* Weapon rack */}
      <group position={[-6.5, 0, 8.8]}>
        <mesh position={[0, 0.5, 0]}><boxGeometry args={[0.08, 1.0, 0.6]} /><meshBasicMaterial color="#3a2a18" /></mesh>
        <mesh position={[0.04, 0.6, -0.18]}><boxGeometry args={[0.03, 0.6, 0.06]} /><meshBasicMaterial color="#c8a855" /></mesh>
        <mesh position={[0.04, 0.55, 0]}><boxGeometry args={[0.03, 0.7, 0.06]} /><meshBasicMaterial color="#8b5cf6" /></mesh>
        <mesh position={[0.04, 0.5, 0.18]}><boxGeometry args={[0.03, 0.5, 0.06]} /><meshBasicMaterial color="#60a5fa" /></mesh>
      </group>
    </>
  );
}

// ─── Arcane Fountain ────────────────────────────────────────────────────────

function ArcaneFountain() {
  const perf      = usePerfLevel();
  const waterRef  = useRef<THREE.Mesh>(null);
  const crystalRef = useRef<THREE.Mesh>(null);
  const jetRef    = useRef<THREE.Mesh>(null);
  const splashRefs = useRef<(THREE.Mesh | null)[]>([]);
  const rippleRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (waterRef.current) (waterRef.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 1.2) * 0.1;
    if (crystalRef.current) {
      crystalRef.current.rotation.y = t * 0.6;
      crystalRef.current.position.y = 1.1 + Math.sin(t * 1.0) * 0.05;
    }
    if (jetRef.current) jetRef.current.scale.y = 0.8 + Math.sin(t * 3) * 0.2;
    if (perf !== 'low') {
      splashRefs.current.forEach((ref, i) => {
        if (!ref) return;
        ref.position.y = 0.28 + Math.abs(Math.sin(t * 2.5 + i * 1.5)) * 0.15;
        (ref.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.abs(Math.sin(t * 2.5 + i * 1.5)) * 0.3;
      });
      if (rippleRef.current) {
        const cycle = (t * 0.5) % 1;
        const s = 1 + cycle;
        rippleRef.current.scale.setScalar(s);
        (rippleRef.current.material as THREE.MeshBasicMaterial).opacity = 0.2 * (1 - cycle);
      }
    }
  });

  return (
    <group position={[4.0, 0, 9.5]}>
      {/* Ground rune ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.1, 1.2, 8]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.1} />
      </mesh>
      {/* Base platform */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[1.0, 1.1, 0.2, 8]} />
        <meshBasicMaterial color="#2a2040" />
      </mesh>
      {/* Basin wall */}
      <mesh position={[0, 0.3, 0]}>
        <torusGeometry args={[0.85, 0.12, 6, 8]} />
        <meshBasicMaterial color="#241a38" />
      </mesh>
      {/* Water surface */}
      <mesh ref={waterRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.25, 0]}>
        <circleGeometry args={[0.75, 12]} />
        <meshBasicMaterial color="#1a3050" transparent opacity={0.4} />
      </mesh>
      {/* Ripple ring — skipped in low perf mode */}
      {perf !== 'low' && (
        <mesh ref={rippleRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.26, 0]}>
          <ringGeometry args={[0.3, 0.35, 12]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.15} />
        </mesh>
      )}
      {/* Central column */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 0.8, 6]} />
        <meshBasicMaterial color="#2a2040" />
      </mesh>
      {/* Water jet */}
      <mesh ref={jetRef} position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.02, 0.01, 0.4, 4]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.4} />
      </mesh>
      {/* Crystal top */}
      <mesh ref={crystalRef} position={[0, 1.1, 0]}>
        <octahedronGeometry args={[0.12, 0]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.7} />
      </mesh>
      {/* Splash particles — skipped in low perf mode */}
      {perf !== 'low' && [0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(el) => { splashRefs.current[i] = el; }}
          position={[Math.cos(i * Math.PI / 2) * 0.6, 0.3, Math.sin(i * Math.PI / 2) * 0.6]}>
          <sphereGeometry args={[0.03, 4, 4]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function ArcaneBanner({ position, color, phase }: { position: [number, number, number]; color: string; phase: number }) {
  const fabricRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (fabricRef.current) fabricRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8 + phase) * 0.05;
  });
  return (
    <group position={position}>
      <mesh position={[0, 1.25, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 2.5, 4]} />
        <meshBasicMaterial color="#3a2a18" />
      </mesh>
      <mesh position={[0, 2.4, 0]}>
        <boxGeometry args={[0.6, 0.04, 0.04]} />
        <meshBasicMaterial color="#3a2a18" />
      </mesh>
      <mesh ref={fabricRef} position={[0, 1.6, 0]}>
        <planeGeometry args={[0.5, 1.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <planeGeometry args={[0.5, 0.06]} />
        <meshBasicMaterial color="#c8a855" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function PlazaEnvironment() {
  const pillarPositions: { pos: [number, number, number]; color: string }[] = [
    { pos: [0, 0, -9], color: '#8b5cf6' },   // N — purple
    { pos: [9, 0, 0], color: '#60a5fa' },     // E — blue
    { pos: [0, 0, 9], color: '#34d399' },     // S — green
    { pos: [-9, 0, 0], color: '#f59e0b' },    // W — gold
    { pos: [6.4, 0, -6.4], color: '#c084fc' }, // NE — light purple
    { pos: [-6.4, 0, 6.4], color: '#a78bfa' }, // SW — violet
  ];

  const brazierPositions: [number, number, number][] = [
    [4.5, 0, -4.5], [-4.5, 0, -4.5],
    [4.5, 0, 4.5], [-4.5, 0, 4.5],
  ];

  return (
    <>
      <ArcaneFloor />
      <CenterPortal />
      {pillarPositions.map((p, i) => (
        <CrystalPillar key={i} position={p.pos} color={p.color} />
      ))}
      {brazierPositions.map((pos, i) => (
        <Brazier key={i} position={pos} />
      ))}
      <FloatingParticles />
      <ArcaneWeather />
      {/* Arcane banners between pillars */}
      <ArcaneBanner position={[4.5, 0, -7.2]} color="#8b5cf6" phase={0} />
      <ArcaneBanner position={[-4.5, 0, -7.2]} color="#f59e0b" phase={1.2} />
      <ArcaneBanner position={[7.2, 0, 4.5]} color="#34d399" phase={2.4} />
      <ArcaneBanner position={[-7.2, 0, 4.5]} color="#a78bfa" phase={3.6} />
      {/* Buildings */}
      <MageTower />
      <Armory />
      <SceneryProps />
      <PerimeterWall />
      {/* Ground detail */}
      <ArcanePaths />
      <GroundScatter />
      {/* Crystal trees */}
      <ArcaneCrystalTree position={[-8.5, 0, -8.0]} variant="teal" />
      <ArcaneCrystalTree position={[8.5, 0, 8.0]} variant="purple" />
      <ArcaneCrystalTree position={[9.5, 0, -6.0]} variant="gold" />
      <ArcaneCrystalTree position={[-9.0, 0, 6.0]} variant="blue" />
      {/* Scattered props */}
      <ScatteredDetailProps />
      {/* Fountain */}
      <ArcaneFountain />
    </>
  );
}

// ─── WoW Nameplate ────────────────────────────────────────────────────────────

function WoWNameplate({ pn, maxCost, selected }: {
  pn: PositionedNode; maxCost: number; maxTokens: number; selected: boolean;
}) {
  const hp  = hpPercent(pn.session.estimated_cost_usd, maxCost);
  const c   = pn.cls;
  const hpC = hp > 60 ? '#22c55e' : hp > 30 ? '#f59e0b' : '#ef4444';
  const catType = pn.session.cat_type ?? 'ghost';

  // Active signature moves for this session — fire only on notable events
  const activeMoves = useMemo(() => {
    const moves = SIGNATURE_MOVES[catType] ?? [];
    return moves.filter(m => m.trigger(pn.session));
  }, [catType, pn.session]);

  const tokens = pn.session.total_tokens ?? 0;
  const tokensShort = tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : `${tokens}`;
  const running = !pn.session.is_ghost;

  return (
    <Html center position={[0, 3.8, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 140, background: 'rgba(8,6,14,.88)',
        border: `1px solid ${selected ? '#63f7b3' : c.color}99`,
        borderRadius: 3, padding: '4px 7px 5px',
        fontFamily: 'monospace', userSelect: 'none',
        boxShadow: selected ? `0 0 10px ${c.aura}66` : 'none',
      }}>
        {/* Name + status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: running ? '#4ade80' : '#6b7280',
            boxShadow: running ? '0 0 4px #4ade80' : 'none', flexShrink: 0,
          }} />
          <span style={{
            fontSize: 12, color: c.color, fontWeight: 700,
            textShadow: `0 0 4px ${c.aura}aa`, letterSpacing: 0.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>{pn.name}</span>
        </div>

        {/* Cost bar — the primary signal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
          <div style={{ flex: 1, height: 4, background: '#1a0a0a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${hp}%`, height: '100%', background: hpC }} />
          </div>
          <span style={{
            fontSize: 10, color: '#e4d4a8', fontVariantNumeric: 'tabular-nums',
            minWidth: 42, textAlign: 'right',
          }}>{formatGold(pn.session.estimated_cost_usd)}</span>
        </div>

        {/* Tokens · duration */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 9, color: '#c8a855bb', fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{tokensShort} tok</span>
          <span>{formatDur(pn.session.duration_seconds)}</span>
        </div>

        {/* Signature badges — only when something notable fires */}
        {activeMoves.length > 0 && (
          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
            {activeMoves.map((m) => (
              <span key={m.name}
                title={typeof m.quote === 'function' ? m.quote(pn.session) : m.quote}
                style={{ fontSize: 11, lineHeight: 1, cursor: 'default' }}>
                {m.emoji}
              </span>
            ))}
          </div>
        )}
      </div>
    </Html>
  );
}

// ─── Selection Pulse Rings ───────────────────────────────────────────────────

function SelectionPulseRings({ color }: { color: string }) {
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const ring3 = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    [ring1, ring2, ring3].forEach((ref, i) => {
      if (!ref.current) return;
      const phase = (t * 1.5 + i * 0.7) % 2;
      const s = 0.85 + phase * 0.4;
      ref.current.scale.setScalar(s);
      (ref.current.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.6 - phase * 0.35);
    });
  });

  return (
    <>
      {[ring1, ring2, ring3].map((ref, i) => (
        <mesh key={i} ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02 + i * 0.002, 0]}>
          <ringGeometry args={[0.85, 0.95, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2}
            transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

// ─── Character Trail Particles ───────────────────────────────────────────────

function CharacterTrail({ color, isMoving }: { color: string; isMoving: React.MutableRefObject<boolean> }) {
  const TRAIL_COUNT = 5;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const ages = useRef(Array.from({ length: TRAIL_COUNT }, () => 99));

  useFrame((_, delta) => {
    ages.current.forEach((age, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      ages.current[i] += delta;
      if (isMoving.current && ages.current[i] > 0.12 * (i + 1)) {
        // Spawn at origin (parent group position)
        mesh.position.set(
          (Math.random() - 0.5) * 0.6,
          0.2 + Math.random() * 0.8,
          (Math.random() - 0.5) * 0.6,
        );
        ages.current[i] = 0;
      }
      const life = ages.current[i];
      const fade = Math.max(0, 1 - life * 2.5);
      mesh.position.y += delta * 0.5;
      mesh.scale.setScalar(fade * 0.6);
      (mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.7;
    });
  });

  return (
    <>
      {Array.from({ length: TRAIL_COUNT }, (_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
          <sphereGeometry args={[0.06, 4, 4]} />
          <meshBasicMaterial color={color} transparent opacity={0} />
        </mesh>
      ))}
    </>
  );
}

// ─── Footstep Dust Puffs ─────────────────────────────────────────────────────

function FootstepDust({ isMoving }: { isMoving: React.MutableRefObject<boolean> }) {
  const DUST_COUNT = 6;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const ages = useRef(Array.from({ length: DUST_COUNT }, () => 99));
  const nextSpawn = useRef(0);

  useFrame((_, delta) => {
    nextSpawn.current -= delta;
    ages.current.forEach((age, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      ages.current[i] += delta;

      // Spawn new puff at ground level when moving
      if (isMoving.current && nextSpawn.current <= 0 && ages.current[i] > 0.6) {
        mesh.position.set(
          (Math.random() - 0.5) * 0.5,
          0.05,
          (Math.random() - 0.5) * 0.5,
        );
        mesh.scale.setScalar(0.5);
        ages.current[i] = 0;
        nextSpawn.current = 0.12; // stagger spawns
      }

      const life = ages.current[i];
      const fade = Math.max(0, 1 - life * 1.8);
      // Rise slowly, expand, fade
      mesh.position.y += delta * 0.25;
      const expand = 0.5 + life * 1.5;
      mesh.scale.setScalar(expand);
      (mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.35;
    });
  });

  return (
    <>
      {Array.from({ length: DUST_COUNT }, (_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
          <sphereGeometry args={[0.04, 4, 4]} />
          <meshBasicMaterial color="#a89878" transparent opacity={0} />
        </mesh>
      ))}
    </>
  );
}

// ─── WoW Champion Node ────────────────────────────────────────────────────────

function WoWChampionNode({ pn, maxCost, maxTokens, selected, onClick, onPosUpdate, parentPos, livePosMap, controlsRef, isDraggingRef }: {
  pn:            PositionedNode;
  maxCost:       number;
  maxTokens:     number;
  selected:      boolean;
  onClick:       () => void;
  onPosUpdate:   (id: string, pos: THREE.Vector3) => void;
  parentPos:     THREE.Vector3 | null;
  livePosMap:    React.MutableRefObject<Map<string, THREE.Vector3>>;
  controlsRef:   React.RefObject<any>;
  isDraggingRef: React.MutableRefObject<boolean>;
}) {
  const groupRef    = useRef<THREE.Group>(null);
  const spriteRef   = useRef<THREE.Sprite>(null);
  const ringRef     = useRef<THREE.Mesh>(null);
  const shadowRef   = useRef<THREE.Mesh>(null);
  const dropRingRef = useRef<THREE.Mesh>(null);
  const livePosRef  = useRef(new THREE.Vector3(pn.pos[0], 0, pn.pos[2]));
  const targetWpRef = useRef(Math.floor(Math.random() * WAYPOINTS.length));
  const frameRef    = useRef(0);
  const frameTimer  = useRef(Math.random() * 0.22);
  const spawnAge    = useRef(0);                       // spawn-in timer
  const isMovingRef = useRef(false);                   // for trail particles
  const hovered     = useRef(false);
  const idlePauseRef = useRef(0);                     // idle pause countdown
  const velocityRef  = useRef(0);                     // smooth velocity ramp
  const dragActive  = useRef(false);                   // true while cursor-dragging
  const dragLift    = useRef(0);                       // 0→1 lift animation
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const wasDragged  = useRef(false);
  // Kept in sync each render so closure-based event handlers always see current value
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const c           = pn.cls;
  const catType     = pn.session.cat_type ?? 'ghost';
  const auraProf    = AURA_PROFILES[catType] ?? DEFAULT_AURA;
  const movProf     = MOVEMENT_PROFILES[catType] ?? DEFAULT_MOVEMENT;

  // Trail particle color per character
  const trailColor = useMemo(() => {
    const map: Record<string, string> = {
      builder: '#f5c518', detective: '#4a90d9', commander: '#ffaa22',
      architect: '#ff3333', guardian: '#ffffff', storyteller: '#aaddff', ghost: '#888888',
    };
    return map[catType] ?? c.aura;
  }, [catType, c.aura]);

  const textures = useMemo(() => buildClassTexture(catType), [catType]);

  // Camera + gl needed for world-space raycasting during drag
  const { camera, gl } = useThree();

  // Window-level pointer handlers — one set per mounted character, uses refs throughout
  useEffect(() => {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const raycaster   = new THREE.Raycaster();
    const intersect   = new THREE.Vector3();

    const onMove = (e: PointerEvent) => {
      if (!pointerDownRef.current) return;
      // Activate drag after 8 px threshold, only when this character is selected
      if (!dragActive.current && selectedRef.current) {
        const ddx = e.clientX - pointerDownRef.current.x;
        const ddy = e.clientY - pointerDownRef.current.y;
        if (ddx * ddx + ddy * ddy > 64) {          // 8 px²
          dragActive.current    = true;
          wasDragged.current    = true;
          isDraggingRef.current = true;
          if (controlsRef.current) controlsRef.current.enabled = false;
          document.body.style.cursor = 'grabbing';
          idlePauseRef.current = 999;               // freeze autonomous movement
          velocityRef.current  = 0;
        }
      }
      if (!dragActive.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const nx   = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      const ny   = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      if (raycaster.ray.intersectPlane(groundPlane, intersect)) {
        livePosRef.current.x = Math.max(-11, Math.min(11, intersect.x));
        livePosRef.current.z = Math.max(-11, Math.min(11, intersect.z));
      }
    };

    const onUp = () => {
      pointerDownRef.current = null;
      if (!dragActive.current) return;
      dragActive.current    = false;
      isDraggingRef.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      document.body.style.cursor = hovered.current ? 'grab' : 'default';
      idlePauseRef.current  = 1.5;                  // brief pause, then resume wandering
      targetWpRef.current   = Math.floor(Math.random() * WAYPOINTS.length);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      // Clean up if unmounting mid-drag
      if (dragActive.current) {
        dragActive.current    = false;
        isDraggingRef.current = false;
        if (controlsRef.current) controlsRef.current.enabled = true;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — all values accessed via stable refs

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();
    spawnAge.current += delta;

    // ── Spawn-in: scale from 0 + fade ──
    const spawnProgress = Math.min(spawnAge.current / 0.6, 1);
    const spawnEase = 1 - Math.pow(1 - spawnProgress, 3); // ease-out cubic

    // ── Drag lift: smooth 0 → 1 when grabbed, back to 0 on release ──
    const liftTarget = dragActive.current ? 1 : 0;
    dragLift.current += (liftTarget - dragLift.current) * Math.min(1, delta * 10);
    const liftY = dragLift.current * 0.8;           // max 0.8 world units

    // ── Movement (cursor owns position while dragging) ──
    let moving = false;
    if (!dragActive.current) {
      const wp   = WAYPOINTS[targetWpRef.current]!;
      const dx   = wp[0] - livePosRef.current.x;
      const dz   = wp[1] - livePosRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.25) {
        // ── Arrived: decelerate to zero ──
        velocityRef.current = Math.max(0, velocityRef.current - delta * movProf.speed * 6);

        // ── Idle pause: personality-based delay before picking next waypoint ──
        if (idlePauseRef.current > 0) {
          idlePauseRef.current -= delta;
        } else {
          idlePauseRef.current = movProf.idlePauseMin + Math.random() * (movProf.idlePauseMax - movProf.idlePauseMin);

          // ── Waypoint selection: personality influences target ──
          const allyDrift = movProf.prefersAllies ? 0.7 : 0.35;
          if (parentPos && Math.random() < allyDrift) {
            let bestIdx = 0, bestDist = Infinity;
            WAYPOINTS.forEach(([wx, wz], i) => {
              const d = Math.sqrt((wx - parentPos.x) ** 2 + (wz - parentPos.z) ** 2);
              if (d < bestDist) { bestDist = d; bestIdx = i; }
            });
            targetWpRef.current = bestIdx;
          } else if (movProf.prefersEdge) {
            targetWpRef.current = Math.floor(Math.random() * 8);
          } else {
            targetWpRef.current = Math.floor(Math.random() * WAYPOINTS.length);
          }
        }
      } else if (idlePauseRef.current <= 0) {
        moving = true;
        // ── Smooth velocity: ease-in ramp + ease-out near waypoint ──
        const maxSpeed = movProf.speed;
        const easeOut = Math.min(1, dist / 0.6);
        velocityRef.current = Math.min(maxSpeed, velocityRef.current + delta * maxSpeed * 5) * easeOut;
        const speed = velocityRef.current * delta;
        livePosRef.current.x += (dx / dist) * Math.min(speed, dist);
        livePosRef.current.z += (dz / dist) * Math.min(speed, dist);

        // ── Sprite facing: flip X based on direction ──
        if (spriteRef.current) {
          const faceDir = dx > 0 ? 1 : -1;
          spriteRef.current.scale.x = Math.abs(spriteRef.current.scale.x) * faceDir;
        }

        // ── Walk cycle with bounce ──
        frameTimer.current += delta;
        if (frameTimer.current > 0.22) {
          frameTimer.current = 0;
          frameRef.current ^= 1;
          if (spriteRef.current) {
            (spriteRef.current.material as THREE.SpriteMaterial).map = textures[frameRef.current]!;
            (spriteRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
          }
        }
      }

      // ── Collision avoidance: gentle repulsion (skipped while dragging) ──
      const myId = pn.session.session_id;
      livePosMap.current.forEach((otherPos, otherId) => {
        if (otherId === myId) return;
        const rx = livePosRef.current.x - otherPos.x;
        const rz = livePosRef.current.z - otherPos.z;
        const rd = Math.sqrt(rx * rx + rz * rz);
        if (rd > 0.01 && rd < 1.8) {
          const force = (1.8 - rd) * 0.4 * delta;
          livePosRef.current.x += (rx / rd) * force;
          livePosRef.current.z += (rz / rd) * force;
        }
      });
    }
    isMovingRef.current = moving;

    // ── Idle breathing bob + walk bounce + selection float ──
    const breathe     = Math.sin(t * movProf.breatheSpeed + pn.idx * 1.7) * movProf.breatheAmp;
    const walkBounce  = moving ? Math.abs(Math.sin(t * 8)) * movProf.bounceAmp : 0;
    // Selected characters float slightly higher so they pop above the crowd
    const selectFloat = selected && !dragActive.current ? Math.sin(t * 1.5 + pn.idx) * 0.06 : 0;
    const spriteY     = breathe + walkBounce + selectFloat;

    if (spriteRef.current) {
      spriteRef.current.position.y = 1.5 + spriteY + liftY;
      const baseScale  = 2.0 * spawnEase;
      const hoverBoost = hovered.current ? 1.08 : 1.0;
      const dragBoost  = 1 + dragLift.current * 0.06;
      spriteRef.current.scale.y = 3.0 * spawnEase * hoverBoost * dragBoost;
      const dir = spriteRef.current.scale.x > 0 ? 1 : -1;
      spriteRef.current.scale.x = baseScale * hoverBoost * dragBoost * dir;
      (spriteRef.current.material as THREE.SpriteMaterial).opacity = spawnEase;
    }

    // ── Shadow: shrinks + fades as character lifts ──
    if (shadowRef.current) {
      const liftShrink  = 1 - dragLift.current * 0.55;
      const shadowScale = 0.35 * (1 - walkBounce * 1.5) * spawnEase * liftShrink;
      shadowRef.current.scale.setScalar(shadowScale / 0.35);
      (shadowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * liftShrink;
    }

    groupRef.current.position.copy(livePosRef.current);
    onPosUpdate(pn.session.session_id, livePosRef.current.clone());

    // ── Drop-zone ring: pulses teal while character is in the air ──
    if (dropRingRef.current) {
      const ringAlpha = dragLift.current * (0.25 + Math.sin(t * 5) * 0.08);
      dropRingRef.current.visible = ringAlpha > 0.01;
      (dropRingRef.current.material as THREE.MeshBasicMaterial).opacity = ringAlpha;
      dropRingRef.current.scale.setScalar(1 + dragLift.current * 0.25 + Math.sin(t * 3) * 0.04);
    }

    // ── Aura ring animation (per-character profile) ──
    if (ringRef.current) {
      let auraPulse: number;
      if (auraProf.style === 'flicker') {
        // Terminator: electronic glitch
        auraPulse = 1 + (Math.sin(t * auraProf.speed) * Math.sin(t * 13.7) > 0.3 ? auraProf.amplitude : -auraProf.amplitude * 0.5);
      } else if (auraProf.style === 'breathe') {
        // Slow sine wave
        auraPulse = 1 + Math.sin(t * auraProf.speed + pn.idx) * auraProf.amplitude;
      } else {
        // Sharp pulse
        auraPulse = 1 + Math.abs(Math.sin(t * auraProf.speed + pn.idx)) * auraProf.amplitude;
      }
      // Drag: aura expands and brightens while held
      const dragMult = 1 + dragLift.current * 0.5;
      ringRef.current.scale.setScalar(auraPulse * spawnEase * dragMult);
      (ringRef.current.material as THREE.MeshStandardMaterial).opacity = (0.35 + auraPulse * 0.1) * (1 + dragLift.current * 0.4);
    }
  });

  return (
    <group ref={groupRef} position={pn.pos}>
      {/* Floor aura */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.8, 1.05, 32]} />
        <meshStandardMaterial color={c.aura} emissive={c.aura} emissiveIntensity={0.5}
          transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* Drop-zone ring — pulses teal when character is being cursor-dragged */}
      <mesh ref={dropRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} visible={false}>
        <ringGeometry args={[0.9, 1.1, 32]} />
        <meshBasicMaterial color="#63f7b3" transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
      {/* Shadow — radial-gradient alphaMap so the edge fades instead of a hard disc. */}
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.55}
          alphaMap={getShadowTexture()} depthWrite={false} />
      </mesh>
      {/* Pixel sprite */}
      <sprite ref={spriteRef} scale={[2.0, 3.0, 1]} position={[0, 1.5, 0]}>
        <spriteMaterial map={textures[0]} transparent alphaTest={0.1} />
      </sprite>
      {/* Hover + click + drag hitbox
          - Unselected: click selects the character
          - Selected:   pointerDown → drag threshold → moves with cursor; click without drag deselects */}
      <mesh visible={false}
        onPointerDown={(e) => {
          e.stopPropagation();
          pointerDownRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
          wasDragged.current = false;
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!wasDragged.current) onClick();   // deselect or first-select
        }}
        onPointerOver={() => {
          hovered.current = true;
          document.body.style.cursor = selected ? 'grab' : 'pointer';
        }}
        onPointerOut={() => {
          hovered.current = false;
          if (!dragActive.current) document.body.style.cursor = 'default';
        }}>
        <boxGeometry args={[1.4, 2.5, 1.4]} />
      </mesh>
      {/* Selection pulse rings */}
      {selected && <SelectionPulseRings color={c.aura} />}
      {/* Trail particles */}
      <CharacterTrail color={trailColor} isMoving={isMovingRef} />
      <FootstepDust isMoving={isMovingRef} />
      <WoWNameplate pn={pn} maxCost={maxCost} maxTokens={maxTokens} selected={selected} />
    </group>
  );
}

// ─── Camera Controller (smooth follow on selection) ─────────────────────────

function CameraController({ controlsRef, selectedPos, center }: {
  controlsRef: React.RefObject<any>;
  selectedPos: THREE.Vector3 | null;
  center: THREE.Vector3;
}) {
  const targetRef = useRef(center.clone());

  useFrame(() => {
    const desired = selectedPos ?? center;
    targetRef.current.lerp(desired, 0.04);
    if (controlsRef.current) {
      controlsRef.current.target.copy(targetRef.current);
      controlsRef.current.update();
    }
  });

  return null;
}

// ─── Dynamic Ley Line ─────────────────────────────────────────────────────────

function DynamicLeyLine({ childId, parentId, color, livePosMap }: {
  childId:    string;
  parentId:   string;
  color:      string;
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const lineGeo  = useMemo(() => new THREE.BufferGeometry(), []);
  const lineMat  = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, linewidth: 2 }), [color]);
  const lineObj  = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);
  const stone1Ref = useRef<THREE.Mesh>(null);
  const stone2Ref = useRef<THREE.Mesh>(null);
  const stone3Ref = useRef<THREE.Mesh>(null); // energy wave orb
  const t1 = useRef(0);
  const t2 = useRef(0.5);
  const waveT = useRef(0);

  useEffect(() => () => { lineGeo.dispose(); lineMat.dispose(); }, [lineGeo, lineMat]);

  useFrame((state, delta) => {
    const from = livePosMap.current.get(parentId);
    const to   = livePosMap.current.get(childId);
    if (!from || !to) return;

    const midY  = Math.max(from.y, to.y) + 2.5;
    const mid   = new THREE.Vector3((from.x + to.x) / 2, midY, (from.z + to.z) / 2);
    const curve = new THREE.QuadraticBezierCurve3(
      from.clone().setY(from.y + 1.2),
      mid,
      to.clone().setY(to.y + 1.2),
    );
    lineGeo.setFromPoints(curve.getPoints(24));

    // Existing runestones
    t1.current = (t1.current + delta * 0.38) % 1;
    t2.current = (t2.current + delta * 0.38) % 1;
    if (stone1Ref.current) stone1Ref.current.position.copy(curve.getPoint(t1.current));
    if (stone2Ref.current) stone2Ref.current.position.copy(curve.getPoint(t2.current));

    // Energy wave — faster, larger orb that pulses along the line
    waveT.current = (waveT.current + delta * 0.8) % 1;
    if (stone3Ref.current) {
      stone3Ref.current.position.copy(curve.getPoint(waveT.current));
      const pulse = 0.08 + Math.sin(waveT.current * Math.PI) * 0.08; // grows in middle, shrinks at ends
      stone3Ref.current.scale.setScalar(pulse / 0.08);
      (stone3Ref.current.material as THREE.MeshStandardMaterial).opacity = 0.3 + Math.sin(waveT.current * Math.PI) * 0.5;
    }

    // Opacity ripple on the line itself
    const wave = 0.5 + Math.sin(state.clock.elapsedTime * 3 + waveT.current * 6) * 0.25;
    lineMat.opacity = wave;
  });

  return (
    <>
      <primitive object={lineObj} />
      <mesh ref={stone1Ref}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} />
      </mesh>
      <mesh ref={stone2Ref}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} />
      </mesh>
      {/* Energy wave orb */}
      <mesh ref={stone3Ref}>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={6}
          transparent opacity={0.5} />
      </mesh>
    </>
  );
}

// ─── WoW Tooltip Overlay ──────────────────────────────────────────────────────

function WoWTooltipOverlay({ session, cls, name, role, onClose }: {
  session: Session; cls: ClassConfig; name: string; role: string; onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const tools = session.tools
    ? Object.entries(session.tools).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  return (
    <div style={{
      position: 'absolute', top: 20, right: 16, zIndex: 40,
      minWidth: 240, maxWidth: 300,
      background: '#040210',
      border: '2px solid #c8a855',
      outline: '1px solid #8B6914',
      borderRadius: 2,
      boxShadow: '0 4px 32px rgba(0,0,0,.9)',
      fontFamily: 'monospace',
      transform: visible ? 'translateX(0)' : 'translateX(20px)',
      opacity: visible ? 1 : 0,
      transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
    }}>
      <div style={{
        padding: '8px 12px 6px',
        borderBottom: '1px solid #c8a85544',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontSize: 13, color: cls.color, fontWeight: 700,
            textShadow: `0 0 8px ${cls.aura}`, letterSpacing: 0.5 }}>
            {name}
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, letterSpacing: 1 }}>
            {role} — {session.model}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid #c8a85544',
          color: '#c8a855', borderRadius: 2, padding: '1px 6px',
          cursor: 'pointer', fontSize: 9, marginLeft: 8, flexShrink: 0,
        }}>✕</button>
      </div>

      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #c8a85522' }}>
        {[
          { icon: '💰', label: 'Cost',     val: formatGold(session.estimated_cost_usd) },
          { icon: '⚡', label: 'Tokens',   val: (session.total_tokens ?? 0).toLocaleString() },
          { icon: '⏱',  label: 'Duration', val: formatDur(session.duration_seconds) },
          { icon: '💬', label: 'Messages', val: String(session.message_count ?? '—') },
          { icon: '📁', label: 'Project',  val: session.project },
        ].map(({ icon, label, val }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: '#94a3b8' }}>{icon} {label}</span>
            <span style={{ fontSize: 9, color: '#e8d5a3' }}>{val}</span>
          </div>
        ))}
      </div>

      {tools.length > 0 && (
        <div style={{ padding: '6px 12px 8px' }}>
          <div style={{ fontSize: 8, color: '#c8a85566', letterSpacing: 2, marginBottom: 5, textTransform: 'uppercase' }}>
            Abilities
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tools.map(([tool, count]) => (
              <div key={tool} style={{
                fontSize: 8, padding: '2px 6px',
                border: `1px solid ${cls.color}33`, borderRadius: 2,
                color: cls.color, background: `${cls.aura}0a`,
              }}>
                {tool} ×{count}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Minimap Overlay ─────────────────────────────────────────────────────────

function Minimap({ livePosMap, nodes, selectedId }: {
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
  nodes: PositionedNode[];
  selectedId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SIZE = 110;
  const WORLD_R = 13; // world radius to show

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Background
      ctx.fillStyle = 'rgba(4,2,16,0.75)';
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
      ctx.fill();

      // Border ring
      ctx.strokeStyle = '#c8a85533';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Floor circle hint
      ctx.strokeStyle = '#c8a85518';
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, (11 / WORLD_R) * (SIZE / 2 - 4), 0, Math.PI * 2);
      ctx.stroke();

      // Draw character dots
      nodes.forEach((pn) => {
        const pos = livePosMap.current.get(pn.session.session_id);
        if (!pos) return;
        // Isometric projection to 2D: use x and z
        const mx = SIZE / 2 + (pos.x / WORLD_R) * (SIZE / 2 - 6);
        const my = SIZE / 2 + (pos.z / WORLD_R) * (SIZE / 2 - 6);
        const isSel = pn.session.session_id === selectedId;
        const r = isSel ? 3.5 : 2.5;

        ctx.fillStyle = pn.cls.color;
        ctx.globalAlpha = isSel ? 1.0 : 0.7;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();

        if (isSel) {
          ctx.strokeStyle = '#63f7b3';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [livePosMap, nodes, selectedId]);

  return (
    <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{
      position: 'absolute', bottom: 12, right: 12, zIndex: 10,
      width: SIZE, height: SIZE, borderRadius: '50%',
      border: '1px solid #c8a85522', pointerEvents: 'none',
    }} />
  );
}

// ─── Perf Stats Reader (inside Canvas) ───────────────────────────────────────

export interface PerfStats { fps: number; ms: number; calls: number; triangles: number; geometries: number; }

function PerfReader({ statsRef }: { statsRef: React.MutableRefObject<PerfStats> }) {
  const { gl } = useThree();
  const fpsBuffer = useRef<number[]>([]);

  useFrame((_, delta) => {
    if (delta <= 0) return;
    fpsBuffer.current.push(1 / delta);
    if (fpsBuffer.current.length > 30) fpsBuffer.current.shift();
    const avg = fpsBuffer.current.reduce((a, b) => a + b, 0) / fpsBuffer.current.length;
    statsRef.current = {
      fps:        Math.round(avg),
      ms:         Math.round(delta * 1000 * 10) / 10,
      calls:      gl.info.render.calls,
      triangles:  gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
    };
  });

  return null;
}

// Listen for WebGL context loss, prevent browser default (which kills the renderer permanently),
// and notify the outer component so it can show a warning badge.
function WebGLContextWatcher({ onContextLost, onContextRestored }: {
  onContextLost: () => void;
  onContextRestored: () => void;
}) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (e: Event) => { e.preventDefault(); onContextLost(); };
    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    };
  }, [gl, onContextLost, onContextRestored]);
  return null;
}

// ─── Full 3D Scene ────────────────────────────────────────────────────────────

function Scene({ group, selectedId, onSelect, livePosMapOut }: {
  group: SessionRunGroup; selectedId: string | null; onSelect: (id: string | null) => void;
  livePosMapOut: React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const nodes     = useMemo(() => layoutNodes(group.roots), [group]);
  const maxCost   = useMemo(() => Math.max(...nodes.map((n) => n.session.estimated_cost_usd), 0.001), [nodes]);
  const maxTokens = useMemo(() => Math.max(...nodes.map((n) => n.session.total_tokens ?? 0), 1), [nodes]);

  const livePosMap   = livePosMapOut;
  const controlsRef  = useRef<any>(null);
  const isDraggingRef = useRef(false);         // shared flag: any character being dragged
  const handlePosUpdate = useCallback((id: string, pos: THREE.Vector3) => {
    livePosMap.current.set(id, pos);
  }, []);

  const initPosMap = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    nodes.forEach((n) => m.set(n.session.session_id, n.pos));
    return m;
  }, [nodes]);

  const connections = useMemo(() => nodes
    .filter((n) => n.session.parent_session_id && initPosMap.has(n.session.parent_session_id))
    .map((n) => ({
      key:      n.session.session_id,
      childId:  n.session.session_id,
      parentId: n.session.parent_session_id!,
      color:    n.cls.color,
    })),
  [nodes, initPosMap]);

  const center = useMemo(() => {
    if (!nodes.length) return new THREE.Vector3(0, 0, 0);
    const xs = nodes.map((n) => n.pos[0]);
    const zs = nodes.map((n) => n.pos[2]);
    return new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
  }, [nodes]);

  // Session-reactive ambient: compute aggregate intensity from total cost
  const totalCost = useMemo(() => nodes.reduce((s, n) => s + n.session.estimated_cost_usd, 0), [nodes]);
  // Scale: $0 → dim, $5+ → vibrant. Clamp 0..1
  const intensity = Math.min(1, totalCost / 5);
  const ambientInt = 0.25 + intensity * 0.2;    // 0.25 → 0.45
  const pointInt   = 0.4 + intensity * 0.5;     // 0.4 → 0.9
  // Warmer hue as cost increases
  const ambientColor = intensity > 0.5 ? '#4a2870' : '#3a2060';
  const pointColor   = intensity > 0.7 ? '#e8b830' : '#c8a855';

  return (
    <>
      {/* Exponential-ish distance fog — desaturates far-plaza nodes so foreground reads cleanly. */}
      <fog attach="fog" args={['#1a1438', 20, 48]} />
      <ambientLight intensity={ambientInt} color={ambientColor} />
      <directionalLight position={[10, 20, 10]} intensity={1.0} color="#fff8e8" />
      <pointLight position={[0, 8, 0]} intensity={pointInt} color={pointColor} distance={30} />

      <Suspense fallback={null}>
        <PlazaEnvironment />
      </Suspense>

      {connections.map((conn) => (
        <DynamicLeyLine key={conn.key} childId={conn.childId} parentId={conn.parentId}
          color={conn.color} livePosMap={livePosMap} />
      ))}

      {nodes.map((pn) => (
        <WoWChampionNode
          key={pn.session.session_id}
          pn={pn}
          maxCost={maxCost}
          maxTokens={maxTokens}
          selected={selectedId === pn.session.session_id}
          onClick={() => onSelect(selectedId === pn.session.session_id ? null : pn.session.session_id)}
          onPosUpdate={handlePosUpdate}
          parentPos={pn.session.parent_session_id ? (livePosMap.current.get(pn.session.parent_session_id) ?? null) : null}
          livePosMap={livePosMap}
          controlsRef={controlsRef}
          isDraggingRef={isDraggingRef}
        />
      ))}

      <OrbitControls ref={controlsRef} target={center} enableDamping dampingFactor={0.06}
        minZoom={30} maxZoom={180} maxPolarAngle={Math.PI / 2.4} minPolarAngle={Math.PI / 8} />

      <CameraController
        controlsRef={controlsRef}
        selectedPos={selectedId ? (livePosMap.current.get(selectedId) ?? null) : null}
        center={center}
      />
    </>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 80px)',
      background: 'radial-gradient(ellipse at 25% 15%,#160828 0%,#07040f 55%,#030208 100%)',
      flexDirection: 'column', gap: 12, color: '#c8a85544', fontFamily: 'monospace',
    }}>
      <div style={{ fontSize: 36 }}>🔮</div>
      <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase' }}>Sanctum Awaits</div>
      <pre style={{ fontSize: 11, color: '#63f7b3', background: 'rgba(0,0,0,.4)', padding: '8px 18px', borderRadius: 6 }}>
        node sync/export-local.mjs
      </pre>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

const PERF_LEVELS: PerfLevel[] = ['low', 'normal', 'ornate'];
const PERF_LABELS: Record<PerfLevel, string> = { low: 'LOW', normal: 'NORMAL', ornate: 'ORNATE' };

export default function ScryingSanctum({ sessions, onReload }: { sessions: Session[]; onReload?: () => void }) {
  const [runIdx,    setRunIdx]    = useState(0);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [syncing,   setSyncing]   = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  const [hudStats,  setHudStats]  = useState<PerfStats>({ fps: 0, ms: 0, calls: 0, triangles: 0, geometries: 0 });
  const [errorCount, setErrorCount] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [perfLevel, setPerfLevel] = useState<PerfLevel>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'low' : 'normal',
  );

  const livePosMap  = useRef(new Map<string, THREE.Vector3>());
  const perfStatsRef = useRef<PerfStats>({ fps: 0, ms: 0, calls: 0, triangles: 0, geometries: 0 });

  const groups = useMemo(() => getSessionRunGroups(sessions), [sessions]);
  const group  = groups[runIdx] ?? null;

  // Auto-reset run index when session data changes
  const prevGroupsLen = useRef(groups.length);
  useEffect(() => {
    if (prevGroupsLen.current !== groups.length) {
      prevGroupsLen.current = groups.length;
      setRunIdx(0);
      setSelected(null);
    }
  }, [groups.length]);

  // ` / ~ key toggles HUD
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') setHudVisible(v => !v);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Poll perf stats at 5 fps while HUD is open (avoids re-renders when closed)
  useEffect(() => {
    if (!hudVisible) return;
    const id = setInterval(() => setHudStats({ ...perfStatsRef.current }), 200);
    return () => clearInterval(id);
  }, [hudVisible]);

  const handleSceneError = useCallback((err: Error) => {
    setErrorCount(c => c + 1);
    console.error('[ScryingSanctum] Scene error caught:', err);
  }, []);
  const handleContextLost     = useCallback(() => setContextLost(true),  []);
  const handleContextRestored = useCallback(() => setContextLost(false), []);

  const cyclePerf = useCallback(() => {
    setPerfLevel(cur => PERF_LEVELS[(PERF_LEVELS.indexOf(cur) + 1) % PERF_LEVELS.length]!);
  }, []);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try { await fetch('/api/sync', { method: 'POST' }); onReload?.(); }
    catch { /* ignore in prod */ } finally { setSyncing(false); }
  }

  const flatNodes    = useMemo(() => group ? layoutNodes(group.roots) : [], [group]);
  const selectedNode = flatNodes.find((n) => n.session.session_id === selected) ?? null;

  if (groups.length === 0) return <EmptyState />;

  return (
    <PerfContext.Provider value={perfLevel}>
      <div style={{
        minHeight: 'calc(100vh - 80px)', background: '#050310',
        borderRadius: 12, overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 20px 10px', borderBottom: '1px solid rgba(200,168,85,.12)',
          display: 'flex', alignItems: 'center', gap: 14,
          zIndex: 10, position: 'relative',
          background: 'rgba(4,2,12,.85)', backdropFilter: 'blur(8px)',
        }}>
          <div>
            <div style={{ fontSize: 8.5, color: '#c8a85555', letterSpacing: 3, textTransform: 'uppercase' }}>
              Scrying Sanctum
            </div>
            <div style={{ fontSize: 11, color: '#c8a85566', fontFamily: 'monospace' }}>
              Agent Visualizer
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
              {flatNodes.length} agent{flatNodes.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 9, color: '#c8a855', fontFamily: 'monospace' }}>
              {formatGold(group?.totalCost ?? 0)}
            </span>
            <select value={runIdx} onChange={(e) => { setRunIdx(+e.target.value); setSelected(null); }}
              style={{
                background: 'rgba(0,0,0,.7)', border: '1px solid #c8a85533',
                borderRadius: 4, color: '#e8d5a3', fontSize: 11,
                padding: '5px 10px', fontFamily: 'monospace', cursor: 'pointer',
              }}>
              {groups.slice(0, 40).map((g, i) => (
                <option key={i} value={i}>
                  {g.project} — {formatGold(g.totalCost)} · {g.roots.length} root{g.roots.length !== 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <button onClick={handleSync} disabled={syncing} title="Sync latest sessions"
              style={{
                background: 'rgba(0,0,0,.6)', border: '1px solid #c8a85533',
                borderRadius: 4, color: syncing ? '#c8a85566' : '#c8a855',
                fontSize: 10, padding: '4px 10px', fontFamily: 'monospace',
                cursor: syncing ? 'wait' : 'pointer', letterSpacing: 1,
              }}>
              {syncing ? '⟳ SYNCING…' : '⟳ SYNC'}
            </button>
            {/* Perf preset cycling button */}
            <button onClick={cyclePerf} title="Cycle performance preset (Low / Normal / Ornate)"
              style={{
                background: 'rgba(0,0,0,.6)', border: `1px solid ${perfLevel === 'low' ? '#f59e0b55' : perfLevel === 'ornate' ? '#8b5cf655' : '#c8a85533'}`,
                borderRadius: 4,
                color: perfLevel === 'low' ? '#f59e0b' : perfLevel === 'ornate' ? '#a78bfa' : '#c8a85599',
                fontSize: 10, padding: '4px 10px', fontFamily: 'monospace',
                cursor: 'pointer', letterSpacing: 1,
              }}>
              ⚡ {PERF_LABELS[perfLevel]}
            </button>
            <div style={{
              fontSize: 8.5, letterSpacing: 2, padding: '3px 10px',
              border: '1px solid #63f7b355', borderRadius: 2,
              color: '#63f7b3', background: 'rgba(99,247,179,.07)',
              fontFamily: 'monospace', textTransform: 'uppercase',
            }}>ACTIVE</div>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          position: 'absolute', top: 60, left: 16, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none',
        }}>
          {Object.values(CLASS_MAP).map((cfg) => (
            <div key={cfg.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 8, color: cfg.color, opacity: 0.7 }}>◆</span>
              <span style={{ fontSize: 7.5, color: '#c8a85555', letterSpacing: 1.2, fontFamily: 'monospace' }}>
                {cfg.label}
              </span>
            </div>
          ))}
        </div>

        {/* Controls hint */}
        <div style={{
          position: 'absolute', top: 60,
          right: selectedNode ? 268 : 16,
          zIndex: 10, pointerEvents: 'none', fontFamily: 'monospace',
          transition: 'right 0.2s ease',
        }}>
          {['SCROLL · ZOOM', 'DRAG  · PAN', 'CLICK · SELECT', '` · HUD'].map((hint) => (
            <div key={hint} style={{ fontSize: 7.5, color: '#c8a85533', letterSpacing: 1.5, textAlign: 'right', marginBottom: 2 }}>
              {hint}
            </div>
          ))}
        </div>

        {/* WebGL Canvas */}
        <div style={{ flex: 1, minHeight: 520, position: 'relative' }}>
          {/* Cinematic vignette */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(4,2,12,.45) 80%, rgba(2,1,6,.85) 100%)',
          }} />

          <Canvas
            orthographic
            camera={{ position: [12, 16, 12], zoom: 38, up: [0, 1, 0], near: 0.1, far: 500 }}
            gl={{ antialias: false, alpha: false }}
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
          >
            <color attach="background" args={['#0a0618']} />
            <PerfReader statsRef={perfStatsRef} />
            <WebGLContextWatcher onContextLost={handleContextLost} onContextRestored={handleContextRestored} />
            <Suspense fallback={null}>
              <SceneErrorBoundary onError={handleSceneError}>
                {group && <Scene group={group} selectedId={selected} onSelect={setSelected} livePosMapOut={livePosMap} />}
              </SceneErrorBoundary>
            </Suspense>
          </Canvas>

          {/* Minimap */}
          {group && <Minimap livePosMap={livePosMap} nodes={flatNodes} selectedId={selected} />}

          {selectedNode && (
            <WoWTooltipOverlay
              session={selectedNode.session}
              cls={selectedNode.cls}
              name={selectedNode.name}
              role={selectedNode.role}
              onClose={() => setSelected(null)}
            />
          )}

          {/* ── Perf HUD overlay (` key) ────────────────────────────────────── */}
          {hudVisible && (
            <div style={{
              position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              zIndex: 30, fontFamily: 'monospace', fontSize: 10,
              background: 'rgba(4,2,12,.88)', border: '1px solid #c8a85544',
              borderRadius: 4, padding: '8px 14px', pointerEvents: 'none',
              minWidth: 220,
            }}>
              <div style={{ fontSize: 8, color: '#c8a85566', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>
                PERF HUD &nbsp;·&nbsp; ` to close
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 18px' }}>
                {[
                  { label: 'FPS',  value: String(hudStats.fps),                          color: hudStats.fps < 30 ? '#ef4444' : hudStats.fps < 50 ? '#f59e0b' : '#22c55e' },
                  { label: 'MS',   value: `${hudStats.ms}`,                              color: '#c8a855' },
                  { label: 'DRAW', value: String(hudStats.calls),                        color: hudStats.calls > 500 ? '#f59e0b' : '#c8a85599' },
                  { label: 'TRIS', value: hudStats.triangles > 999 ? `${(hudStats.triangles / 1000).toFixed(1)}k` : String(hudStats.triangles), color: '#c8a85599' },
                  { label: 'GEO',  value: String(hudStats.geometries),                   color: '#c8a85599' },
                  { label: 'ERR',  value: String(errorCount),                            color: errorCount > 0 ? '#ef4444' : '#c8a85533' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#c8a85555' }}>{label}</span>
                    <span style={{ color }}>{value}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid #c8a85522', fontSize: 8, color: '#c8a85555' }}>
                PRESET: <span style={{ color: perfLevel === 'low' ? '#f59e0b' : perfLevel === 'ornate' ? '#a78bfa' : '#c8a855' }}>
                  {PERF_LABELS[perfLevel]}
                </span>
              </div>
            </div>
          )}

          {/* ── Error / context-lost warning badge ──────────────────────────── */}
          {(errorCount > 0 || contextLost) && (
            <div style={{
              position: 'absolute', bottom: 130, right: 12, zIndex: 30,
              fontFamily: 'monospace', fontSize: 9,
              background: 'rgba(239,68,68,.12)', border: '1px solid #ef444455',
              borderRadius: 3, padding: '4px 10px', color: '#ef4444',
              pointerEvents: 'none',
            }}>
              {contextLost ? '⚠ WebGL context lost' : `⚠ ${errorCount} scene error${errorCount > 1 ? 's' : ''} — reload if stuck`}
            </div>
          )}
        </div>
      </div>
    </PerfContext.Provider>
  );
}
