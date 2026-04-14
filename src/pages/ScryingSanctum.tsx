// ScryingSanctum.tsx — WoW MMORPG Dalaran Plaza agent pipeline visualizer
// Pixel-art sprite characters roam a Dalaran plaza · WoW nameplates · Dynamic ley lines

import { useRef, useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
// EffectComposer/Bloom removed — was breaking WebGL render pipeline on Apple GPU
import * as THREE from 'three';
import type { Session } from '@/types/session';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';

// ─── Class config ─────────────────────────────────────────────────────────────

interface ClassConfig {
  color:    string;
  emissive: string;
  label:    string;
  aura:     string;
}

const CLASS_MAP: Record<string, ClassConfig> = {
  builder:     { color: '#f59e0b', emissive: '#7c3f00', label: 'WARRIOR',      aura: '#f59e0b' },
  detective:   { color: '#34d399', emissive: '#004d2e', label: 'ROGUE',        aura: '#34d399' },
  commander:   { color: '#60a5fa', emissive: '#003566', label: 'MAGE',         aura: '#60a5fa' },
  architect:   { color: '#a78bfa', emissive: '#3b0078', label: 'WARLOCK',      aura: '#a78bfa' },
  guardian:    { color: '#fbbf24', emissive: '#5c4000', label: 'PALADIN',      aura: '#fbbf24' },
  storyteller: { color: '#e2e8f0', emissive: '#2a3040', label: 'PRIEST',       aura: '#e2e8f0' },
  ghost:       { color: '#4ade80', emissive: '#00401a', label: 'DEATH KNIGHT', aura: '#4ade80' },
};
const FALLBACK_CLASS: ClassConfig = { color: '#888', emissive: '#222', label: 'AGENT', aura: '#888' };

const PIPELINE_ROLES = ['VANGUARD', 'SCOUT', 'ARCHMAGE', 'HERALD'];
const EXTRA_ROLES    = ['RUNNER',   'LINK',  'BRANCH',   'AUXILIARY'];

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

function manaPercent(tokens: number, maxTokens: number): number {
  return maxTokens > 0 ? Math.min(100, Math.round((tokens / maxTokens) * 100)) : 0;
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
      case 'builder': { // WARRIOR — gold plate armor
        // Helm
        px(ctx, 48, 8,  32, 28, color);
        px(ctx, 50, 10, 28, 24, '#d4880a');       // helm shadow
        px(ctx, 44, 12, 4,  20, dark);            // visor L
        px(ctx, 80, 12, 4,  20, dark);            // visor R
        px(ctx, 56, 18, 16, 8,  '#ffffff33');     // helm highlight
        // Face
        px(ctx, 48, 36, 32, 24, '#f5c97b');
        px(ctx, 50, 38, 28, 20, '#e5b96b');       // face shadow
        px(ctx, 54, 42, 6,  5,  '#2a1a0a');       // eye L
        px(ctx, 68, 42, 6,  5,  '#2a1a0a');       // eye R
        px(ctx, 56, 44, 3,  2,  '#ffffff');        // eye L highlight
        px(ctx, 70, 44, 3,  2,  '#ffffff');        // eye R highlight
        // Shoulders (broad)
        px(ctx, 28, 60, 72, 12, color);
        px(ctx, 24, 64, 12, 8,  color);
        px(ctx, 92, 64, 12, 8,  color);
        px(ctx, 30, 62, 68, 4,  '#ffffff22');      // shoulder highlight
        // Torso
        px(ctx, 40, 72, 48, 44, color);
        px(ctx, 42, 74, 44, 40, '#d4880a');        // torso shadow
        px(ctx, 52, 78, 6,  6,  '#ffffff33');      // chest highlight
        // Arms
        px(ctx, 24, aL, 16, 36, color);            // arm L (shield)
        px(ctx, 88, aR, 16, 36, color);            // arm R (sword)
        // Sword (right)
        px(ctx, 100, aR - 20, 4, 44, '#d0d0d0');
        px(ctx, 96,  aR - 16, 12, 6,  '#d0d0d0'); // crossguard
        px(ctx, 98,  aR - 18, 8,  4,  '#ffffff');  // blade highlight
        // Shield (left)
        px(ctx, 16, aL - 4, 16, 28, color);
        px(ctx, 18, aL - 2, 12, 24, '#ffffff22');
        px(ctx, 20, aL,     4,  4,  '#ffffff44');   // shield boss
        // Legs
        px(ctx, 44, 116, 20, 36, color);
        px(ctx, 64, 116, 20, 36, '#d4880a');
        // Feet
        px(ctx, 40, lL + 30, 24, 8, dark);
        px(ctx, 64, lR + 30, 24, 8, dark);
        break;
      }
      case 'detective': { // ROGUE — teal, slim, dual daggers
        // Hood
        px(ctx, 52, 4,  24, 12, dark);
        px(ctx, 48, 16, 32, 20, dark);
        px(ctx, 50, 18, 28, 16, '#003322');        // hood shadow
        // Face (partially shadowed)
        px(ctx, 52, 36, 24, 24, '#c4956a');
        px(ctx, 54, 38, 20, 20, '#b4856a');
        px(ctx, 56, 42, 5,  4,  '#1a1a1a');       // eye L
        px(ctx, 67, 42, 5,  4,  '#1a1a1a');       // eye R
        px(ctx, 57, 43, 2,  2,  '#34d399');        // eye L glow
        px(ctx, 68, 43, 2,  2,  '#34d399');        // eye R glow
        // Slim shoulders
        px(ctx, 36, 60, 56, 8, color);
        px(ctx, 38, 62, 52, 4, '#24b382');         // shoulder shadow
        // Torso (slim leather)
        px(ctx, 44, 68, 40, 44, color);
        px(ctx, 46, 70, 36, 40, '#24b382');
        px(ctx, 50, 74, 28, 4,  dark);            // belt
        // Arms
        px(ctx, 28, aL, 12, 32, color);
        px(ctx, 88, aR, 12, 32, color);
        // Daggers
        px(ctx, 24, aL - 16, 4, 36, '#d0d0d0');
        px(ctx, 100, aR - 16, 4, 36, '#d0d0d0');
        px(ctx, 24, aL - 18, 4, 4,  '#ffffff');   // blade tip L
        px(ctx, 100, aR - 18, 4, 4, '#ffffff');   // blade tip R
        // Legs
        px(ctx, 46, 112, 16, 40, color);
        px(ctx, 66, 112, 16, 40, '#24b382');
        // Feet
        px(ctx, 42, lL + 30, 20, 8, dark);
        px(ctx, 66, lR + 30, 20, 8, dark);
        break;
      }
      case 'commander': { // MAGE — blue, tall hat, staff
        // Tall pointed hat
        px(ctx, 56, 0,  16, 12, color);
        px(ctx, 52, 12, 24, 8,  color);
        px(ctx, 44, 20, 40, 16, color);
        px(ctx, 58, 2,  12, 8,  '#7dc4ff');        // hat highlight
        px(ctx, 46, 22, 36, 4,  '#3a7acc');        // hat brim shadow
        // Face
        px(ctx, 48, 36, 32, 24, '#d4a47c');
        px(ctx, 50, 38, 28, 20, '#c4946c');
        px(ctx, 54, 42, 5,  5,  '#1a2a5a');       // eye L
        px(ctx, 69, 42, 5,  5,  '#1a2a5a');       // eye R
        px(ctx, 55, 43, 2,  2,  '#60a5fa');        // eye L glow
        px(ctx, 70, 43, 2,  2,  '#60a5fa');        // eye R glow
        // Shoulders
        px(ctx, 40, 60, 48, 8, color);
        // Flowing robe (wide at base)
        px(ctx, 36, 68, 56, 52, color);
        px(ctx, 28, 84, 72, 32, color);
        px(ctx, 38, 70, 52, 48, '#3a7acc');        // robe shadow
        px(ctx, 48, 74, 32, 8,  '#ffffff22');      // robe highlight
        // Arms
        px(ctx, 24, aL, 12, 32, color);
        px(ctx, 92, aR, 12, 32, color);
        // Staff (left)
        px(ctx, 20, aL - 28, 6, 56, '#8b7a5e');
        px(ctx, 16, aL - 32, 14, 10, color);       // staff crystal
        px(ctx, 18, aL - 30, 10, 6,  '#7dc4ff');   // crystal glow
        // Feet
        px(ctx, 44, lL + 8, 20, 8, '#3a7acc');
        px(ctx, 68, lR + 8, 20, 8, '#3a7acc');
        break;
      }
      case 'architect': { // WARLOCK — purple cowl, grimoire
        // Dark hood
        px(ctx, 44, 0,  40, 40, dark);
        px(ctx, 48, 8,  32, 32, '#2a0050');
        // Face (shadowed, glowing eyes)
        px(ctx, 52, 24, 24, 20, '#9070a0');
        px(ctx, 54, 26, 20, 16, '#806090');
        px(ctx, 56, 28, 6,  6,  color);           // eye L (bright glow)
        px(ctx, 66, 28, 6,  6,  color);           // eye R (bright glow)
        px(ctx, 57, 29, 4,  4,  '#ffffff88');      // eye L core
        px(ctx, 67, 29, 4,  4,  '#ffffff88');      // eye R core
        // Robe (asymmetric, dark)
        px(ctx, 36, 48, 56, 64, dark);
        px(ctx, 32, 68, 64, 40, dark);
        px(ctx, 40, 50, 48, 58, color + '44');
        // Grimoire (floating right)
        px(ctx, 88, aR - 16, 24, 28, '#3b2060');
        px(ctx, 90, aR - 14, 20, 24, color + '55');
        px(ctx, 94, aR - 10, 12, 16, '#ffffff11');
        // Arms
        px(ctx, 84, aR, 8, 24, dark);
        px(ctx, 28, aL, 8, 24, dark);
        // Summoning circle
        ctx.strokeStyle = color + 'aa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(64, 144, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = color + '66'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(64, 144, 12, 0, Math.PI * 2); ctx.stroke();
        // Legs
        px(ctx, 48, 112, 16, 36, dark);
        px(ctx, 64, 112, 16, 36, dark + 'aa');
        break;
      }
      case 'guardian': { // PALADIN — radiant golden plate
        // Holy glow behind head
        ctx.fillStyle = color + '33';
        ctx.beginPath(); ctx.arc(64, 24, 32, 0, Math.PI * 2); ctx.fill();
        // Radiant helm
        px(ctx, 44, 4,  40, 32, color);
        px(ctx, 48, 8,  32, 24, '#ffffff66');       // bright highlight
        px(ctx, 46, 6,  36, 4,  '#ffffff44');
        // Face
        px(ctx, 50, 36, 28, 24, '#f0c87a');
        px(ctx, 52, 38, 24, 20, '#e0b86a');
        px(ctx, 56, 42, 5,  5,  '#5a4010');        // eye L
        px(ctx, 67, 42, 5,  5,  '#5a4010');        // eye R
        px(ctx, 57, 43, 2,  2,  '#fbbf24');        // eye L glow
        px(ctx, 68, 43, 2,  2,  '#fbbf24');        // eye R glow
        // Broad shoulders
        px(ctx, 24, 60, 80, 12, color);
        px(ctx, 20, 64, 16, 12, color);
        px(ctx, 92, 64, 16, 12, color);
        px(ctx, 26, 62, 76, 4,  '#ffffff33');       // shoulder highlight
        // Torso
        px(ctx, 40, 72, 48, 44, color);
        px(ctx, 44, 76, 40, 36, '#ffffff33');
        // Hammer (right)
        px(ctx, 92, aR, 8, 40, '#8b7a5e');         // handle
        px(ctx, 84, aR - 8, 24, 12, color);        // hammer head
        px(ctx, 86, aR - 6, 20, 4,  '#ffffff44');  // hammer highlight
        // Shield arm (left)
        px(ctx, 24, aL, 16, 36, color);
        px(ctx, 20, aL - 4, 20, 36, '#ffffff22');
        // Legs
        px(ctx, 42, 116, 20, 36, color);
        px(ctx, 66, 116, 20, 36, color);
        px(ctx, 44, 118, 16, 32, '#ffffff22');
        // Feet
        px(ctx, 40, lL + 30, 24, 8, dark);
        px(ctx, 64, lR + 30, 24, 8, dark);
        break;
      }
      case 'storyteller': { // PRIEST — white robes, golden halo
        // Halo arc
        ctx.strokeStyle = '#ffd700cc'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(64, 12, 20, Math.PI, 0); ctx.stroke();
        ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(64, 12, 18, Math.PI, 0); ctx.stroke();
        // Head
        px(ctx, 48, 16, 32, 32, '#f5e8d5');
        px(ctx, 50, 18, 28, 28, '#e8dcc8');
        px(ctx, 54, 28, 5,  5,  '#4a3a2a');       // eye L
        px(ctx, 69, 28, 5,  5,  '#4a3a2a');       // eye R
        px(ctx, 55, 29, 2,  2,  '#ffffff');        // eye highlight
        px(ctx, 70, 29, 2,  2,  '#ffffff');
        // Shoulders
        px(ctx, 40, 48, 48, 8, color);
        // Flowing robes (wide, white)
        px(ctx, 36, 56, 56, 60, color);
        px(ctx, 32, 88, 64, 28, color);
        px(ctx, 40, 60, 48, 52, '#ffffff44');       // inner highlight
        // Arms
        px(ctx, 24, aL, 12, 28, color);
        px(ctx, 92, aR, 12, 28, color);
        // Orb (right hand)
        ctx.fillStyle = '#ffd70088';
        ctx.beginPath(); ctx.arc(100, aR + 28, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff44';
        ctx.beginPath(); ctx.arc(98, aR + 26, 4, 0, Math.PI * 2); ctx.fill();
        // Feet
        px(ctx, 44, lL + 8, 20, 8, '#cccccc');
        px(ctx, 68, lR + 8, 20, 8, '#cccccc');
        break;
      }
      default: { // DEATH KNIGHT — cracked dark plate, green rune glow
        // Cracked helm
        px(ctx, 44, 4,  40, 32, dark);
        px(ctx, 48, 8,  32, 24, dark + 'cc');
        // Cracks (green glow)
        ctx.strokeStyle = color + '88'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(56, 8); ctx.lineTo(60, 28); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(72, 12); ctx.lineTo(68, 32); ctx.stroke();
        // Glowing eyes
        px(ctx, 54, 20, 8, 6, color);
        px(ctx, 66, 20, 8, 6, color);
        px(ctx, 56, 21, 4, 4, '#ffffff88');         // eye core L
        px(ctx, 68, 21, 4, 4, '#ffffff88');         // eye core R
        // Undead face
        px(ctx, 50, 36, 28, 24, '#3a4a3a');
        px(ctx, 52, 38, 24, 20, '#2a3a2a');
        // Heavy dark plate
        px(ctx, 28, 60, 72, 16, dark);
        px(ctx, 40, 76, 48, 40, dark);
        px(ctx, 42, 78, 44, 36, '#1a2a1a');
        // Rune sword (two-handed)
        px(ctx, 88, aR - 28, 6, 68, '#8090a0');
        px(ctx, 80, aR - 20, 20, 8,  '#8090a0');   // crossguard
        px(ctx, 90, aR - 26, 2, 40, '#ffffff44');   // blade highlight
        // Rune glow on blade
        px(ctx, 89, aR - 16, 4, 4, color);
        px(ctx, 89, aR - 6,  4, 4, color);
        px(ctx, 89, aR + 4,  4, 4, color);
        // Arms (both gripping sword)
        px(ctx, 72, aR, 16, 28, dark);
        px(ctx, 28, aL, 12, 32, dark);
        // Ghostly mist at feet (subtle, no big blobs)
        ctx.fillStyle = color + '22';
        ctx.beginPath(); ctx.ellipse(64, 156, 24, 8, 0, 0, Math.PI * 2); ctx.fill();
        // Legs
        px(ctx, 44, 116, 20, 36, dark);
        px(ctx, 64, 116, 20, 36, dark + 'aa');
        // Feet
        px(ctx, 40, lL + 30, 24, 8, '#304030');
        px(ctx, 64, lR + 30, 24, 8, '#304030');
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

// ─── Plaza Environment — ImageData texture + 3D props ────────────────────────

let _plazaTex: THREE.CanvasTexture | null = null;

function buildPlazaTexture(): THREE.CanvasTexture {
  if (_plazaTex) return _plazaTex;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cx = S / 2, cy = S / 2;
  const plazaR = S * 0.30;
  const pondR = S * 0.09;
  const pondCx = S * 0.15, pondCy = S * 0.85;
  const pathHW = S * 0.035;

  function hash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const H = hash(x, y);
      const n = (H % 100) / 100;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const pdx = x - pondCx, pdy = y - pondCy;
      const pondDist = Math.sqrt(pdx * pdx + pdy * pdy);
      const onPathNS = Math.abs(dx) < pathHW && Math.abs(dy) > plazaR;
      const onPathEW = Math.abs(dy) < pathHW && Math.abs(dx) > plazaR;

      let r: number, g: number, b: number;

      if (pondDist < pondR - 3) {
        // Water — deep blue with shimmer
        const wd = pondDist / pondR;
        r = 40 + Math.floor(wd * 20 + n * 12);
        g = 85 + Math.floor(wd * 25 + n * 15);
        b = 150 + Math.floor(n * 30);
      } else if (pondDist < pondR + 5) {
        // Pond stone rim
        const sv = Math.floor(n * 25) - 12;
        r = 115 + sv; g = 95 + sv; b = 75 + sv;
      } else if (dist < plazaR - 3) {
        // Cobblestone plaza with stone pattern
        const sx = ((x + 500) % 8), sy = ((y + 500) % 8);
        const row = Math.floor((y + 500) / 8);
        const ox = (row % 2) * 4;
        const sx2 = ((x + 500 + ox) % 8);
        if (sx2 === 0 || sy === 0) {
          r = 90 + Math.floor(n * 10); g = 75 + Math.floor(n * 8); b = 58 + Math.floor(n * 6);
        } else {
          const sv = Math.floor(n * 28) - 14;
          r = 190 + sv; g = 170 + sv; b = 135 + sv;
        }
      } else if (dist < plazaR + 5) {
        // Plaza edge ring — darker stone border
        const sv = Math.floor(n * 18) - 9;
        r = 128 + sv; g = 108 + sv; b = 85 + sv;
      } else if (onPathNS || onPathEW) {
        // Dirt paths
        const sv = Math.floor(n * 22) - 11;
        r = 148 + sv; g = 122 + sv; b = 85 + sv;
      } else {
        // Lush grass — warm yellow-green with variation
        const gv = Math.floor(n * 28) - 14;
        // Subtle large-scale variation using low-freq hash
        const lf = hash(Math.floor(x / 16), Math.floor(y / 16));
        const lfv = ((lf % 20) - 10);
        r = 68 + gv + lfv;
        g = 125 + gv + lfv;
        b = 48 + Math.floor(gv / 2);

        // Scattered flowers on grass
        if (dist > plazaR + 25 && pondDist > pondR + 15 && (H % 53) === 0) {
          const fc = (H >>> 8) % 6;
          if (fc === 0) { r = 235; g = 75; b = 55; }       // red poppy
          else if (fc === 1) { r = 240; g = 210; b = 50; }  // yellow daisy
          else if (fc === 2) { r = 225; g = 130; b = 185; } // pink
          else if (fc === 3) { r = 170; g = 110; b = 225; } // purple
          else if (fc === 4) { r = 255; g = 250; b = 210; } // white
          else { r = 240; g = 180; b = 60; }                // orange
        }

        // Grass highlight streaks
        if ((H % 19) === 0) { r += 15; g += 20; b += 5; }
      }

      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  _plazaTex = tex;
  return tex;
}

function PlazaEnvironment() {
  const floorTex = useMemo(() => buildPlazaTexture(), []);

  return (
    <>
      {/* Textured ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[22, 22]} />
        <meshBasicMaterial map={floorTex} />
      </mesh>

      {/* Fountain rim */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[1.0, 1.5, 24]} />
        <meshStandardMaterial color="#8a7a6a" roughness={0.8} />
      </mesh>
      {/* Fountain water */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[1.0, 24]} />
        <meshStandardMaterial color="#4a90c0" emissive="#2a6090" emissiveIntensity={0.3} />
      </mesh>
      {/* Fountain pillar */}
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 0.65, 8]} />
        <meshStandardMaterial color="#9a8a7a" roughness={0.7} />
      </mesh>

      {/* Trees — trunk + layered canopy */}
      {[[-7,-6],[7,-6],[-7,6],[7,6],[-8,0],[8,0]].map(([x,z],i) => (
        <group key={`tree${i}`} position={[x!, 0, z!]}>
          {/* Trunk */}
          <mesh position={[0, 0.7, 0]}>
            <cylinderGeometry args={[0.1, 0.18, 1.4, 6]} />
            <meshStandardMaterial color="#5a3a1a" roughness={0.9} />
          </mesh>
          {/* Root flare */}
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.18, 0.3, 0.16, 6]} />
            <meshStandardMaterial color="#4a3018" roughness={0.9} />
          </mesh>
          {/* Canopy layers — dark to light */}
          <mesh position={[0, 1.4, 0]}>
            <sphereGeometry args={[1.1, 8, 6]} />
            <meshStandardMaterial color="#1a5a1a" roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.8, 0]}>
            <sphereGeometry args={[0.9, 8, 6]} />
            <meshStandardMaterial color="#2a7a2a" roughness={0.8} />
          </mesh>
          <mesh position={[0, 2.15, 0]}>
            <sphereGeometry args={[0.6, 8, 6]} />
            <meshStandardMaterial color="#3a9a3a" roughness={0.75} />
          </mesh>
          {/* Ground shadow */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.2, 0.005, 0.2]}>
            <circleGeometry args={[1.2, 12]} />
            <meshStandardMaterial color="#000" transparent opacity={0.18} />
          </mesh>
        </group>
      ))}

      {/* Stone boulders around pond area */}
      {[[-2.5,7.5],[0.5,8],[-3,8.5],[-1,9]].map(([x,z],i) => (
        <mesh key={`rock${i}`} position={[x!, 0.12, z!]}>
          <sphereGeometry args={[0.2 + (i % 3) * 0.08, 6, 5]} />
          <meshStandardMaterial color={i % 2 ? '#8a7a6a' : '#7a6a5a'} roughness={0.9} />
        </mesh>
      ))}

      {/* Barrel clusters */}
      {[[-4,-5],[5,-4.5],[-4.5,4],[4.5,5]].map(([x,z],i) => (
        <group key={`brl${i}`} position={[x!, 0, z!]}>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.22, 0.25, 0.7, 8]} />
            <meshStandardMaterial color="#7a5a3a" roughness={0.85} />
          </mesh>
          {/* Metal bands */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.26, 0.26, 0.04, 8]} />
            <meshStandardMaterial color="#5a5a6a" roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.24, 0.24, 0.04, 8]} />
            <meshStandardMaterial color="#5a5a6a" roughness={0.4} metalness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Warm lights */}
      <pointLight position={[0, 1.5, 0]} color="#4488cc" intensity={0.3} distance={4} />
    </>
  );
}

