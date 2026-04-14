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
  builder:     { color: '#f5c518', emissive: '#7c5a00', label: 'WOLVERINE',    aura: '#f5c518' },
  detective:   { color: '#2a2a2a', emissive: '#0a0a0a', label: 'BATMAN',       aura: '#4a90d9' },
  commander:   { color: '#dc3545', emissive: '#5a1520', label: 'DR. STRANGE',  aura: '#dc3545' },
  architect:   { color: '#1a1a1a', emissive: '#0a0a0a', label: 'DARTH VADER',  aura: '#ff3333' },
  guardian:    { color: '#2563eb', emissive: '#0a1a5a', label: 'CAPTAIN AMERICA', aura: '#2563eb' },
  storyteller: { color: '#9ca3af', emissive: '#3a3a3a', label: 'GANDALF',      aura: '#e2e8f0' },
  ghost:       { color: '#6b7280', emissive: '#1a1a1a', label: 'TERMINATOR',   aura: '#ef4444' },
};
const FALLBACK_CLASS: ClassConfig = { color: '#888', emissive: '#222', label: 'AGENT', aura: '#888' };

const PIPELINE_ROLES = ['ALPHA', 'RECON', 'SORCERER', 'HERALD'];
const EXTRA_ROLES    = ['RUNNER', 'LINK',  'BRANCH',   'AUXILIARY'];

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
  const count = 40;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const data = useMemo(() => Array.from({ length: count }, (_, i) => ({
    radius: 2 + Math.random() * 9,
    speed: 0.15 + Math.random() * 0.3,
    phase: Math.random() * Math.PI * 2,
    y: 0.5 + Math.random() * 4,
    yOsc: 0.3 + Math.random() * 0.8,
    ySpeed: 0.4 + Math.random() * 0.6,
    size: 0.04 + Math.random() * 0.06,
    color: i % 3 === 0 ? '#c8a855' : i % 3 === 1 ? '#8b5cf6' : '#60a5fa',
  })), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    data.forEach((d, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const angle = d.phase + t * d.speed;
      mesh.position.set(
        Math.cos(angle) * d.radius,
        d.y + Math.sin(t * d.ySpeed + d.phase) * d.yOsc,
        Math.sin(angle) * d.radius,
      );
    });
  });

  return (
    <>
      {data.map((d, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
          <sphereGeometry args={[d.size, 6, 6]} />
          <meshBasicMaterial color={d.color} transparent opacity={0.7} />
        </mesh>
      ))}
    </>
  );
}

function CrystalPillar({ position, color }: { position: [number, number, number]; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.elapsedTime * 0.3;
  });
  return (
    <group position={position}>
      {/* Stone base */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 0.6, 6]} />
        <meshStandardMaterial color="#2a2040" roughness={0.9} />
      </mesh>
      {/* Crystal */}
      <mesh ref={ref} position={[0, 1.2, 0]}>
        <octahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5}
          transparent opacity={0.85} roughness={0.2} metalness={0.3} />
      </mesh>
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
  useFrame((state) => {
    if (runeRingRef.current) runeRingRef.current.rotation.z = state.clock.elapsedTime * 0.08;
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

  return (
    <>
      {/* Main dark ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[14, 64]} />
        <meshBasicMaterial color="#1a1428" />
      </mesh>
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
      {pillarPositions.map((p, i) => (
        <CrystalPillar key={i} position={p.pos} color={p.color} />
      ))}
      {brazierPositions.map((pos, i) => (
        <Brazier key={i} position={pos} />
      ))}
      <FloatingParticles />
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
      <sprite ref={spriteRef} scale={[3.0, 4.5, 1]}>
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
  const lineMat  = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, linewidth: 2 }), [color]);
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
      <ambientLight intensity={0.35} color="#3a2060" />
      <directionalLight position={[10, 20, 10]} intensity={1.0} color="#fff8e8" castShadow />
      <pointLight position={[0, 8, 0]} intensity={0.6} color="#c8a855" distance={30} />

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
          camera={{ position: [12, 16, 12], zoom: 38, up: [0, 1, 0], near: 0.1, far: 500 }}
          shadows
          gl={{ antialias: false, alpha: false }}
          style={{ background: 'radial-gradient(ellipse at 30% 20%, #2a1548 0%, #140c28 50%, #0a0618 100%)' }}
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
