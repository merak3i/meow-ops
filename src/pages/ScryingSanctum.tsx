// ScryingSanctum.tsx — WoW MMORPG Dalaran Plaza agent pipeline visualizer
// Pixel-art sprite characters roam a Dalaran plaza · WoW nameplates · Dynamic ley lines

import { useRef, useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
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

// ─── Dalaran Plaza ────────────────────────────────────────────────────────────

function DalaranFountain() {
  const waterRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!waterRef.current) return;
    const mat = waterRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.6 + Math.sin(state.clock.getElapsedTime() * 2.5) * 0.25;
  });
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[1.2, 1.4, 0.4, 20]} />
        <meshStandardMaterial color="#2d2245" roughness={0.8} />
      </mesh>
      <mesh ref={waterRef} position={[0, 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.9, 24]} />
        <meshStandardMaterial color="#1a3aff" emissive="#3b6aff" emissiveIntensity={0.6} transparent opacity={0.8} />
      </mesh>
      <pointLight position={[0, 1.5, 0]} color="#5588ff" intensity={1.2} distance={8} />
    </group>
  );
}

function DalaranPillar({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.25, 0.35, 5, 10]} />
        <meshStandardMaterial color="#1e1030" roughness={0.7} emissive="#4a1080" emissiveIntensity={0.05} />
      </mesh>
      <mesh position={[0, 5.1, 0]}>
        <cylinderGeometry args={[0.35, 0.25, 0.2, 10]} />
        <meshStandardMaterial color="#3b1060" emissive="#a855f7" emissiveIntensity={0.3} />
      </mesh>
      <pointLight position={[0, 5.8, 0]} color="#a855f7" intensity={0.3} distance={5} />
    </group>
  );
}

function DalaranBanner({ x, z, phase }: { x: number; z: number; phase: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.z = Math.sin(state.clock.getElapsedTime() * 0.8 + phase) * 0.05;
  });
  return (
    <mesh ref={ref} position={[x, 3.5, z]}>
      <planeGeometry args={[0.6, 2]} />
      <meshStandardMaterial color="#2d0860" emissive="#6b21a8" emissiveIntensity={0.15} side={THREE.DoubleSide} />
    </mesh>
  );
}

function DalaranPlaza() {
  const tiles = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++)
        out.push([x, z]);
    return out;
  }, []);

  return (
    <>
      {tiles.map(([x, z]) => (
        <mesh key={`t${x}_${z}`} position={[x * 1.02, -0.06, z * 1.02]} receiveShadow>
          <boxGeometry args={[0.94, 0.08, 0.94]} />
          <meshStandardMaterial color={((x + z) & 1) === 0 ? '#2d2245' : '#241c38'} roughness={0.9} metalness={0.05} />
        </mesh>
      ))}
      {/* Border walls */}
      <mesh position={[0, 0.06, -8.65]}><boxGeometry args={[18, 0.24, 0.3]} /><meshStandardMaterial color="#1e1535" /></mesh>
      <mesh position={[0, 0.06,  8.65]}><boxGeometry args={[18, 0.24, 0.3]} /><meshStandardMaterial color="#1e1535" /></mesh>
      <mesh position={[-8.65, 0.06, 0]}><boxGeometry args={[0.3, 0.24, 18]} /><meshStandardMaterial color="#1e1535" /></mesh>
      <mesh position={[ 8.65, 0.06, 0]}><boxGeometry args={[0.3, 0.24, 18]} /><meshStandardMaterial color="#1e1535" /></mesh>
      <DalaranFountain />
      <DalaranPillar x={-7} z={-7} />
      <DalaranPillar x={ 7} z={-7} />
      <DalaranPillar x={-7} z={ 7} />
      <DalaranPillar x={ 7} z={ 7} />
      <DalaranBanner x={-7} z={ 0} phase={0}   />
      <DalaranBanner x={ 7} z={ 0} phase={1.2} />
      <DalaranBanner x={ 0} z={-7} phase={0.7} />
      <DalaranBanner x={ 0} z={ 7} phase={2.1} />
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
      <ambientLight intensity={0.35} color="#3a2060" />
      <directionalLight position={[10, 20, 10]} intensity={1.0} color="#fff8e8" castShadow />
      <directionalLight position={[-8, 5, -8]} intensity={0.3} color="#4040ff" />
      <pointLight position={[0, 6, 0]} intensity={0.8} color="#c8a855" distance={30} />

      <Suspense fallback={null}>
        <DalaranPlaza />
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

      <EffectComposer>
        <Bloom intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.4} mipmapBlur />
      </EffectComposer>
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
      minHeight: 'calc(100vh - 80px)', background: '#030208',
      borderRadius: 12, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px 10px', borderBottom: '1px solid rgba(200,168,85,.12)',
        display: 'flex', alignItems: 'center', gap: 14,
        zIndex: 10, position: 'relative',
        background: 'rgba(4,2,12,.75)', backdropFilter: 'blur(8px)',
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
          camera={{ position: [14, 14, 14], zoom: 70, up: [0, 1, 0], near: 0.1, far: 500 }}
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