// ─── WoW Nameplate ────────────────────────────────────────────────────────────

function WoWNameplate({ pn, maxCost, maxTokens, selected }: {
  pn: PositionedNode; maxCost: number; maxTokens: number; selected: boolean;
}) {
  const hp  = hpPercent(pn.session.estimated_cost_usd, maxCost);
  const mp  = manaPercent(pn.session.total_tokens ?? 0, maxTokens);
  const c   = pn.cls;
  const hpC = hp > 60 ? '#22c55e' : hp > 30 ? '#f59e0b' : '#ef4444';

  return (
    <Html center position={[0, 3.4, 0]} distanceFactor={11} style={{ pointerEvents: 'none' }}>
      <div style={{
        minWidth: 120, background: 'rgba(0,0,0,.72)',
        border: `1px solid ${selected ? '#63f7b3' : c.color}66`,
        borderRadius: 3, padding: '4px 6px 5px',
        fontFamily: 'monospace', userSelect: 'none',
        boxShadow: selected ? `0 0 8px ${c.aura}44` : 'none',
      }}>
        <div style={{ fontSize: 7, color: c.color, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 1 }}>
          {pn.role}
        </div>
        <div style={{ fontSize: 10, color: c.color, fontWeight: 700, marginBottom: 3,
          textShadow: `0 0 6px ${c.aura}`, letterSpacing: 0.3 }}>
          {pn.name}
        </div>
        <div style={{ height: 5, background: '#0a1a0a', borderRadius: 2, overflow: 'hidden', marginBottom: 2 }}>
          <div style={{ width: `${hp}%`, height: '100%', background: hpC, borderRadius: 2 }} />
        </div>
        <div style={{ height: 3, background: '#050e1a', borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
          <div style={{ width: `${mp}%`, height: '100%', background: c.color + 'cc', borderRadius: 2 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 8, color: '#c8a85588' }}>{formatGold(pn.session.estimated_cost_usd)}</span>
          <span style={{ fontSize: 8, color: '#c8a85588' }}>{formatDur(pn.session.duration_seconds)}</span>
        </div>
      </div>
    </Html>
  );
}

// ─── WoW Champion Node ────────────────────────────────────────────────────────

function WoWChampionNode({ pn, maxCost, maxTokens, selected, onClick, onPosUpdate, parentPos }: {
  pn:          PositionedNode;
  maxCost:     number;
  maxTokens:   number;
  selected:    boolean;
  onClick:     () => void;
  onPosUpdate: (id: string, pos: THREE.Vector3) => void;
  parentPos:   THREE.Vector3 | null;
}) {
  const groupRef    = useRef<THREE.Group>(null);
  const spriteRef   = useRef<THREE.Sprite>(null);
  const ringRef     = useRef<THREE.Mesh>(null);
  const livePosRef  = useRef(new THREE.Vector3(pn.pos[0], 0, pn.pos[2]));
  const targetWpRef = useRef(Math.floor(Math.random() * WAYPOINTS.length));
  const frameRef    = useRef(0);
  const frameTimer  = useRef(Math.random() * 0.22); // stagger so not all sync
  const c           = pn.cls;

  const textures = useMemo(() => buildClassTexture(pn.session.cat_type ?? 'ghost'), [pn.session.cat_type]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();

    const wp   = WAYPOINTS[targetWpRef.current]!;
    const dx   = wp[0] - livePosRef.current.x;
    const dz   = wp[1] - livePosRef.current.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.25) {
      if (parentPos && Math.random() < 0.35) {
        // Drift toward parent's nearest waypoint
        let bestIdx = 0, bestDist = Infinity;
        WAYPOINTS.forEach(([wx, wz], i) => {
          const d = Math.sqrt((wx - parentPos.x) ** 2 + (wz - parentPos.z) ** 2);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        targetWpRef.current = bestIdx;
      } else {
        targetWpRef.current = Math.floor(Math.random() * WAYPOINTS.length);
      }
    } else {
      const speed = 1.5 * delta;
      livePosRef.current.x += (dx / dist) * Math.min(speed, dist);
      livePosRef.current.z += (dz / dist) * Math.min(speed, dist);
      groupRef.current.rotation.y = Math.atan2(dx, dz);

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

    groupRef.current.position.copy(livePosRef.current);
    onPosUpdate(pn.session.session_id, livePosRef.current.clone());

    if (ringRef.current) {
      const s = 1 + Math.sin(t * 2.2 + pn.idx) * 0.07;
      ringRef.current.scale.setScalar(s);
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
      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.35, 12]} />
        <meshStandardMaterial color="#000" transparent opacity={0.25} />
      </mesh>
      {/* Pixel sprite */}
      <sprite ref={spriteRef} scale={[2.2, 3.3, 1]}>
        <spriteMaterial map={textures[0]} transparent alphaTest={0.1} />
      </sprite>
      {/* Invisible click hitbox */}
      <mesh visible={false} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <boxGeometry args={[2.0, 3.4, 2.0]} />
      </mesh>
      {/* Selection ring */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.85, 1.0, 32]} />
          <meshStandardMaterial color="#63f7b3" emissive="#63f7b3" emissiveIntensity={2}
            transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}
      <WoWNameplate pn={pn} maxCost={maxCost} maxTokens={maxTokens} selected={selected} />
    </group>
  );
}

// ─── Dynamic Ley Line ─────────────────────────────────────────────────────────

function DynamicLeyLine({ childId, parentId, color, livePosMap }: {
  childId:    string;
  parentId:   string;
  color:      string;
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const lineGeo  = useMemo(() => new THREE.BufferGeometry(), []);
  const lineMat  = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }), [color]);
  const lineObj  = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);
  const stone1Ref = useRef<THREE.Mesh>(null);
  const stone2Ref = useRef<THREE.Mesh>(null);
  const t1 = useRef(0);
  const t2 = useRef(0.5);

  useEffect(() => () => { lineGeo.dispose(); lineMat.dispose(); }, [lineGeo, lineMat]);

  useFrame((_, delta) => {
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

    t1.current = (t1.current + delta * 0.38) % 1;
    t2.current = (t2.current + delta * 0.38) % 1;
    if (stone1Ref.current) stone1Ref.current.position.copy(curve.getPoint(t1.current));
    if (stone2Ref.current) stone2Ref.current.position.copy(curve.getPoint(t2.current));
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
    </>
  );
}

