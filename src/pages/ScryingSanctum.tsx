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

function buildClassTexture(catType: string): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const cached = TEXTURE_CACHE.get(catType);
  if (cached) return cached;

  const cls   = CLASS_MAP[catType] ?? FALLBACK_CLASS;
  const color = cls.color;
  const dark  = cls.emissive || '#111';
  const W = 64, H = 96;

  function drawFrame(walking: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    const armLY = walking ? 36 : 34;
    const armRY = walking ? 38 : 34;
    const legLY = walking ? 62 : 60;
    const legRY = walking ? 58 : 60;

    switch (catType) {
      case 'builder': { // WARRIOR — gold plate
        px(ctx, 24, 4,  16, 14, color);           // helm
        px(ctx, 22, 6,  2,  10, dark);            // visor L
        px(ctx, 40, 6,  2,  10, dark);            // visor R
        px(ctx, 24, 18, 16, 12, '#f5c97b');       // face
        px(ctx, 14, 30, 36, 6,  color);           // shoulders
        px(ctx, 12, 32, 6,  4,  color);
        px(ctx, 46, 32, 6,  4,  color);
        px(ctx, 20, 36, 24, 22, color);           // torso
        px(ctx, 12, armLY, 8, 18, color);         // arm L
        px(ctx, 44, armRY, 8, 18, color);         // arm R
        px(ctx, 50, armRY - 10, 2, 22, '#c0c0c0'); // sword
        px(ctx, 48, armRY - 8,  6, 3,  '#c0c0c0');
        px(ctx, 8,  armLY - 2,  8, 14, color);   // shield
        px(ctx, 9,  armLY - 1,  6, 12, '#ffffff44');
        px(ctx, 22, 58, 10, 18, color);           // legs
        px(ctx, 32, 58, 10, 18, dark);
        px(ctx, 20, legLY, 12, 4, dark);
        px(ctx, 32, legRY, 12, 4, dark);
        break;
      }
      case 'detective': { // ROGUE — teal
        px(ctx, 26, 2,  12, 6,  dark);            // hood
        px(ctx, 24, 8,  16, 10, dark);
        px(ctx, 26, 18, 12, 12, '#c4956a');       // face
        px(ctx, 18, 30, 28, 4,  color);           // shoulders
        px(ctx, 22, 34, 20, 22, color);           // torso
        px(ctx, 14, armLY, 6, 16, color);         // arm L
        px(ctx, 44, armRY, 6, 16, color);         // arm R
        px(ctx, 12, armLY - 8, 2, 18, '#c0c0c0'); // dagger L
        px(ctx, 50, armRY - 8, 2, 18, '#c0c0c0'); // dagger R
        px(ctx, 23, 56, 8, 20, color);            // legs
        px(ctx, 33, 56, 8, 20, dark);
        px(ctx, 21, legLY, 10, 4, dark);
        px(ctx, 33, legRY, 10, 4, dark);
        break;
      }
      case 'commander': { // MAGE — blue, tall hat
        px(ctx, 28, 0,  8,  6,  color);           // hat tip
        px(ctx, 26, 6,  12, 4,  color);
        px(ctx, 22, 10, 20, 8,  color);           // hat brim
        px(ctx, 24, 18, 16, 12, '#d4a47c');       // face
        px(ctx, 20, 30, 24, 4,  color);           // shoulders
        px(ctx, 18, 34, 28, 26, color);           // robe (wide)
        px(ctx, 14, 42, 36, 16, color);
        px(ctx, 12, armLY, 6, 16, color);         // arm L
        px(ctx, 46, armRY, 6, 16, color);         // arm R
        px(ctx, 10, armLY - 14, 3, 28, '#8b7a5e'); // staff
        px(ctx, 8,  armLY - 16, 7,  5,  color);
        ctx.fillStyle = color + '88';
        ctx.beginPath(); ctx.arc(11, armLY - 14, 5, 0, Math.PI * 2); ctx.fill();
        px(ctx, 22, legLY + 4, 10, 4, dark);
        px(ctx, 34, legRY + 4, 10, 4, dark);
        break;
      }
      case 'architect': { // WARLOCK — purple cowl
        px(ctx, 22, 0,  20, 20, dark);            // hood
        px(ctx, 24, 4,  16, 16, dark);
        px(ctx, 26, 12, 12, 10, '#9070a0');       // face
        px(ctx, 28, 14, 3,  3,  color);           // eye L
        px(ctx, 33, 14, 3,  3,  color);           // eye R
        px(ctx, 18, 24, 28, 32, dark);            // robe
        px(ctx, 16, 34, 32, 20, dark);
        px(ctx, 44, armRY - 8,  12, 14, '#3b2060'); // grimoire
        px(ctx, 45, armRY - 7,  10, 12, color + '55');
        px(ctx, 42, armRY,      4,  12, dark);    // arm R
        px(ctx, 14, armLY,      4,  12, dark);    // arm L
        ctx.strokeStyle = color + 'aa'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(32, 72, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(32, 72, 6,  0, Math.PI * 2); ctx.stroke();
        px(ctx, 24, 56, 8, 18, dark);
        px(ctx, 32, 56, 8, 18, dark + 'aa');
        break;
      }
      case 'guardian': { // PALADIN — radiant plate
        ctx.fillStyle = color + '33';
        ctx.beginPath(); ctx.arc(32, 12, 16, 0, Math.PI * 2); ctx.fill(); // halo glow
        px(ctx, 22, 2,  20, 16, color);           // helm
        px(ctx, 24, 4,  16, 12, '#ffffff88');
        px(ctx, 25, 18, 14, 12, '#f0c87a');       // face
        px(ctx, 12, 30, 40, 6,  color);           // shoulders
        px(ctx, 10, 32, 8,  6,  color);
        px(ctx, 46, 32, 8,  6,  color);
        px(ctx, 20, 36, 24, 22, color);           // torso
        px(ctx, 22, 38, 20, 18, '#ffffff44');
        px(ctx, 46, armRY, 4, 20, '#8b7a5e');     // hammer handle
        px(ctx, 42, armRY - 4, 12, 6, color);    // hammer head
        px(ctx, 12, armLY, 8,  18, color);        // shield arm
        px(ctx, 10, armLY - 2, 10, 18, '#ffffff33');
        px(ctx, 21, 58, 10, 18, color);
        px(ctx, 33, 58, 10, 18, color);
        px(ctx, 20, legLY, 12, 4, dark);
        px(ctx, 32, legRY, 12, 4, dark);
        break;
      }
      case 'storyteller': { // PRIEST — white robes, halo
        ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(32, 6, 10, Math.PI, 0); ctx.stroke(); // halo
        px(ctx, 24, 8,  16, 16, '#f5e8d5');       // head
        px(ctx, 20, 24, 24, 4,  color);           // shoulders
        px(ctx, 18, 28, 28, 30, color);           // robe
        px(ctx, 16, 44, 32, 14, color);
        px(ctx, 20, 30, 24, 26, '#ffffff44');
        px(ctx, 12, armLY, 6, 14, color);         // arm L
        px(ctx, 46, armRY, 6, 14, color);         // arm R
        ctx.fillStyle = color + 'cc';
        ctx.beginPath(); ctx.arc(50, armRY + 14, 4, 0, Math.PI * 2); ctx.fill(); // orb
        ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1; ctx.stroke();
        px(ctx, 22, legLY + 4, 10, 4, '#cccccc');
        px(ctx, 34, legRY + 4, 10, 4, '#cccccc');
        break;
      }
      default: { // DEATH KNIGHT — cracked dark plate, green mist
        px(ctx, 22, 2,  20, 16, dark);            // helm
        px(ctx, 24, 4,  16, 12, dark + 'cc');
        ctx.strokeStyle = color + '66'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(28, 4); ctx.lineTo(30, 14); ctx.stroke(); // cracks
        ctx.beginPath(); ctx.moveTo(36, 6); ctx.lineTo(34, 16); ctx.stroke();
        px(ctx, 27, 10, 4, 3, color);             // eyes
        px(ctx, 33, 10, 4, 3, color);
        px(ctx, 25, 18, 14, 12, '#3a4a3a');       // face
        px(ctx, 14, 30, 36, 8, dark);             // shoulders
        px(ctx, 20, 38, 24, 20, dark);            // torso
        px(ctx, 44, armRY - 14, 3, 34, '#8090a0'); // rune sword
        px(ctx, 40, armRY - 10, 10, 4, '#8090a0');
        px(ctx, 36, armRY,  8, 14, dark);         // arms on sword
        px(ctx, 14, armLY,  6, 16, dark);
        ctx.fillStyle = color + '44';
        ctx.beginPath(); ctx.ellipse(32, 76, 16, 6, 0, 0, Math.PI * 2); ctx.fill(); // mist
        ctx.fillStyle = color + '22';
        ctx.beginPath(); ctx.ellipse(32, 74, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
        px(ctx, 22, 58, 10, 18, dark);
        px(ctx, 32, 58, 10, 18, dark + 'aa');
        px(ctx, 20, legLY, 12, 4, '#304030');
        px(ctx, 32, legRY, 12, 4, '#304030');
        break;
      }
    }

    return new THREE.CanvasTexture(canvas);
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
        <meshStandardMaterial color="#1a1128" roughness={0.8} />
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
          <meshStandardMaterial color={((x + z) & 1) === 0 ? '#1a1128' : '#161020'} roughness={0.9} metalness={0.05} />
        </mesh>
      ))}
      {/* Border walls */}
      <mesh position={[0, 0.06, -8.65]}><boxGeometry args={[18, 0.24, 0.3]} /><meshStandardMaterial color="#120820" /></mesh>
      <mesh position={[0, 0.06,  8.65]}><boxGeometry args={[18, 0.24, 0.3]} /><meshStandardMaterial color="#120820" /></mesh>
      <mesh position={[-8.65, 0.06, 0]}><boxGeometry args={[0.3, 0.24, 18]} /><meshStandardMaterial color="#120820" /></mesh>
      <mesh position={[ 8.65, 0.06, 0]}><boxGeometry args={[0.3, 0.24, 18]} /><meshStandardMaterial color="#120820" /></mesh>
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
    <Html center position={[0, 2.6, 0]} distanceFactor={11} style={{ pointerEvents: 'none' }}>
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
        <ringGeometry args={[0.55, 0.75, 32]} />
        <meshStandardMaterial color={c.aura} emissive={c.aura} emissiveIntensity={0.5}
          transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.35, 12]} />
        <meshStandardMaterial color="#000" transparent opacity={0.25} />
      </mesh>
      {/* Pixel sprite */}
      <sprite ref={spriteRef} scale={[1.4, 2.1, 1]}>
        <spriteMaterial map={textures[0]} transparent alphaTest={0.05} />
      </sprite>
      {/* Invisible click hitbox */}
      <mesh visible={false} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <boxGeometry args={[1.2, 2.2, 1.2]} />
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
      <fog attach="fog" args={['#120820', 20, 42]} />
      <ambientLight intensity={0.18} color="#2a1040" />
      <directionalLight position={[10, 20, 10]} intensity={0.7} color="#fff8e8" castShadow />
      <directionalLight position={[-8, 5, -8]} intensity={0.25} color="#4040ff" />
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
        <Bloom intensity={1.2} luminanceThreshold={0.3} luminanceSmoothing={0.7} mipmapBlur />
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
          gl={{ antialias: true, alpha: false }}
          style={{ background: 'radial-gradient(ellipse at 30% 20%, #160828 0%, #07040f 50%, #030208 100%)' }}
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