// ─── WoW Tooltip Overlay ──────────────────────────────────────────────────────

function WoWTooltipOverlay({ session, cls, name, role, onClose }: {
  session: Session; cls: ClassConfig; name: string; role: string; onClose: () => void;
}) {
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

// ─── Full 3D Scene ────────────────────────────────────────────────────────────

function Scene({ group, selectedId, onSelect }: {
  group: SessionRunGroup; selectedId: string | null; onSelect: (id: string | null) => void;
}) {
  const nodes     = useMemo(() => layoutNodes(group.roots), [group]);
  const maxCost   = useMemo(() => Math.max(...nodes.map((n) => n.session.estimated_cost_usd), 0.001), [nodes]);
  const maxTokens = useMemo(() => Math.max(...nodes.map((n) => n.session.total_tokens ?? 0), 1), [nodes]);

  const livePosMap = useRef(new Map<string, THREE.Vector3>());
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

  return (
    <>
      <ambientLight intensity={0.5} color="#fff0d0" />
      <directionalLight position={[10, 20, 10]} intensity={1.2} color="#fff8e0" castShadow />
      <directionalLight position={[-8, 5, -8]} intensity={0.2} color="#88aaff" />
      <pointLight position={[0, 6, 0]} intensity={0.6} color="#ffd080" distance={30} />

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
        />
      ))}

      <OrbitControls target={center} enableDamping dampingFactor={0.06}
        minZoom={30} maxZoom={180} maxPolarAngle={Math.PI / 2.4} minPolarAngle={Math.PI / 8} />

      {/* Bloom disabled — was breaking WebGL render pipeline */}
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

export default function ScryingSanctum({ sessions, onReload }: { sessions: Session[]; onReload?: () => void }) {
  const [runIdx,  setRunIdx]  = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing,  setSyncing]  = useState(false);

  const groups = useMemo(() => getSessionRunGroups(sessions), [sessions]);
  const group  = groups[runIdx] ?? null;

  const prevGroupsLen = useRef(groups.length);
  useEffect(() => {
    if (prevGroupsLen.current !== groups.length) {
      prevGroupsLen.current = groups.length;
      setRunIdx(0);
      setSelected(null);
    }
  }, [groups.length]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try { await fetch('/api/sync', { method: 'POST' }); onReload?.(); }
    catch { /* ignore in prod */ } finally { setSyncing(false); }
  }

  const flatNodes = useMemo(() => group ? layoutNodes(group.roots) : [], [group]);
  const selectedNode = flatNodes.find((n) => n.session.session_id === selected) ?? null;

  if (groups.length === 0) return <EmptyState />;

  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)', background: '#0a1a0e',
      borderRadius: 12, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px 10px', borderBottom: '1px solid rgba(200,168,85,.12)',
        display: 'flex', alignItems: 'center', gap: 14,
        zIndex: 10, position: 'relative',
        background: 'rgba(6,14,8,.85)', backdropFilter: 'blur(8px)',
      }}>
        <div>
          <div style={{ fontSize: 8.5, color: '#c8a85555', letterSpacing: 3, textTransform: 'uppercase' }}>
            Scrying Sanctum
          </div>
          <div style={{ fontSize: 16, color: '#e8d5a3', fontWeight: 300, letterSpacing: 1.5, fontFamily: 'monospace' }}>
            {group?.project ?? '—'}
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
        {['SCROLL · ZOOM', 'DRAG  · PAN', 'CLICK · SELECT'].map((hint) => (
          <div key={hint} style={{ fontSize: 7.5, color: '#c8a85533', letterSpacing: 1.5, textAlign: 'right', marginBottom: 2 }}>
            {hint}
          </div>
        ))}
      </div>

      {/* WebGL Canvas */}
      <div style={{ flex: 1, minHeight: 520, position: 'relative' }}>
        <Canvas
          orthographic
          camera={{ position: [14, 14, 14], zoom: 48, up: [0, 1, 0], near: 0.1, far: 500 }}
          shadows
          gl={{ antialias: false, alpha: false }}
          style={{ background: 'radial-gradient(ellipse at 30% 20%, #1a3020 0%, #0e1a10 50%, #060e08 100%)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
        >
          <Suspense fallback={null}>
            {group && <Scene group={group} selectedId={selected} onSelect={setSelected} />}
          </Suspense>
        </Canvas>

        {selectedNode && (
          <WoWTooltipOverlay
            session={selectedNode.session}
            cls={selectedNode.cls}
            name={selectedNode.name}
            role={selectedNode.role}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
