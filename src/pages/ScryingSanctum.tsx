// ScryingSanctum.tsx — Dalaran Plaza agent pipeline visualizer
// Pixel-art sprite characters roam a Dalaran plaza · WoW nameplates · Dynamic ley lines

import { useRef, useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, Stars, Sparkles } from '@react-three/drei';
// EffectComposer/Bloom removed — was breaking WebGL render pipeline on Apple GPU
import * as THREE from 'three';
import type { Session } from '@/types/session';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';
import { formatRelativeTime, ageMinutes } from '@/lib/format-time';
import { toISTDate } from '@/lib/format';

// ─── Sanctum sub-modules ─────────────────────────────────────────────────────
//
// The Scrying Sanctum was originally one 5500-line file. The data + pure-
// helper layer was split out to ./sanctum/ to make each concept editable in
// isolation without scrolling through the entire scene definition. The 3D
// component layer (PlazaEnvironment, WoWChampionNode, LichKing, ClaudeSun,
// effects, etc.) still lives in this file for now — that's a larger split
// that needs its own reviewable PR.

import type {
  PerfStats, ClassConfig, SessionIdentifier, EternalStats,
  MovementProfile, QuoteFn, SignatureMove, PositionedNode,
} from './sanctum/types';
import {
  CLASS_MAP, FALLBACK_CLASS, SESSION_ACCENTS, AURA_PROFILES, DEFAULT_AURA,
  PIPELINE_ROLES, EXTRA_ROLES, MOVEMENT_PROFILES, DEFAULT_MOVEMENT,
  CHARACTER_QUOTES, SIGNATURE_MOVES, pickQuote,
  getPipelineRole, getChampionName,
} from './sanctum/classes';
import {
  sessionHash, sessionIdentifier, deriveEternal, blendHex,
  hpPercent, formatGold, formatGoldShort, dayPrefixLabel, formatRunGroupLabel,
  formatDur, layoutNodes, WAYPOINTS,
} from './sanctum/helpers';
import {
  getShadowTexture, getMarbleTexture, getStainedGlassTexture,
  getLichKingTexture, buildClassTexture,
} from './sanctum/textures';
import {
  PerfContext, usePerfLevel, SceneErrorBoundary,
  PerfReader, WebGLContextWatcher,
} from './sanctum/perf';

export type { PerfStats };


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
        flickerSpeed: 1.4 + Math.random() * 2.8,
        flickerPhase: Math.random() * Math.PI * 2,
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
        flickerSpeed: 0.8 + Math.random() * 1.2,
        flickerPhase: Math.random() * Math.PI * 2,
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
      // Depth variation: lower = dimmer, higher = brighter; plus per-firefly flicker
      const heightFade = d.ground ? 0.25 : (0.35 + Math.min(0.65, y / 4));
      const flicker    = 0.75 + Math.sin(t * d.flickerSpeed + d.flickerPhase) * 0.25;
      (mesh.material as THREE.MeshBasicMaterial).opacity = heightFade * flicker;
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

// ─── Dalaran D4 — Magical lights + godrays ───────────────────────────────────
//
// Three procedural light layers that don't require @react-three/postprocessing
// (which pulls duplicate three+react and breaks hooks). Procedural emissive
// halos give a "bloomed" look on stylized scenes ~80% as well as real bloom.
//
//   DalaranLamppost — slim violet pole + warm gold pulsing wisp orb on top
//                     + wide additive halo that fakes bloom around it
//   SunGodrays     — six vertical light shafts radiating from the LLM Sun
//                     straight down to the ground, slowly rotating
//   AtmosphericMotes — wraps drei's <Sparkles> in three layers (near
//                     lavender, mid gold, far white-blue) for depth feel

function DalaranLamppost({ position, phase }: {
  position: [number, number, number];
  phase: number;
}) {
  const wispRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (wispRef.current) {
      const pulse = 0.85 + Math.sin(t * 1.6 + phase) * 0.15;
      wispRef.current.scale.setScalar(pulse);
      const wispMat = wispRef.current.material as THREE.MeshBasicMaterial;
      wispMat.opacity = 0.85 + Math.sin(t * 1.6 + phase) * 0.10;
    }
    if (haloRef.current) {
      const haloMat = haloRef.current.material as THREE.MeshBasicMaterial;
      haloMat.opacity = 0.20 + Math.sin(t * 1.6 + phase) * 0.06;
    }
  });
  return (
    <group position={position}>
      {/* Base — small stone block */}
      <mesh position={[0, 0.10, 0]}>
        <boxGeometry args={[0.25, 0.20, 0.25]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>
      {/* Pole — slim cylinder */}
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 2.2, 6]} />
        <meshBasicMaterial color="#2a1a3e" />
      </mesh>
      {/* Lantern frame — small cage at top */}
      <mesh position={[0, 2.45, 0]}>
        <boxGeometry args={[0.20, 0.20, 0.20]} />
        <meshBasicMaterial color="#3a2a1c" transparent opacity={0.7} />
      </mesh>
      {/* Wisp orb — warm gold inside the lantern */}
      <mesh ref={wispRef} position={[0, 2.45, 0]}>
        <sphereGeometry args={[0.10, 12, 12]} />
        <meshBasicMaterial color="#ffcb6a" transparent opacity={0.9}
          blending={THREE.AdditiveBlending} fog={false} />
      </mesh>
      {/* Bloom-fake halo — wide additive sphere fakes a glow halo */}
      <mesh ref={haloRef} position={[0, 2.45, 0]}>
        <sphereGeometry args={[0.45, 16, 12]} />
        <meshBasicMaterial color="#ffb84a" transparent opacity={0.20}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}

function DalaranLampposts() {
  // Eight lampposts evenly spaced at radius 8.5, between the agent area
  // (~5–7) and the gothic colonnade (10.5). Phases offset so the lamps
  // don't pulse in lockstep.
  const lamps = useMemo(() => {
    const out: { x: number; z: number; phase: number }[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.PI / N;  // half-step from gates
      out.push({
        x: Math.cos(a) * 8.5,
        z: Math.sin(a) * 8.5,
        phase: i * 0.7,
      });
    }
    return out;
  }, []);
  return (
    <>
      {lamps.map((l, i) => (
        <DalaranLamppost key={i} position={[l.x, 0, l.z]} phase={l.phase} />
      ))}
    </>
  );
}

function SunGodrays() {
  // Six vertical light shafts radiating from the LLM Sun position straight
  // down. Each shaft is a tall thin plane with an additive cream gradient
  // texture; the whole group rotates slowly so the rays sweep across the
  // floor like actual sunbeams. Faked because real volumetric godrays
  // require postprocessing — for an orthographic camera, vertical planes
  // read just fine.
  const groupRef = useRef<THREE.Group>(null);
  const SHAFT_COUNT = 6;
  const SUN_Y = 8;        // matches SUN_POSITION.y
  const SUN_X = -4;       // matches SUN_POSITION.x
  const SUN_Z = -4;       // matches SUN_POSITION.z

  // Single shared geometry — tall vertical plane that reaches sun→ground.
  const shaftGeo = useMemo(() => new THREE.PlaneGeometry(1.4, SUN_Y), []);

  // Shared additive cream gradient texture: bright at top (sun), fading to
  // transparent at bottom (ground). Cheaper than vertex colors.
  const shaftTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0,    'rgba(255,244,196,0.9)');
    grad.addColorStop(0.45, 'rgba(255,224,140,0.4)');
    grad.addColorStop(1,    'rgba(255,212,108,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }, []);

  useFrame((state) => {
    if (groupRef.current) groupRef.current.rotation.y = state.clock.elapsedTime * 0.04;
  });

  return (
    <group ref={groupRef} position={[SUN_X, SUN_Y / 2, SUN_Z]}>
      {Array.from({ length: SHAFT_COUNT }, (_, i) => {
        const a = (i / SHAFT_COUNT) * Math.PI;  // half-rotation since planes are double-sided-equivalent
        return (
          <mesh key={i} rotation={[0, a, 0]} geometry={shaftGeo}>
            <meshBasicMaterial map={shaftTex} transparent opacity={0.18}
              side={THREE.DoubleSide} blending={THREE.AdditiveBlending}
              depthWrite={false} fog={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function AtmosphericMotes() {
  // Three drei <Sparkles> layers at different depths/sizes for parallax.
  // Near = lavender, mid = gold, far = pale blue. The whole field reads as
  // drifting magical motes filling the violet ambient.
  return (
    <>
      <Sparkles count={80}  scale={[14, 6, 14]}  size={2.0} color="#c4a4ff"
        speed={0.4} opacity={0.7} position={[0, 1, 0]} />
      <Sparkles count={120} scale={[20, 8, 20]} size={1.4} color="#ffd97a"
        speed={0.25} opacity={0.5} position={[0, 2, 0]} />
      <Sparkles count={200} scale={[28, 10, 28]} size={0.9} color="#cce0ff"
        speed={0.15} opacity={0.4} position={[0, 3, 0]} />
    </>
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
      {/* Main dark ground — Dalaran D3 marble texture, now lit (PBR-lite).
          Switched from meshBasicMaterial to meshStandardMaterial so the
          procedural marble actually catches the ambient + directional lights
          added to Scene. Roughness 0.55 reads as polished-but-not-mirror;
          metalness 0.18 lets the gold veins pick up subtle highlight. The
          color tint stays so the night palette is preserved. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial map={getMarbleTexture()} color="#9070c0"
          roughness={0.55} metalness={0.18} />
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

// Windows get desynchronized phase + speed offsets so the tower feels inhabited
// rather than blinking in unison. Each window picks once from a handful of
// styles: steady warm, slow breathe, quick flicker (candle), or dark.
const WINDOW_STYLES = [
  { base: 0.55, amp: 0.15, speed: 1.2,  color: '#f0b858' },  // warm, slow breathe
  { base: 0.70, amp: 0.08, speed: 0.8,  color: '#ffc870' },  // brighter, calmer
  { base: 0.35, amp: 0.30, speed: 3.4,  color: '#f0a040' },  // candle flicker
  { base: 0.08, amp: 0.04, speed: 0.6,  color: '#6a5a40' },  // mostly dark
];

function MageTower() {
  const orbRef = useRef<THREE.Mesh>(null);
  const windowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flagRef = useRef<THREE.Mesh>(null);
  const windowStyles = useMemo(
    () => Array.from({ length: 3 }, (_, i) => {
      const s = WINDOW_STYLES[i % WINDOW_STYLES.length]!;
      return { ...s, phase: Math.random() * Math.PI * 2 };
    }),
    [],
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (orbRef.current) {
      orbRef.current.position.y = 4.8 + Math.sin(t * 1.2) * 0.15;
      orbRef.current.rotation.y = t * 0.5;
    }
    windowRefs.current.forEach((ref, i) => {
      if (!ref) return;
      const s = windowStyles[i];
      if (!s) return;
      (ref.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.base + Math.sin(t * s.speed + s.phase) * s.amp);
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
      {/* Window slits — each randomizes style/phase via windowStyles */}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => {
        const s = windowStyles[i]!;
        return (
          <mesh key={i} ref={(el) => { windowRefs.current[i] = el; }}
            position={[Math.cos(angle) * 0.72, 2.0, Math.sin(angle) * 0.72]}
            rotation={[0, -angle, 0]}>
            <planeGeometry args={[0.1, 0.3]} />
            <meshBasicMaterial color={s.color} transparent opacity={s.base} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
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
  const windowRef = useRef<THREE.Mesh>(null);
  const smokeState = useRef([0, 0.3, 0.6].map((p) => ({ y: 2.4 + p, opacity: 0.3 })));
  const windowPhase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    flameRefs.current.forEach((ref, i) => {
      if (ref) ref.scale.y = 0.8 + Math.sin(t * 6 + i * 2) * 0.2;
    });
    // Forge-fire lit window — faster flicker to mimic active forge
    if (windowRef.current) {
      const mat = windowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0.15, 0.55 + Math.sin(t * 4.5 + windowPhase) * 0.25 + Math.sin(t * 11 + windowPhase) * 0.08);
    }
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
      {/* Side window — lit from forge fire inside */}
      <mesh ref={windowRef} position={[1.01, 0.85, 0]}>
        <planeGeometry args={[0.2, 0.15]} />
        <meshBasicMaterial color="#ff9540" transparent opacity={0.6} side={THREE.DoubleSide} />
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

// ─── Dalaran D2 — Architecture silhouette ────────────────────────────────────
//
// Three procedural layers that turn the Sanctum into a Dalaran-shaped plaza
// without any external assets:
//
//   1. DalaranSkyline — eight mage-tower spires evenly placed at radius 14
//      (outside the existing ward wall at 11.5). Varied heights 7..12 give
//      the city a real skyline; warm gold windows pulse against the violet
//      stone. Pure background — never interferes with agent movement.
//   2. VioletCitadel — central focal tower behind the LLM Sun. Three tiers
//      (base / mid / spire) at [-8, 0, -8]; the sun appears to crown its
//      pinnacle from the camera angle.
//   3. GothicColonnade — a ring of 12 columns at radius 10.5, between the
//      agent floor and the wall. Marks the inner plaza and reads as
//      Dalaran's iconic covered walkways without blocking champion sight.

const D2_SPIRE_STONE   = '#1f1230';   // deep violet stone
const D2_SPIRE_WINDOW  = '#f5c518';   // warm gold window glow (on-brand)
const D2_SPIRE_ROOF    = '#0d0820';   // near-silhouette dark roof
const D2_CITADEL_CROWN = '#7c5acc';   // subtle purple-gold accent ring

function DalaranSpire({ position, height, radius, twin = false }: {
  position: [number, number, number];
  height: number;
  radius: number;
  twin?: boolean;
}) {
  const windowRef = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    if (windowRef.current) {
      const t = state.clock.elapsedTime;
      (windowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.55 + Math.sin(t * 0.7 + phase) * 0.18;
    }
  });

  return (
    <group position={position}>
      {/* Tower body — slightly tapered cylinder */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius * 0.82, radius, height, 8]} />
        <meshBasicMaterial color={D2_SPIRE_STONE} />
      </mesh>
      {/* Mid-tier band */}
      <mesh position={[0, height * 0.55, 0]}>
        <cylinderGeometry args={[radius * 0.92, radius * 0.92, 0.22, 8]} />
        <meshBasicMaterial color="#2a1a3e" />
      </mesh>
      {/* Spire roof — tall cone */}
      <mesh position={[0, height + radius * 1.3, 0]}>
        <coneGeometry args={[radius * 0.95, radius * 2.6, 8]} />
        <meshBasicMaterial color={D2_SPIRE_ROOF} />
      </mesh>
      {/* Roof crown ring */}
      <mesh position={[0, height + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.95, radius * 1.08, 12]} />
        <meshBasicMaterial color={D2_CITADEL_CROWN} transparent opacity={0.45}
          side={THREE.DoubleSide} blending={THREE.AdditiveBlending}
          depthWrite={false} fog={false} />
      </mesh>
      {/* Glowing stained-glass window — multi-band texture (gold/violet/
          indigo/rose) at upper third, additive so the panes glow against
          the violet stone. Per-spire phase animates the overall opacity. */}
      <mesh ref={windowRef} position={[0, height * 0.7, radius * 0.85]}>
        <planeGeometry args={[radius * 0.45, radius * 0.65]} />
        <meshBasicMaterial map={getStainedGlassTexture()} transparent opacity={0.65}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {twin && (
        <mesh position={[0, height * 0.7, -radius * 0.85]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[radius * 0.45, radius * 0.65]} />
          <meshBasicMaterial map={getStainedGlassTexture()} transparent opacity={0.45}
            blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
      )}
      {/* Tiny crown pinnacle */}
      <mesh position={[0, height + radius * 2.6, 0]}>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshBasicMaterial color={D2_CITADEL_CROWN} transparent opacity={0.85}
          blending={THREE.AdditiveBlending} fog={false} />
      </mesh>
    </group>
  );
}

function DalaranSkyline() {
  // Eight spires placed evenly around radius 14 (outside the ward wall at
  // 11.5). Varied heights + radii give the skyline a hand-shaped silhouette.
  const spires = useMemo(() => {
    const out: { x: number; z: number; h: number; r: number; twin: boolean }[] = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const a   = (i / N) * Math.PI * 2 + 0.2;
      const r   = 14 + Math.sin(i * 1.7) * 0.7;
      const h   = 7 + ((i * 13) % 5) * 1.1;     // 7..11.4
      const rad = 0.55 + ((i * 7) % 3) * 0.10;
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h, r: rad, twin: i % 2 === 0 });
    }
    return out;
  }, []);
  return (
    <>
      {spires.map((s, i) => (
        <DalaranSpire key={i}
          position={[s.x, 0, s.z]} height={s.h} radius={s.r} twin={s.twin} />
      ))}
    </>
  );
}

function VioletCitadel() {
  // Central Dalaran citadel silhouette behind the LLM Sun. Three-tier
  // (base / mid / spire) at [-8, 0, -8] so it reads as the building the
  // sun is rising in front of from the camera's [14, 12, 14] vantage.
  const orbRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (orbRef.current) {
      const t = state.clock.elapsedTime;
      (orbRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.55 + Math.sin(t * 0.55) * 0.12;
    }
  });
  return (
    <group position={[-8, 0, -8]}>
      {/* Base tier — widest */}
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[1.6, 1.85, 3, 12]} />
        <meshBasicMaterial color={D2_SPIRE_STONE} />
      </mesh>
      {/* Mid tier */}
      <mesh position={[0, 4.5, 0]}>
        <cylinderGeometry args={[1.2, 1.4, 3, 10]} />
        <meshBasicMaterial color="#241638" />
      </mesh>
      {/* Crown ring at base of upper spire */}
      <mesh position={[0, 6.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.25, 1.5, 16]} />
        <meshBasicMaterial color={D2_CITADEL_CROWN} transparent opacity={0.55}
          side={THREE.DoubleSide} blending={THREE.AdditiveBlending}
          depthWrite={false} fog={false} />
      </mesh>
      {/* Upper tower */}
      <mesh position={[0, 9.0, 0]}>
        <cylinderGeometry args={[0.5, 1.1, 5, 8]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>
      {/* Tall spire roof */}
      <mesh position={[0, 13.0, 0]}>
        <coneGeometry args={[0.55, 2.5, 8]} />
        <meshBasicMaterial color={D2_SPIRE_ROOF} />
      </mesh>
      {/* Glow orb at the spire's pinnacle — sells "Citadel hosts the API
          source" framing under the LLM Sun. */}
      <mesh ref={orbRef} position={[0, 14.4, 0]}>
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshBasicMaterial color={D2_CITADEL_CROWN} transparent opacity={0.65}
          blending={THREE.AdditiveBlending} fog={false} />
      </mesh>
      {/* Stained-glass window at mid tier (faces the plaza) — D3 texture
          gives multi-band gold/violet/indigo panes with lead lines. */}
      <mesh position={[0, 4.3, 1.41]}>
        <planeGeometry args={[1.0, 1.6]} />
        <meshBasicMaterial map={getStainedGlassTexture()} transparent opacity={0.7}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Stained-glass at base — wider, dimmer, larger pane count via uv repeat */}
      <mesh position={[0, 1.3, 1.86]}>
        <planeGeometry args={[1.5, 2.0]} />
        <meshBasicMaterial map={getStainedGlassTexture()} transparent opacity={0.55}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}

function RunicGlyphs() {
  // Twelve small glowing glyphs inscribed just outside the ward ring at
  // radius 5.4. Slow group rotation + per-glyph opacity pulse make them
  // read as ancient inlays gradually waking up. All on the same y-plane
  // as the ward (-0.034) so they sit flush with the floor.
  const groupRef = useRef<THREE.Group>(null);
  const phases = useMemo(
    () => Array.from({ length: 12 }, () => Math.random() * Math.PI * 2),
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!groupRef.current) return;
    groupRef.current.rotation.z = t * 0.045; // slow glyph procession
    groupRef.current.children.forEach((child, i) => {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.30 + Math.sin(t * 0.8 + (phases[i] ?? 0)) * 0.18;
    });
  });

  const N = 12;
  const RADIUS = 5.4;
  return (
    <group ref={groupRef} position={[0, -0.034, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {Array.from({ length: N }, (_, i) => {
        const a = (i / N) * Math.PI * 2;
        const x = Math.cos(a) * RADIUS;
        const y = Math.sin(a) * RADIUS;
        const variant = i % 4;
        return (
          <mesh key={i} position={[x, y, 0]} rotation={[0, 0, a + Math.PI / 2]}>
            {variant === 0 && <ringGeometry args={[0.06, 0.11, 6]} />}
            {variant === 1 && <planeGeometry args={[0.20, 0.045]} />}
            {variant === 2 && <ringGeometry args={[0.07, 0.13, 4, 1, 0, Math.PI]} />}
            {variant === 3 && <planeGeometry args={[0.045, 0.20]} />}
            <meshBasicMaterial color="#ffd97a" transparent opacity={0.35}
              blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
              depthWrite={false} fog={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function GothicColonnade() {
  // A ring of 12 slim columns at radius 10.5 — between the agent floor and
  // the perimeter wall. Reads as Dalaran's iconic covered walkways without
  // blocking the camera's view of champions.
  const N = 12;
  const RADIUS = 10.5;
  const HEIGHT = 4.2;
  const positions = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      // Half-step offset so columns sit between the existing wall gates.
      const a = (i / N) * Math.PI * 2 + Math.PI / N;
      out.push([Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS]);
    }
    return out;
  }, []);
  return (
    <>
      {positions.map((p, i) => (
        <group key={i} position={p}>
          {/* Column shaft */}
          <mesh position={[0, HEIGHT / 2, 0]}>
            <cylinderGeometry args={[0.15, 0.18, HEIGHT, 8]} />
            <meshBasicMaterial color="#2a1a3e" />
          </mesh>
          {/* Capital (decorated top) */}
          <mesh position={[0, HEIGHT - 0.10, 0]}>
            <boxGeometry args={[0.42, 0.18, 0.42]} />
            <meshBasicMaterial color={D2_CITADEL_CROWN} transparent opacity={0.8} />
          </mesh>
          {/* Base */}
          <mesh position={[0, 0.10, 0]}>
            <boxGeometry args={[0.36, 0.20, 0.36]} />
            <meshBasicMaterial color="#1a0f28" />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ─── Lich King — permanent custodian of eternal ops stats ───────────────────
//
// A monumental seated figure on a raised throne at [8, 0, -8] (back-right
// from the camera, mirrors the Violet Citadel back-left). Built from
// primitives — no sprite, doesn't roam, doesn't participate in the
// per-session selection flow. He IS the eternal axis: while champions
// (current run group) come and go, the Lich King is always there with the
// all-time numbers above his helm.
//
// Eternal-stat mapping:
//   - totalSpend → headline number on the floating label, also drives the
//     frosty aura's scale (logarithmic, so $100 vs $10k reads proportional)
//   - ghostCount → number of orbiting ghost wisps (capped at 8 so the
//     visual stays clean even with hundreds of failed sessions)
//   - totalSessions → secondary footer number on the label
//
// Frostmourne planted in front of the throne sells the lore reading. Eyes
// pulse blue, sword glows blue, frosty hemispherical mist domes the
// platform. All additive blending so the figure reads against the violet
// floor.

function LichKing({ eternal }: { eternal: EternalStats }) {
  const wispsRef = useRef<THREE.Group>(null);
  const eyeHaloRef = useRef<THREE.Mesh>(null);
  const swordRef = useRef<THREE.Mesh>(null);
  const auraRef  = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (wispsRef.current) wispsRef.current.rotation.y = -t * 0.18;
    // The sprite's eye cavities have a static blue glow baked in. We pulse
    // a small additive halo plane in front of the helm to add the
    // "watching you" feel without animating the texture itself.
    if (eyeHaloRef.current) {
      const pulse = 0.35 + Math.sin(t * 1.4) * 0.20;
      (eyeHaloRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    if (swordRef.current) {
      (swordRef.current.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 0.7) * 0.20;
    }
    if (auraRef.current) auraRef.current.scale.setScalar((auraScale) * (1 + Math.sin(t * 0.45) * 0.04));
  });

  // Aura scales logarithmically with cumulative spend so the figure feels
  // heavier as costs accumulate. $1 → 1.0, $100 → 1.3, $1k → 1.45,
  // $10k → 1.6, $100k → 1.75. Capped at 2.0 so a runaway burn doesn't
  // dominate the scene.
  const auraScale = useMemo(() => {
    return Math.min(2.0, 1 + Math.log10(Math.max(1, eternal.totalSpend)) * 0.15);
  }, [eternal.totalSpend]);

  // Cap ghost wisps at 8 so the orbit stays legible even on accounts with
  // hundreds of failed sessions.
  const wispCount = Math.min(eternal.ghostCount, 8);

  // Format spend — always with thousands separators when ≥$1k.
  const spendLabel = useMemo(() => {
    if (eternal.totalSpend < 100)  return `$${eternal.totalSpend.toFixed(2)}`;
    if (eternal.totalSpend < 1000) return `$${eternal.totalSpend.toFixed(0)}`;
    return `$${eternal.totalSpend.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }, [eternal.totalSpend]);

  return (
    <group position={[8, 0, -8]}>
      {/* Frosty aura — large hemisphere, additive, scales with eternal spend.
          Lifted by +0.20 to follow the new third platform step. */}
      <mesh ref={auraRef} position={[0, 1.4, 0]}>
        <sphereGeometry args={[2.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#4a7fcf" transparent opacity={0.10}
          blending={THREE.AdditiveBlending} side={THREE.BackSide}
          depthWrite={false} fog={false} />
      </mesh>

      {/* Stone platform — wider three-step ziggurat. Earlier the dais was
          two narrow steps (top radius 1.7) which made the Lich King feel
          like he perched in the back-right corner. The pyramid now reads
          as commanding the back-right, balancing the Violet Citadel that
          mirrors from the back-left. Top step still 1.9–2.1 so the throne
          + sprite fit; the wider lower steps spread the visual weight. */}
      <mesh position={[0, 0.10, 0]}>
        <cylinderGeometry args={[3.4, 3.6, 0.20, 24]} />
        <meshBasicMaterial color="#13091e" />
      </mesh>
      <mesh position={[0, 0.30, 0]}>
        <cylinderGeometry args={[2.6, 2.8, 0.20, 20]} />
        <meshBasicMaterial color="#1a1428" />
      </mesh>
      <mesh position={[0, 0.50, 0]}>
        <cylinderGeometry args={[1.9, 2.1, 0.20, 16]} />
        <meshBasicMaterial color="#231a36" />
      </mesh>
      {/* Sweeping front stair — three slim slabs descending toward the
          plaza so the dais reads as approachable, not a sealed plinth.
          Slabs are slightly wider than tall so they read as steps from
          the orthographic camera. */}
      <mesh position={[0, 0.10, 2.4]}>
        <boxGeometry args={[2.0, 0.20, 0.6]} />
        <meshBasicMaterial color="#13091e" />
      </mesh>
      <mesh position={[0, 0.30, 2.0]}>
        <boxGeometry args={[1.6, 0.20, 0.5]} />
        <meshBasicMaterial color="#1a1428" />
      </mesh>
      <mesh position={[0, 0.50, 1.6]}>
        <boxGeometry args={[1.2, 0.20, 0.4]} />
        <meshBasicMaterial color="#231a36" />
      </mesh>

      {/* Throne — back panel + seat + armrests, all lifted +0.20 for the
          new top step at y=0.60. */}
      <mesh position={[0, 2.05, -0.6]}>
        <boxGeometry args={[1.3, 2.6, 0.18]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>
      <mesh position={[0, 0.98, -0.05]}>
        <boxGeometry args={[1.0, 0.18, 0.9]} />
        <meshBasicMaterial color="#241636" />
      </mesh>
      <mesh position={[-0.55, 1.30, -0.05]}>
        <boxGeometry args={[0.18, 0.5, 0.9]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>
      <mesh position={[0.55, 1.30, -0.05]}>
        <boxGeometry args={[0.18, 0.5, 0.9]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>

      {/* Lich body — hand-drawn pixel sprite (Arthas-style: horns + skull
          pauldrons + chest skull + ornate cape + frost mist around boots).
          128×192 source, billboard so it always faces the camera. Scale
          3.8×5.4. Feet anchor to top step (y=0.60); sprite center =
          0.60 + 5.4/2 = 3.30. */}
      <sprite scale={[3.8, 5.4, 1]} position={[0, 3.30, 0.05]}>
        <spriteMaterial map={getLichKingTexture()} transparent alphaTest={0.05} fog={false} />
      </sprite>
      {/* Eye-glow halo — pulses in front of the helm. Sits at world y =
          3.30 + 1.52 = 4.82, in z=0.20 to stay forward of the sprite. */}
      <mesh ref={eyeHaloRef} position={[0, 4.82, 0.20]}>
        <planeGeometry args={[0.95, 0.22]} />
        <meshBasicMaterial color="#5cd2ff" transparent opacity={0.40}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Ground frost ring — sits on the new top step (y=0.62) around the
          boots. Slightly wider than the top step so it spills onto the
          mid step, reinforcing the multi-tier dais. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.62, 0]}>
        <ringGeometry args={[0.9, 2.2, 48]} />
        <meshBasicMaterial color="#5cd2ff" transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>

      {/* Frostmourne — planted blade-up in front of the throne. Lifted
          +0.20 to anchor on the top step, blade still extends upward
          past the Lich's chest. */}
      <group position={[0, 0.7, 0.55]}>
        {/* Dalaran D5 — wide bloom-fake halo around the blade. Cylinder
            with very low additive opacity so Frostmourne reads as bloomed
            without postprocessing. */}
        <mesh position={[0, 0.95, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 1.9, 12, 1, true]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.06}
            blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
            depthWrite={false} fog={false} />
        </mesh>
        {/* Blade glow (wider, additive) */}
        <mesh ref={swordRef} position={[0, 0.95, 0]}>
          <boxGeometry args={[0.12, 1.7, 0.03]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.85}
            blending={THREE.AdditiveBlending} fog={false} />
        </mesh>
        {/* Blade core (solid, dark) */}
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[0.06, 1.7, 0.012]} />
          <meshBasicMaterial color="#0f1a2a" />
        </mesh>
        {/* Crossguard */}
        <mesh position={[0, 0.10, 0]}>
          <boxGeometry args={[0.34, 0.06, 0.10]} />
          <meshBasicMaterial color="#1a0f28" />
        </mesh>
        {/* Hilt */}
        <mesh position={[0, -0.10, 0]}>
          <boxGeometry args={[0.06, 0.30, 0.06]} />
          <meshBasicMaterial color="#241636" />
        </mesh>
        {/* Pommel — blue gem */}
        <mesh position={[0, -0.30, 0]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.85}
            blending={THREE.AdditiveBlending} fog={false} />
        </mesh>
      </group>

      {/* Ghost wisps — orbiting at varied radii/heights, count = ghostCount
          capped at 8. Souls of failed sessions made visual. */}
      <group ref={wispsRef} position={[0, 1.6, 0]}>
        {Array.from({ length: wispCount }, (_, i) => {
          const a = (i / Math.max(1, wispCount)) * Math.PI * 2;
          const r = 1.85 + (i % 2) * 0.35;
          const y = (i % 3) * 0.45 - 0.30;
          return (
            <mesh key={i} position={[Math.cos(a) * r, y, Math.sin(a) * r]}>
              <sphereGeometry args={[0.10, 8, 8]} />
              <meshBasicMaterial color="#9cccff" transparent opacity={0.55}
                blending={THREE.AdditiveBlending} fog={false} />
            </mesh>
          );
        })}
      </group>

      {/* Floating eternal-stats label above the helm */}
      <Html center position={[0, 4.4, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontFamily: 'monospace',
          color: '#5cd2ff',
          background: 'rgba(8,10,28,0.88)',
          border: '1px solid #5cd2ff66',
          borderRadius: 3,
          padding: '4px 9px 5px',
          fontSize: 9,
          letterSpacing: 1,
          whiteSpace: 'nowrap',
          textShadow: '0 0 4px #5cd2ff66',
          userSelect: 'none',
          textAlign: 'center',
          boxShadow: '0 0 12px rgba(92,210,255,0.18)',
        }}>
          <div style={{
            fontFamily: '"Cinzel", serif',
            fontSize: 9, fontWeight: 700, opacity: 0.85,
            letterSpacing: 3, marginBottom: 3,
          }}>
            ETERNAL · LICH KING
          </div>
          <div style={{ fontWeight: 'bold' }}>{spendLabel} spent</div>
          <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1 }}>
            {eternal.ghostCount} ghosts · {eternal.totalSessions} sessions
          </div>
        </div>
      </Html>
    </group>
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

// ─── Stage Rim ──────────────────────────────────────────────────────────────
//
// Flat annular ring on the floor at radius 8.0–8.5 framing the champion
// performance area. Champions roam to ±5.5 (waypoint corners ≈ 7.8 from
// origin) so the rim sits *just outside* their reach — defines the stage
// edge without obstructing movement. 12 additive cyan rune marks ride on
// the lip giving the eye anchor points around the circle. Pure decals,
// no vertical extrusion (a 3D lip would clip champions at corner waypoints).

function StageRim() {
  return (
    <group>
      {/* Outer dark band — reads as the cut stone edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[8.00, 8.50, 96]} />
        <meshBasicMaterial color="#160a26" side={THREE.DoubleSide} />
      </mesh>
      {/* Inner lighter highlight — sells the chamfered top of the lip */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry args={[7.92, 8.02, 96]} />
        <meshBasicMaterial color="#3a2a5a" side={THREE.DoubleSide} />
      </mesh>
      {/* 12 rune marks evenly spaced around the rim — each rotated tangent
          to the circle so they read as engraved glyphs, not floating tags */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const r = 8.22;
        return (
          <mesh
            key={i}
            rotation={[-Math.PI / 2, 0, -a]}
            position={[Math.cos(a) * r, 0.05, Math.sin(a) * r]}
          >
            <planeGeometry args={[0.45, 0.18]} />
            <meshBasicMaterial color="#5cd2ff" transparent opacity={0.42}
              blending={THREE.AdditiveBlending} depthWrite={false}
              side={THREE.DoubleSide} fog={false} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Atmospheric Fog Bands ───────────────────────────────────────────────────
//
// Stacked additive planes at the back of the scene push the Citadel and
// Lich King visually deeper into haze, so the foreground action pops. Sits
// in front of the existing `<fog>` distance fog (which fades the wall but
// is too uniform to give directional depth on its own). Gated behind
// perfLevel since 4 large additive quads cost real fillrate on weak GPUs.

function AtmosphericFog() {
  const perf = usePerfLevel();
  if (perf === 'low') return null;
  return (
    <group>
      {/* Far back band — widest, lowest opacity, deepest position */}
      <mesh position={[0, 3.5, -13]}>
        <planeGeometry args={[40, 7]} />
        <meshBasicMaterial color="#2a1e4a" transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
      {/* Mid back band — tighter wash sitting in front of the far band */}
      <mesh position={[0, 2.5, -10]}>
        <planeGeometry args={[32, 5]} />
        <meshBasicMaterial color="#1a1438" transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
      {/* Side bands — subtler flanks angled inward, frame the wings */}
      <mesh position={[-12, 2.8, -3]} rotation={[0, Math.PI / 4, 0]}>
        <planeGeometry args={[16, 5]} />
        <meshBasicMaterial color="#1c1240" transparent opacity={0.12}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[12, 2.8, -3]} rotation={[0, -Math.PI / 4, 0]}>
        <planeGeometry args={[16, 5]} />
        <meshBasicMaterial color="#1c1240" transparent opacity={0.12}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ─── Stage Lights ───────────────────────────────────────────────────────────
//
// Six tall warm-gold glow columns at the rim (radius 8.7), offset 30°
// so none align with the cardinal axes. Each pairs a soft additive
// cylinder ("flame body"), a brighter pulsing core sphere ("flame head"),
// a stone pedestal at the base, and a small ground rune ring. Adds the
// "ten thousand candles" stage feel and balances the cyan/violet palette
// with a warm complement. Cores pulse asynchronously via per-light phase
// offset so the stage doesn't strobe in unison.

function StageLights() {
  const positions = useMemo<Array<[number, number]>>(() => {
    const arr: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      arr.push([Math.cos(a) * 8.7, Math.sin(a) * 8.7]);
    }
    return arr;
  }, []);

  const coreRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    coreRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const phase = t * 1.4 + i * 0.7;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(phase) * 0.20;
    });
  });

  return (
    <>
      {positions.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {/* Stone pedestal */}
          <mesh position={[0, 0.10, 0]}>
            <cylinderGeometry args={[0.20, 0.24, 0.20, 12]} />
            <meshBasicMaterial color="#1a0f28" />
          </mesh>
          {/* Flame body — tall additive cylinder */}
          <mesh position={[0, 1.05, 0]}>
            <cylinderGeometry args={[0.18, 0.10, 2.0, 12, 1, true]} />
            <meshBasicMaterial color="#f5c518" transparent opacity={0.22}
              blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
              depthWrite={false} fog={false} />
          </mesh>
          {/* Flame core — bright pulsing head */}
          <mesh
            ref={(m) => { coreRefs.current[i] = m; }}
            position={[0, 0.55, 0]}
          >
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshBasicMaterial color="#ffd97a" transparent opacity={0.85}
              blending={THREE.AdditiveBlending} fog={false} depthWrite={false} />
          </mesh>
          {/* Ground rune ring at the base */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
            <ringGeometry args={[0.32, 0.42, 18]} />
            <meshBasicMaterial color="#f5c518" transparent opacity={0.40}
              blending={THREE.AdditiveBlending} depthWrite={false}
              side={THREE.DoubleSide} fog={false} />
          </mesh>
        </group>
      ))}
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
      <CenterPortal />
      {/* Stage frame — defines the inside/outside of the performance area
          so the eye reads the plaza as a stage instead of an open courtyard.
          The rim alone gives the floor an edge; the warm rim lights add the
          theatre feel and balance the cyan/violet palette with gold. The
          back fog band pushes the Citadel + Lich King visually deeper so
          the foreground action pops. */}
      <StageRim />
      <StageLights />
      <AtmosphericFog />
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
      {/* Dalaran D2 — architecture skyline. Backdrop-only; never crowds the
          agent floor. Skyline at radius 14, citadel at [-8,0,-8] behind the
          sun, colonnade ring at radius 10.5 between agents and wall. */}
      <DalaranSkyline />
      <VioletCitadel />
      <GothicColonnade />
      {/* Dalaran D3 — runic glyphs ring just outside the ward ring,
          slowly rotating with per-glyph pulse. */}
      <RunicGlyphs />
      {/* Dalaran D4 — magical lights + sparkles + faked godrays. All
          procedural; no postprocessing dep. */}
      <DalaranLampposts />
      <SunGodrays />
      <AtmosphericMotes />
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

function WoWNameplate({ pn, maxCost, selected, nowEpoch, possessed }: {
  pn: PositionedNode; maxCost: number; maxTokens: number; selected: boolean;
  nowEpoch: number; possessed: boolean;
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
  // Last-active chip: ended_at for completed sessions, started_at+duration as fallback
  const lastActiveIso = pn.session.ended_at
    ?? (pn.session.started_at
      ? new Date(new Date(pn.session.started_at).getTime() + (pn.session.duration_seconds ?? 0) * 1000).toISOString()
      : null);
  const recency = running ? 'live' : formatRelativeTime(lastActiveIso, nowEpoch);

  return (
    <Html center position={[0, 3.8, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 140, background: 'rgba(8,6,14,.88)',
        border: `1px solid ${possessed ? '#f59e0b' : selected ? '#63f7b3' : c.color}99`,
        borderRadius: 3, padding: '4px 7px 5px',
        fontFamily: 'monospace', userSelect: 'none',
        boxShadow: possessed ? '0 0 14px #f59e0b99' : selected ? `0 0 10px ${c.aura}66` : 'none',
        // Absorb clicks so reading the nameplate doesn't trigger the
        // Canvas's onPointerMissed deselect. <Html> wrapper still has
        // pointer-events:none so the rest of the overlay is click-through.
        pointerEvents: 'auto', cursor: 'default',
      }}
      onClick={(e) => e.stopPropagation()}>
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

        {/* Recency chip — "● live" for running, "Xm ago" for completed */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', marginTop: 2,
          fontSize: 9, fontVariantNumeric: 'tabular-nums',
          color: running ? '#4ade8099' : '#d4a96a99',
        }}>
          <span>{running ? '● live' : recency}</span>
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

function WoWChampionNode({ pn, maxCost, maxTokens, selected, onClick, onPosUpdate, parentPos, livePosMap, controlsRef, isDraggingRef, nowEpoch, possessed, moveInputRef, cursorGroundRef, moveOrdersRef }: {
  pn:              PositionedNode;
  maxCost:         number;
  maxTokens:       number;
  selected:        boolean;
  onClick:         () => void;
  onPosUpdate:     (id: string, pos: THREE.Vector3) => void;
  parentPos:       THREE.Vector3 | null;
  livePosMap:      React.MutableRefObject<Map<string, THREE.Vector3>>;
  controlsRef:     React.RefObject<any>;
  isDraggingRef:   React.MutableRefObject<boolean>;
  nowEpoch:        number;
  possessed:       boolean;
  moveInputRef:    React.MutableRefObject<{ x: number; z: number }>;
  cursorGroundRef: React.MutableRefObject<THREE.Vector3>;
  moveOrdersRef:   React.MutableRefObject<Map<string, THREE.Vector3 | null>>;
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
  // Phase B — per-session identity. Drives the 3D tag, the pedestal accent
  // ring, and a slight aura tint blend so two same-class champions are
  // distinguishable at a glance without click. Stable per session_id.
  const ident       = useMemo(() => sessionIdentifier(pn.session), [pn.session.session_id, pn.session.git_branch]);
  const auraBlended = useMemo(() => blendHex(c.aura, ident.accent, 0.25), [c.aura, ident.accent]);

  // Trail particle color per character
  // Activity recency: 1.0 = fresh, 0.0 = cold (>60 min since ended_at)
  const recencyBoost = useMemo(() => {
    if (!pn.session.is_ghost) return 1.0; // running = freshest
    const iso = pn.session.ended_at
      ?? (pn.session.started_at
        ? new Date(new Date(pn.session.started_at).getTime() + (pn.session.duration_seconds ?? 0) * 1000).toISOString()
        : null);
    const mins = ageMinutes(iso, nowEpoch);
    return Math.max(0, Math.min(1, 1 - mins / 60));
  }, [pn.session.is_ghost, pn.session.ended_at, pn.session.started_at, pn.session.duration_seconds, nowEpoch]);

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

    // ── Possession: WASD drive + cursor facing + ground-order walk ──
    let moving = false;
    if (possessed) {
      const mi = moveInputRef.current;
      const magSq = mi.x * mi.x + mi.z * mi.z;
      if (magSq > 0.01) {
        // WASD input — drive directly
        const mag   = Math.sqrt(magSq);
        const speed = movProf.speed * 1.2;
        velocityRef.current = Math.min(speed, velocityRef.current + delta * speed * 5);
        livePosRef.current.x += (mi.x / mag) * velocityRef.current * delta;
        livePosRef.current.z += (mi.z / mag) * velocityRef.current * delta;
        moving = true;
        if (spriteRef.current) {
          const faceDir = mi.x > 0 ? 1 : mi.x < 0 ? -1 : (spriteRef.current.scale.x > 0 ? 1 : -1);
          spriteRef.current.scale.x = Math.abs(spriteRef.current.scale.x) * faceDir;
        }
      } else {
        // No WASD — check for one-shot move order
        const order = moveOrdersRef.current.get(pn.session.session_id);
        if (order) {
          const dx = order.x - livePosRef.current.x;
          const dz = order.z - livePosRef.current.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 0.25) {
            moveOrdersRef.current.set(pn.session.session_id, null);
            velocityRef.current = 0;
          } else {
            const speed = movProf.speed * 1.2;
            const easeOut = Math.min(1, dist / 0.6);
            velocityRef.current = Math.min(speed, velocityRef.current + delta * speed * 5) * easeOut;
            const step = velocityRef.current * delta;
            livePosRef.current.x += (dx / dist) * Math.min(step, dist);
            livePosRef.current.z += (dz / dist) * Math.min(step, dist);
            moving = true;
            if (spriteRef.current) {
              const faceDir = dx > 0 ? 1 : -1;
              spriteRef.current.scale.x = Math.abs(spriteRef.current.scale.x) * faceDir;
            }
          }
        } else {
          velocityRef.current = Math.max(0, velocityRef.current - delta * 4);
          // Face cursor when idle
          if (spriteRef.current) {
            const cx = cursorGroundRef.current.x - livePosRef.current.x;
            const faceDir = cx > 0 ? 1 : cx < 0 ? -1 : (spriteRef.current.scale.x > 0 ? 1 : -1);
            spriteRef.current.scale.x = Math.abs(spriteRef.current.scale.x) * faceDir;
          }
        }
      }
      // Clamp to plaza bounds
      livePosRef.current.x = Math.max(-10.5, Math.min(10.5, livePosRef.current.x));
      livePosRef.current.z = Math.max(-10.5, Math.min(10.5, livePosRef.current.z));
      // Walk cycle
      if (moving) {
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
    } else if (!dragActive.current) {
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
      // Recency decay: older sessions fade toward ghost-alpha, never below 0.4
      const recencyAlpha = 0.4 + 0.6 * recencyBoost;
      (spriteRef.current.material as THREE.SpriteMaterial).opacity = spawnEase * recencyAlpha;
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
      const auraRecency = 0.4 + 0.6 * recencyBoost;
      (ringRef.current.material as THREE.MeshStandardMaterial).opacity =
        (0.35 + auraPulse * 0.1) * (1 + dragLift.current * 0.4) * auraRecency;
    }
  });

  return (
    <group ref={groupRef} position={pn.pos}>
      {/* Phase B — pedestal accent ring. Hash-derived accent color, sits
          just outside the floor aura so two same-class champions read
          differently at a glance. Subtle (opacity 0.45, additive). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <ringGeometry args={[1.10, 1.22, 48]} />
        <meshBasicMaterial color={ident.accent} transparent opacity={0.45}
          blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
          depthWrite={false} fog={false} />
      </mesh>
      {/* Stage spotlight glyph — outer rune circle that's always visible
          under the champion. Sits just outside the pulsing aura ring and
          stays steady (no scale animation), so each champion reads as
          having a permanent "spot" on the stage even when the aura is at
          its low pulse. Uses class colour blended toward the session
          accent so two same-class champions can still be told apart. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <ringGeometry args={[1.10, 1.22, 48]} />
        <meshBasicMaterial color={auraBlended} transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>
      {/* Floor aura — class color blended 25% toward the session accent so
          the family resemblance stays clear, but each champion has its own
          tint. */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.8, 1.05, 32]} />
        <meshStandardMaterial color={auraBlended} emissive={auraBlended} emissiveIntensity={0.5}
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
      {/* Phase B — always-on session tag. Branch tail when present, else
          a 4-char hash. Tinted with the session's accent so the visual
          variation (pedestal ring, aura blend) reads as the same identity.
          Subtle (8.5px monospace, 80% alpha) so it never fights the
          character art. */}
      <Html center position={[0, 3.05, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontSize: 8.5,
          color: ident.accent,
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          letterSpacing: 1,
          textShadow: `0 0 4px ${ident.accent}66, 0 0 2px rgba(0,0,0,.9)`,
          userSelect: 'none',
          opacity: 0.85,
          textAlign: 'center',
        }}>
          {ident.tag}
        </div>
      </Html>
      {/* Selection pulse rings */}
      {selected && <SelectionPulseRings color={c.aura} />}
      {/* Trail particles */}
      <CharacterTrail color={trailColor} isMoving={isMovingRef} />
      <FootstepDust isMoving={isMovingRef} />
      {/* Nameplate is click-to-open: hidden by default, shows only when this
          character is selected (or possessed by an admin). Keeps the Sanctum
          floor readable instead of plastered with HUD cards. */}
      {(selected || possessed) && (
        <WoWNameplate pn={pn} maxCost={maxCost} maxTokens={maxTokens} selected={selected}
          nowEpoch={nowEpoch} possessed={possessed} />
      )}
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

// Flowing ley line: parent → child particle stream. Vertex-colored gradient
// along the arc so the line reads its direction; 6 orbs flow parent-to-child
// in a staggered convoy, each tinted by its position along the gradient.
function DynamicLeyLine({ childId, parentId, color, parentColor, livePosMap }: {
  childId:     string;
  parentId:    string;
  color:       string;
  parentColor: string;
  livePosMap:  React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const SEG = 32;
  const ORB_COUNT = 6;

  const parentC = useMemo(() => new THREE.Color(parentColor), [parentColor]);
  const childC  = useMemo(() => new THREE.Color(color), [color]);

  // Gradient line (vertex colors go parent → child along the arc)
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const colors = new Float32Array((SEG + 1) * 3);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const c = new THREE.Color().lerpColors(parentC, childC, t);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [parentC, childC]);

  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, linewidth: 2 }),
    [],
  );
  const lineObj = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);

  // Convoy of flowing orbs, phases staggered evenly along 0..1
  const orbRefs = useRef<(THREE.Mesh | null)[]>([]);
  const orbColors = useMemo(
    () => Array.from({ length: ORB_COUNT }, (_, i) => {
      const t = i / (ORB_COUNT - 1);
      return new THREE.Color().lerpColors(parentC, childC, t);
    }),
    [parentC, childC],
  );
  const phase = useRef(0);

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

    // Update line geometry positions only — colors stay constant
    const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const pts = curve.getPoints(SEG);
    for (let i = 0; i <= SEG; i++) {
      const p = pts[i]!;
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;

    // Convoy flows parent → child
    phase.current = (phase.current + delta * 0.42) % 1;
    for (let i = 0; i < ORB_COUNT; i++) {
      const ref = orbRefs.current[i];
      if (!ref) continue;
      const t = (phase.current + i / ORB_COUNT) % 1;
      ref.position.copy(curve.getPoint(t));
      // Breathe: brighter in the middle of the arc, softer at endpoints
      const breath = Math.sin(t * Math.PI);
      ref.scale.setScalar(0.75 + breath * 0.45);
      const mat = ref.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.55 + breath * 0.40;
    }

    // Line opacity pulses faintly with a travelling wave
    lineMat.opacity = 0.55 + Math.sin(state.clock.elapsedTime * 2.5) * 0.15;
  });

  return (
    <>
      <primitive object={lineObj} />
      {orbColors.map((c, i) => (
        <mesh key={i} ref={(el) => { orbRefs.current[i] = el; }}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial
            color={c} emissive={c} emissiveIntensity={5}
            transparent opacity={0.7}
          />
        </mesh>
      ))}
    </>
  );
}

// ─── Cursor Tracker (raycasts mouse into the scene for possession facing) ───

function CursorTracker({ cursorGroundRef }: {
  cursorGroundRef: React.MutableRefObject<THREE.Vector3>;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const raycaster   = new THREE.Raycaster();
    const hit         = new THREE.Vector3();
    const onMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        cursorGroundRef.current.copy(hit);
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [camera, gl, cursorGroundRef]);
  return null;
}

// ─── LLM Sun & Compute Rays ──────────────────────────────────────────────────
//
// A radiant orb above the plaza, the visible heartbeat of the API. Brightness
// scales with token volume across the current run group; color reflects the
// active model tier (haiku=lemon, sonnet=cream, opus=amber, codex=ice blue);
// click opens a spend + cache panel; eclipse state triggers when ghost ratio
// exceeds 50% (the run group is mostly failures).
//
// Compute rays — curved bezier particle streams flowing sun → each agent —
// remain unchanged below; they read the same agent color as before.

const SUN_POSITION = new THREE.Vector3(-4, 8, -4);

// Sentinel selection ID used when the sun's panel is open. Champions never
// have this session_id, so all WoWNameplates stay closed while the sun is
// selected.
const SUN_SELECTION_ID = '__llm_sun__';

type ModelTier = 'haiku' | 'sonnet' | 'opus' | 'codex' | 'mixed' | 'unknown';

interface SunBinding {
  modelTier:      ModelTier;
  modelLabel:     string;   // raw most-recent model name, for display
  loadFactor:     number;   // 0..1 — drives brightness multiplier
  totalSpendUsd:  number;
  totalTokens:    number;
  sessionCount:   number;
  ghostCount:     number;
  cacheHitRate:   number;   // 0..1
  avgDurationMin: number;
  eclipsed:       boolean;
}

const TIER_PALETTE: Record<ModelTier, {
  core: string; inner: string; halo: string; corona: string; ray: string; label: string;
}> = {
  haiku:   { core: '#fff8d0', inner: '#fffbe8', halo: '#ffe89a', corona: '#ffd060', ray: '#ffe5a0', label: 'HAIKU'   },
  sonnet:  { core: '#ffd97a', inner: '#fff4c4', halo: '#ffb84a', corona: '#f59e0b', ray: '#ffcb6a', label: 'SONNET'  },
  opus:    { core: '#ff9a3c', inner: '#ffc880', halo: '#ff7a20', corona: '#d65010', ray: '#ff8c40', label: 'OPUS'    },
  codex:   { core: '#a0d8ff', inner: '#d8eeff', halo: '#70b8ff', corona: '#3a8cd0', ray: '#a0c8ff', label: 'CODEX'   },
  mixed:   { core: '#e0c0ff', inner: '#f0e0ff', halo: '#b890ff', corona: '#8060d0', ray: '#c0a0ff', label: 'MIXED'   },
  unknown: { core: '#cccccc', inner: '#eeeeee', halo: '#999999', corona: '#666666', ray: '#bbbbbb', label: '—'       },
};

function modelTierOf(model: string | null | undefined): ModelTier {
  // Defensive: real session rows can have model=null (e.g. when the source
  // log didn't carry a model field). Treat as 'unknown' instead of crashing.
  const m = (model ?? '').toLowerCase();
  if (!m)                                             return 'unknown';
  if (m.includes('haiku'))                            return 'haiku';
  if (m.includes('opus'))                             return 'opus';
  if (m.includes('sonnet'))                           return 'sonnet';
  if (m.includes('gpt') || m.includes('codex')
      || m.includes('o1') || m.includes('o3')
      || m.includes('o4'))                            return 'codex';
  return 'unknown';
}

function deriveSunBinding(nodes: ReadonlyArray<{ session: Session }>): SunBinding {
  if (nodes.length === 0) {
    return {
      modelTier: 'unknown', modelLabel: '—',
      loadFactor: 0, totalSpendUsd: 0, totalTokens: 0,
      sessionCount: 0, ghostCount: 0, cacheHitRate: 0,
      avgDurationMin: 0, eclipsed: true,
    };
  }
  // Pick a "current" model: latest started_at among non-ghosts (fall back to
  // all nodes if every session is a ghost).
  const live = nodes.filter((n) => !n.session.is_ghost);
  const pool = live.length ? live : nodes;
  const latest = pool.reduce((a, b) =>
    (a.session.started_at ?? '') > (b.session.started_at ?? '') ? a : b,
  );
  const modelLabel = latest.session.model ?? '—';

  // Tier roll-up: if all nodes share one tier, use it; if Anthropic + Codex
  // mix, label MIXED; otherwise fall back to the latest model's tier.
  const tiers = new Set(nodes.map((n) => modelTierOf(n.session.model)));
  let modelTier: ModelTier;
  if (tiers.size === 1) {
    modelTier = [...tiers][0] ?? 'unknown';
  } else if (
    tiers.has('codex') &&
    (tiers.has('sonnet') || tiers.has('opus') || tiers.has('haiku'))
  ) {
    modelTier = 'mixed';
  } else {
    modelTier = modelTierOf(modelLabel);
  }

  const totalSpendUsd  = nodes.reduce((s, n) => s + (n.session.estimated_cost_usd ?? 0), 0);
  const totalTokens    = nodes.reduce((s, n) => s + (n.session.total_tokens       ?? 0), 0);
  const ghostCount     = nodes.filter((n) => n.session.is_ghost).length;
  const sessionCount   = nodes.length;
  const cacheRead      = nodes.reduce((s, n) => s + (n.session.cache_read_tokens ?? 0), 0);
  const inputTokens    = nodes.reduce((s, n) => s + (n.session.input_tokens      ?? 0), 0);
  const cacheHitRate   = (cacheRead + inputTokens) > 0 ? cacheRead / (cacheRead + inputTokens) : 0;
  const avgDurationMin = (nodes.reduce((s, n) => s + (n.session.duration_seconds ?? 0), 0)
                          / nodes.length) / 60;

  // Brightness load: log-ish ramp, capped at 1M tokens for full brightness.
  const loadFactor = Math.min(1, totalTokens / 1_000_000);

  // Eclipse: ghost ratio > 50% on a non-trivial run group → API/work mostly
  // failed. Single-session runs are too noisy to eclipse.
  const eclipsed = sessionCount >= 3 && (ghostCount / sessionCount) > 0.5;

  return {
    modelTier, modelLabel,
    loadFactor, totalSpendUsd, totalTokens,
    sessionCount, ghostCount, cacheHitRate,
    avgDurationMin, eclipsed,
  };
}

function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function SunPanelRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#888' }}>{k}</span>
      <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

// Streaming-token emitter — fires inside the open LLM Sun panel. Spawns one
// short JSON-ish text fragment every ~280ms; each token drifts up-and-right
// from the panel's right edge over 1.6s, fading as it goes. Visually evokes
// the model "writing tokens" out of the card in real time. Pure CSS keyframe
// animation, no rAF, so it's effectively free.
function ModelCardEmitter({ binding, palette }: {
  binding: SunBinding;
  palette: typeof TIER_PALETTE[ModelTier];
}) {
  const [tokens, setTokens] = useState<{ id: number; text: string; dx: number; dy: number }[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    // Token seeds — mix of real numbers from the binding + JSON-glyph
    // filler. Random pick per spawn so the stream looks like genuine
    // model output rather than scripted text.
    const seeds: string[] = [
      `"${palette.label.toLowerCase()}"`,
      `"$${binding.totalSpendUsd.toFixed(4)}"`,
      formatTokens(binding.totalTokens),
      `${(binding.cacheHitRate * 100).toFixed(0)}%`,
      `${binding.sessionCount} sess`,
      `${binding.avgDurationMin.toFixed(1)}m`,
      '{', '}', '"', ':', ',', '[', ']',
      '"model"', '"spend"', '"tokens"', '"cache"',
    ];
    const iv = setInterval(() => {
      const text = seeds[Math.floor(Math.random() * seeds.length)] ?? '"';
      const dx = 60 + Math.random() * 90;          // 60..150 px right
      const dy = -45 + (Math.random() - 0.5) * 50; // upward with vertical spread
      const id = idRef.current++;
      setTokens(prev => [...prev, { id, text, dx, dy }]);
      // Auto-prune after the animation finishes so the array doesn't grow.
      setTimeout(() => setTokens(prev => prev.filter(t => t.id !== id)), 1700);
    }, 280);
    return () => clearInterval(iv);
  }, [binding, palette.label]);

  return (
    <>
      {tokens.map(t => (
        <span
          key={t.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '100%',
            color: palette.corona,
            fontSize: 9,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            opacity: 0,
            animation: 'sun-token-drift 1.6s ease-out forwards',
            textShadow: `0 0 4px ${palette.halo}88`,
            pointerEvents: 'none',
            ...({ '--dx': `${t.dx}px`, '--dy': `${t.dy}px` } as Record<string, string>),
          } as React.CSSProperties}
        >{t.text}</span>
      ))}
      <style>{`
        @keyframes sun-token-drift {
          0%   { opacity: 0; transform: translate(0, 0); }
          12%  { opacity: 1; }
          70%  { opacity: 0.85; }
          100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
        }
      `}</style>
    </>
  );
}

function ClaudeSun({ binding, selected, onClick }: {
  binding:  SunBinding;
  selected: boolean;
  onClick:  () => void;
}) {
  const coreRef  = useRef<THREE.Mesh>(null);
  const haloRef  = useRef<THREE.Mesh>(null);
  const halo2Ref = useRef<THREE.Mesh>(null);
  const raysRef  = useRef<THREE.Group>(null);

  const palette  = TIER_PALETTE[binding.modelTier];
  const eclipsed = binding.eclipsed;
  // Eclipse dims everything to ~12%. Otherwise: 0.55 baseline + up to 0.45 from
  // load factor — even an idle Sanctum reads as "API is awake."
  const brightness = eclipsed ? 0.12 : (0.55 + binding.loadFactor * 0.45);

  const rayGeom = useMemo(() => new THREE.PlaneGeometry(0.6, 6), []);
  const rayMats = useMemo(
    () => Array.from({ length: 12 }, () => new THREE.MeshBasicMaterial({
      color: palette.ray, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })),
    // Recolor when model tier changes.
    [palette.ray],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * 0.6) * 0.04;
      coreRef.current.scale.setScalar(pulse);
      const mat = coreRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.95 * brightness;
    }
    if (haloRef.current) {
      (haloRef.current.material as THREE.MeshBasicMaterial).opacity =
        (0.30 + Math.sin(t * 0.5) * 0.05) * brightness;
    }
    if (halo2Ref.current) {
      halo2Ref.current.rotation.z = t * 0.05;
      (halo2Ref.current.material as THREE.MeshBasicMaterial).opacity =
        (0.14 + Math.sin(t * 0.8) * 0.04) * brightness;
    }
    if (raysRef.current) {
      raysRef.current.rotation.y = t * 0.08;
      raysRef.current.children.forEach((child, i) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = (0.12 + Math.abs(Math.sin(t * 0.9 + i * 0.7)) * 0.14) * brightness;
      });
    }
  });

  return (
    <group position={SUN_POSITION.toArray()}>
      {/* Click target — invisible sphere wrapping the visible meshes so the
          radiating rays don't have to be pickable. */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        <sphereGeometry args={[2.0, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Core orb */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.2, 24, 24]} />
        <meshBasicMaterial color={palette.core} transparent opacity={0.95} fog={false} />
      </mesh>
      {/* Inner hot core */}
      <mesh>
        <sphereGeometry args={[0.75, 16, 16]} />
        <meshBasicMaterial color={palette.inner} transparent opacity={1} fog={false} />
      </mesh>
      {/* Soft halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[1.8, 24, 24]} />
        <meshBasicMaterial color={palette.halo} transparent opacity={0.30}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Outer corona */}
      <mesh ref={halo2Ref}>
        <sphereGeometry args={[2.6, 24, 24]} />
        <meshBasicMaterial color={palette.corona} transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Dalaran D5 — wide bloom-fake corona. Very low opacity additive
          sphere at 2× the corona radius. No animation; sits steady so the
          sun reads as bloomed without postprocessing. */}
      <mesh>
        <sphereGeometry args={[5.0, 16, 16]} />
        <meshBasicMaterial color={palette.halo} transparent opacity={0.05}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[7.5, 16, 16]} />
        <meshBasicMaterial color={palette.core} transparent opacity={0.025}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Selection ring — visible only when the sun is the active selection */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.9, 3.05, 64]} />
          <meshBasicMaterial color={palette.corona} transparent opacity={0.85}
            side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
        </mesh>
      )}
      {/* Radiating ray planes (crossed billboards) */}
      <group ref={raysRef}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <mesh key={i} rotation={[0, a, 0]} geometry={rayGeom} material={rayMats[i]!} />
          );
        })}
      </group>

      {/* Always-on "LLM SUN" label above the orb. Cinzel for the engraved
          headline, monospace for the tier subtitle. Sits above the corona
          so the click panel (opens below) doesn't collide. Eclipse state
          dims the label too — when the API is angry, even the title fades. */}
      <Html center position={[0, 3.6, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontFamily: '"Cinzel", serif',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: 4,
          color: palette.corona,
          textShadow: `0 0 8px ${palette.halo}aa, 0 0 4px rgba(0,0,0,.9)`,
          userSelect: 'none',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          opacity: eclipsed ? 0.4 : 0.9,
        }}>
          LLM SUN
          <div style={{
            fontFamily: 'monospace',
            fontSize: 7.5, letterSpacing: 2,
            opacity: 0.7, marginTop: 2, fontWeight: 400,
          }}>
            {palette.label}
          </div>
        </div>
      </Html>

      {/* Click-to-open panel — same drei <Html> pattern as champion nameplate.
          Hidden by default; opens when the sun is selected. position:relative
          so the ModelCardEmitter's absolutely-positioned token spans anchor
          to the panel's right edge. */}
      {selected && (
        <Html center position={[0, -3.0, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{
            position: 'relative',
            width: 200,
            background: 'rgba(8,6,14,.92)',
            border: `1px solid ${palette.corona}aa`,
            borderRadius: 4,
            padding: '7px 10px 8px',
            fontFamily: 'monospace',
            color: '#eee',
            userSelect: 'none',
            boxShadow: `0 0 14px ${palette.halo}66`,
            fontSize: 10,
            lineHeight: 1.5,
            // Absorb clicks so reading the panel doesn't trigger Canvas
            // onPointerMissed deselect. The token-emitter spans inside have
            // pointer-events:none so they don't steal hover/click either.
            pointerEvents: 'auto', cursor: 'default',
          }}
          onClick={(e) => e.stopPropagation()}>
            <div style={{
              fontFamily: '"Cinzel", serif', fontWeight: 700,
              fontSize: 11, letterSpacing: 2.5, color: palette.corona,
              textTransform: 'uppercase', marginBottom: 4,
            }}>
              {eclipsed ? '⚠ Eclipse' : 'LLM Sun'} · {palette.label}
            </div>
            <div style={{ fontSize: 9, color: '#aaa', marginBottom: 6, wordBreak: 'break-all' }}>
              {binding.modelLabel}
            </div>
            <SunPanelRow k="Spend"     v={`$${binding.totalSpendUsd.toFixed(4)}`} />
            <SunPanelRow k="Tokens"    v={formatTokens(binding.totalTokens)} />
            <SunPanelRow k="Sessions"  v={`${binding.sessionCount - binding.ghostCount} live · ${binding.ghostCount} ghost`} />
            <SunPanelRow k="Cache hit" v={`${(binding.cacheHitRate * 100).toFixed(0)}%`} />
            <SunPanelRow k="Avg dur."  v={`${binding.avgDurationMin.toFixed(1)}m`} />
            {/* Streaming token fragments — visual signal that the model is
                generating from this card. Suppressed during eclipse since
                an API outage shouldn't be emitting tokens. */}
            {!eclipsed && <ModelCardEmitter binding={binding} palette={palette} />}
          </div>
        </Html>
      )}
    </group>
  );
}

// ─── Dalaran Portal ──────────────────────────────────────────────────────────
//
// Ground-level magical centerpiece directly under the LLM Sun. Two counter-
// rotating runic rings + an inner glow disc. Decorative only — sells the
// "you are in a Dalaran-like plaza" feel without any click behavior.
function DalaranPortal() {
  const ringRef  = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const glowRef  = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ringRef.current)  ringRef.current.rotation.z  =  t * 0.18;
    if (innerRef.current) innerRef.current.rotation.z = -t * 0.42;
    if (glowRef.current) {
      const pulse = 0.40 + Math.sin(t * 1.1) * 0.10;
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  });

  return (
    <group position={[0, 0.06, 0]}>
      {/* Outer runic ring — slow clockwise drift */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.45, 2.75, 64]} />
        <meshBasicMaterial color="#9b6bff" transparent opacity={0.7}
          blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
          depthWrite={false} fog={false} />
      </mesh>
      {/* Inner swirl — partial arc, counter-rotating */}
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 2.35, 32, 1, 0, Math.PI * 1.65]} />
        <meshBasicMaterial color="#6b8fff" transparent opacity={0.45}
          blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
          depthWrite={false} fog={false} />
      </mesh>
      {/* Center glow — pulsing softly */}
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.85, 32]} />
        <meshBasicMaterial color="#d8c4ff" transparent opacity={0.4}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Soft halo bleed — wider, fainter, sits flush with the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[3.4, 48]} />
        <meshBasicMaterial color="#6840a8" transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}

// Curved compute ray from the sun to a single agent — four particles flowing
// sun → agent, intensified by cost (brighter rays for pricier sessions).
function ComputeRay({ sessionId, color, livePosMap }: {
  sessionId: string;
  color: string;
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const SEG = 20;
  const ORB_COUNT = 4;

  const sunC   = useMemo(() => new THREE.Color('#ffcb6a'), []);
  const agentC = useMemo(() => new THREE.Color(color), [color]);

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const colors = new Float32Array((SEG + 1) * 3);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const c = new THREE.Color().lerpColors(sunC, agentC, t);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [sunC, agentC]);

  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }),
    [],
  );
  const lineObj = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);
  const orbRefs = useRef<(THREE.Mesh | null)[]>([]);
  const phase   = useRef(Math.random());

  useEffect(() => () => { lineGeo.dispose(); lineMat.dispose(); }, [lineGeo, lineMat]);

  useFrame((state, delta) => {
    const to = livePosMap.current.get(sessionId);
    if (!to) return;
    const from = SUN_POSITION;
    // Arc peaks between sun and agent
    const mid = new THREE.Vector3(
      (from.x + to.x) / 2,
      Math.max(from.y, to.y + 1.5) + 1.5,
      (from.z + to.z) / 2,
    );
    const curve = new THREE.QuadraticBezierCurve3(
      from.clone(),
      mid,
      to.clone().setY(to.y + 1.5),
    );

    const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const pts = curve.getPoints(SEG);
    for (let i = 0; i <= SEG; i++) {
      const p = pts[i]!;
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;

    // Flowing sun → agent
    phase.current = (phase.current + delta * 0.55) % 1;
    for (let i = 0; i < ORB_COUNT; i++) {
      const ref = orbRefs.current[i];
      if (!ref) continue;
      const t = (phase.current + i / ORB_COUNT) % 1;
      ref.position.copy(curve.getPoint(t));
      const breath = Math.sin(t * Math.PI);
      ref.scale.setScalar(0.6 + breath * 0.4);
      const mat = ref.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.35 + breath * 0.45;
    }
    lineMat.opacity = 0.22 + Math.sin(state.clock.elapsedTime * 1.4 + phase.current * 6) * 0.10;
  });

  return (
    <>
      <primitive object={lineObj} />
      {Array.from({ length: ORB_COUNT }, (_, i) => {
        const tC = new THREE.Color().lerpColors(sunC, agentC, i / (ORB_COUNT - 1));
        return (
          <mesh key={i} ref={(el) => { orbRefs.current[i] = el; }}>
            <sphereGeometry args={[0.07, 6, 6]} />
            <meshStandardMaterial color={tC} emissive={tC} emissiveIntensity={4}
              transparent opacity={0.7} />
          </mesh>
        );
      })}
    </>
  );
}

// ─── WoW Tooltip Overlay ──────────────────────────────────────────────────────

function WoWTooltipOverlay({ session, cls, name, role, onClose }: {
  session: Session; cls: ClassConfig; name: string; role: string; onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const catType = session.cat_type ?? 'ghost';

  // Rotating flavor quote — lives here now (was removed from nameplate)
  const [quote, setQuote] = useState(() => pickQuote(catType, session));
  useEffect(() => {
    const iv = setInterval(() => setQuote(pickQuote(catType, session)), 9000);
    return () => clearInterval(iv);
  }, [catType, session]);

  const tools = session.tools
    ? Object.entries(session.tools).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  const activeMoves = useMemo(() => {
    const moves = SIGNATURE_MOVES[catType] ?? [];
    return moves.filter(m => m.trigger(session));
  }, [catType, session]);

  return (
    <div style={{
      position: 'absolute', top: 20, right: 16, zIndex: 40,
      minWidth: 260, maxWidth: 320,
      background: 'linear-gradient(180deg, #0a0818 0%, #040210 100%)',
      border: `2px solid ${cls.color}`,
      outline: '1px solid #8B6914',
      borderRadius: 3,
      boxShadow: `0 4px 32px rgba(0,0,0,.9), inset 0 0 20px ${cls.aura}12`,
      fontFamily: 'monospace',
      transform: visible ? 'translateX(0)' : 'translateX(20px)',
      opacity: visible ? 1 : 0,
      transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px',
        borderBottom: `1px solid ${cls.color}44`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontSize: 14, color: cls.color, fontWeight: 700,
            textShadow: `0 0 8px ${cls.aura}`, letterSpacing: 0.5 }}>
            {name}
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, letterSpacing: 1 }}>
            {role} · {cls.label} · {session.model}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: `1px solid ${cls.color}66`,
          color: cls.color, borderRadius: 2, padding: '1px 6px',
          cursor: 'pointer', fontSize: 10, marginLeft: 8, flexShrink: 0,
        }}>✕</button>
      </div>

      {/* Stats */}
      <div style={{ padding: '8px 12px 6px', borderBottom: `1px solid ${cls.color}22` }}>
        {[
          { icon: '💰', label: 'Cost',     val: formatGold(session.estimated_cost_usd) },
          { icon: '⚡', label: 'Tokens',   val: (session.total_tokens ?? 0).toLocaleString() },
          { icon: '⏱',  label: 'Duration', val: formatDur(session.duration_seconds) },
          { icon: '💬', label: 'Messages', val: String(session.message_count ?? '—') },
          { icon: '📁', label: 'Project',  val: session.project },
        ].map(({ icon, label, val }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{icon} {label}</span>
            <span style={{ fontSize: 10, color: '#e8d5a3', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Signature moves — with full name + description */}
      {activeMoves.length > 0 && (
        <div style={{ padding: '7px 12px 8px', borderBottom: `1px solid ${cls.color}22` }}>
          <div style={{ fontSize: 8, color: `${cls.color}99`, letterSpacing: 2, marginBottom: 5, textTransform: 'uppercase' }}>
            Signature Moves
          </div>
          {activeMoves.map((m) => {
            const desc = typeof m.quote === 'function' ? m.quote(session) : m.quote;
            return (
              <div key={m.name} style={{
                display: 'flex', gap: 7, alignItems: 'flex-start',
                marginBottom: 4, padding: '3px 5px',
                background: `${cls.color}10`,
                borderLeft: `2px solid ${cls.color}88`, borderRadius: 2,
              }}>
                <span style={{ fontSize: 13, lineHeight: 1.1, flexShrink: 0 }}>{m.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: cls.color, fontWeight: 600, lineHeight: 1.2 }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 9, color: '#c8a855cc', lineHeight: 1.3, marginTop: 1 }}>
                    {desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Abilities / tools */}
      {tools.length > 0 && (
        <div style={{ padding: '7px 12px 8px', borderBottom: `1px solid ${cls.color}22` }}>
          <div style={{ fontSize: 8, color: `${cls.color}99`, letterSpacing: 2, marginBottom: 5, textTransform: 'uppercase' }}>
            Abilities
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tools.map(([tool, count]) => (
              <div key={tool} style={{
                fontSize: 9, padding: '2px 6px',
                border: `1px solid ${cls.color}44`, borderRadius: 2,
                color: cls.color, background: `${cls.aura}0a`,
              }}>
                {tool} ×{count}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flavor quote — rotating, only on selected panel */}
      <div style={{
        padding: '7px 12px 9px',
        fontSize: 10, fontStyle: 'italic', color: '#e4d4a8cc', lineHeight: 1.4,
        background: `${cls.color}08`,
      }}>
        "{quote}"
      </div>
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


// ─── Full 3D Scene ────────────────────────────────────────────────────────────

function Scene({ group, selectedId, onSelect, livePosMapOut, nowEpoch, possessedId, moveInputRef, cursorGroundRef, moveOrdersRef, eternal }: {
  group: SessionRunGroup; selectedId: string | null; onSelect: (id: string | null) => void;
  livePosMapOut:   React.MutableRefObject<Map<string, THREE.Vector3>>;
  nowEpoch:        number;
  possessedId:     string | null;
  moveInputRef:    React.MutableRefObject<{ x: number; z: number }>;
  cursorGroundRef: React.MutableRefObject<THREE.Vector3>;
  moveOrdersRef:   React.MutableRefObject<Map<string, THREE.Vector3 | null>>;
  eternal:         EternalStats;
}) {
  const nodes     = useMemo(() => layoutNodes(group.roots), [group]);
  const maxCost   = useMemo(() => Math.max(...nodes.map((n) => n.session.estimated_cost_usd), 0.001), [nodes]);
  const maxTokens = useMemo(() => Math.max(...nodes.map((n) => n.session.total_tokens ?? 0), 1), [nodes]);
  // LLM Sun bindings — derived once per run group, drives sun brightness,
  // color, eclipse state, and the spend/cache panel that opens on click.
  const sunBinding = useMemo(() => deriveSunBinding(nodes), [nodes]);

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

  const connections = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.session.session_id, n]));
    return nodes
      .filter((n) => n.session.parent_session_id && initPosMap.has(n.session.parent_session_id))
      .map((n) => {
        const parent = byId.get(n.session.parent_session_id!);
        return {
          key:         n.session.session_id,
          childId:     n.session.session_id,
          parentId:    n.session.parent_session_id!,
          color:       n.cls.color,
          parentColor: parent?.cls.color ?? n.cls.color,
        };
      });
  }, [nodes, initPosMap]);

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
      {/* PBR-lite intentionally stops at MeshStandardMaterial + the existing
          ambient/directional/point lights. drei <Environment preset="night">
          was tried but threw inside the Canvas (HDRI load via drei's CDN
          intermittently fails / blocks render), tripping SceneErrorBoundary
          and black-screening the Sanctum on prod. Reverted in the hotfix
          after fc0e6f6 → bb… If we want IBL later, host the HDRI ourselves
          in /public/textures/sky/ (see public/textures/README.md) and pass
          the file path with `files=` instead of `preset=`. */}

      <Suspense fallback={null}>
        <PlazaEnvironment />
      </Suspense>

      {/* Lich King — permanent custodian of eternal cumulative-spend +
          ghost-count stats. Mirrors the Violet Citadel from the opposite
          back corner. Rendered here in Scene (not inside PlazaEnvironment)
          because PlazaEnvironment doesn't receive the eternal prop —
          having it inside there caused a ReferenceError that tripped the
          SceneErrorBoundary in production minified builds (caught
          2026-04-28 hotfix). */}
      <LichKing eternal={eternal} />

      {connections.map((conn) => (
        <DynamicLeyLine key={conn.key} childId={conn.childId} parentId={conn.parentId}
          color={conn.color} parentColor={conn.parentColor} livePosMap={livePosMap} />
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
          nowEpoch={nowEpoch}
          possessed={possessedId === pn.session.session_id}
          moveInputRef={moveInputRef}
          cursorGroundRef={cursorGroundRef}
          moveOrdersRef={moveOrdersRef}
        />
      ))}

      {/* Cursor tracker — raycasts mouse against ground each frame for facing + orders */}
      <CursorTracker cursorGroundRef={cursorGroundRef} />

      {/* Ground-click receiver — two roles depending on possession state.
          Possessing: click issues a move order to the possessed agent.
          Not possessing: click deselects whatever character/sun is open
          (the inner-disc complement to <Canvas onPointerMissed>, which
          covers the area outside the disc). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (possessedId) {
            moveOrdersRef.current.set(possessedId, e.point.clone());
          } else if (selectedId) {
            onSelect(null);
          }
        }}>
        <circleGeometry args={[12, 48]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Dalaran portal — ground-level centerpiece under the LLM Sun. The
          two together form the central axis: API heartbeat above, magical
          plaza marker below. */}
      <DalaranPortal />

      {/* LLM Sun — heartbeat of the API. Brightness/color/eclipse all derive
          from the current run group's sessions; click opens a spend panel. */}
      <ClaudeSun
        binding={sunBinding}
        selected={selectedId === SUN_SELECTION_ID}
        onClick={() => onSelect(selectedId === SUN_SELECTION_ID ? null : SUN_SELECTION_ID)}
      />
      {nodes.map((pn) => (
        <ComputeRay key={`ray-${pn.session.session_id}`} sessionId={pn.session.session_id}
          color={pn.cls.color} livePosMap={livePosMap} />
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

  // Shared "now" clock for recency chips + decay — ticks every 30s
  const [nowEpoch, setNowEpoch] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowEpoch(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  // ── Possession (WASD drive + cursor facing + ground-click move) ─────────────
  const [possessedId, setPossessedId] = useState<string | null>(null);
  const moveInputRef    = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const cursorGroundRef = useRef(new THREE.Vector3(0, 0, 0));
  const moveOrdersRef   = useRef(new Map<string, THREE.Vector3 | null>());
  const [possessionHint, setPossessionHint] = useState(true);

  // Coarse-pointer (touch) devices: no possession (stuck-key risk)
  const isCoarsePointer = typeof window !== 'undefined'
    && window.matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    if (!possessedId) {
      moveInputRef.current.x = 0;
      moveInputRef.current.z = 0;
      return;
    }
    setPossessionHint(true);
    const keys = { w: false, a: false, s: false, d: false };
    const updateVec = () => {
      let x = 0, z = 0;
      if (keys.a) x -= 1;
      if (keys.d) x += 1;
      if (keys.w) z -= 1;
      if (keys.s) z += 1;
      moveInputRef.current.x = x;
      moveInputRef.current.z = z;
    };
    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') { setPossessedId(null); return; }
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp')    { keys.w = true; e.preventDefault(); }
      if (k === 'a' || e.key === 'ArrowLeft')  { keys.a = true; e.preventDefault(); }
      if (k === 's' || e.key === 'ArrowDown')  { keys.s = true; e.preventDefault(); }
      if (k === 'd' || e.key === 'ArrowRight') { keys.d = true; e.preventDefault(); }
      updateVec();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp')    keys.w = false;
      if (k === 'a' || e.key === 'ArrowLeft')  keys.a = false;
      if (k === 's' || e.key === 'ArrowDown')  keys.s = false;
      if (k === 'd' || e.key === 'ArrowRight') keys.d = false;
      updateVec();
    };
    const onContext = (e: MouseEvent) => { e.preventDefault(); setPossessedId(null); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    window.addEventListener('contextmenu', onContext);
    const hideT = setTimeout(() => setPossessionHint(false), 5000);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      window.removeEventListener('contextmenu', onContext);
      clearTimeout(hideT);
    };
  }, [possessedId]);

  // Sort run groups recency-desc so the dropdown leads with the most recent
  // work — what a founder is usually chasing when they open the Sanctum.
  const groups = useMemo(() => {
    const raw = getSessionRunGroups(sessions);
    return [...raw].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }, [sessions]);
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
  // Eternal stats — cumulative across ALL sessions (not run group). Drives
  // the Lich King's label + aura scale + ghost wisp count.
  const eternal = useMemo(() => deriveEternal(sessions), [sessions]);

  // Selection handler — used by both the 3D Scene's onSelect prop and the
  // per-session roster (top-left list). Auto-possess on select skips ghosts,
  // touch devices, and the LLM Sun sentinel.
  const handleSelect = useCallback((id: string | null) => {
    setSelected(id);
    if (id && id !== SUN_SELECTION_ID && !isCoarsePointer) {
      const sess = flatNodes.find((n) => n.session.session_id === id);
      if (sess && !sess.session.is_ghost) setPossessedId(id);
      else setPossessedId(null);
    } else {
      setPossessedId(null);
    }
  }, [flatNodes, isCoarsePointer]);

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
            <div style={{
              fontFamily: '"Cinzel", serif', fontWeight: 700,
              fontSize: 12, color: '#c8a855aa',
              letterSpacing: 4, textTransform: 'uppercase',
            }}>
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
                maxWidth: 520,
              }}>
              {(() => {
                const visible = groups.slice(0, 40);
                const nowIso = new Date(nowEpoch).toISOString();
                // Short list → flat options. Long list → optgroup day-headers
                // for scannability without forcing the user to count rows.
                if (visible.length <= 15) {
                  return visible.map((g, i) => (
                    <option key={i} value={i}>{formatRunGroupLabel(g, nowIso)}</option>
                  ));
                }
                type Bucket = { day: string; items: { g: SessionRunGroup; i: number }[] };
                const buckets: Bucket[] = [];
                let last: Bucket | null = null;
                visible.forEach((g, i) => {
                  const day = toISTDate(g.startedAt);
                  if (!last || last.day !== day) {
                    last = { day, items: [] };
                    buckets.push(last);
                  }
                  last.items.push({ g, i });
                });
                return buckets.map(({ day, items }) => {
                  const first = items[0];
                  if (!first) return null;
                  const header = dayPrefixLabel(first.g.startedAt, nowIso);
                  const label = header === 'today' ? 'Today'
                              : header === 'yesterday' ? 'Yesterday' : header;
                  return (
                    <optgroup key={day} label={label}>
                      {items.map(({ g, i }) => (
                        <option key={i} value={i}>{formatRunGroupLabel(g, nowIso)}</option>
                      ))}
                    </optgroup>
                  );
                });
              })()}
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

        {/* Per-session roster — Phase B replaces the per-class legend so
            multiple same-class champions in a run group are no longer
            indistinguishable. Each row binds a session to its character
            class + identifier (branch tail or hash). Click a row to select
            that champion (same plumbing as clicking it in the 3D scene). */}
        <div style={{
          position: 'absolute', top: 60, left: 16, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 3,
          maxHeight: 'calc(100vh - 140px)', overflowY: 'auto',
          pointerEvents: 'auto',
          fontFamily: 'monospace',
        }}>
          {flatNodes.map((pn) => {
            const ident = sessionIdentifier(pn.session);
            const isSel = selected === pn.session.session_id;
            return (
              <button
                key={pn.session.session_id}
                onClick={() => handleSelect(isSel ? null : pn.session.session_id)}
                title={`${pn.session.project} · ${pn.cls.label} · ${pn.session.model}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: isSel ? `${ident.accent}1f` : 'transparent',
                  border: `1px solid ${isSel ? `${ident.accent}77` : 'transparent'}`,
                  borderRadius: 3,
                  padding: '2px 5px',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 8, color: pn.cls.color, opacity: 0.85 }}>◆</span>
                <span style={{
                  fontSize: 8, color: ident.accent,
                  letterSpacing: 0.5, minWidth: 4 * 8 + 2,
                  textShadow: `0 0 3px ${ident.accent}55`,
                }}>{ident.tag}</span>
                <span style={{ fontSize: 7, color: '#c8a85533', letterSpacing: 1 }}>·</span>
                <span style={{ fontSize: 7.5, color: '#c8a85577', letterSpacing: 1.2 }}>
                  {pn.cls.label}
                </span>
              </button>
            );
          })}
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
          {/* Cinematic vignette — tightened so the eye locks on centre.
              Inner transparent disc shrunk 55% → 45% and the corner stop
              deepened 0.85 → 0.92, so far elements (Citadel, Lich King)
              read as "into the gloom" rather than fully lit. Pure CSS
              overlay with `pointer-events: none` so it never blocks the
              Canvas pointer events underneath. */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(4,2,12,.55) 75%, rgba(2,1,6,.92) 100%)',
          }} />

          <Canvas
            orthographic
            camera={{ position: [14, 12, 14], zoom: 38, up: [0, 1, 0], near: 0.1, far: 500 }}
            gl={{ antialias: false, alpha: false }}
            // R3F's onPointerMissed fires when a click lands but no 3D mesh
            // with a handler was hit — the proper primitive for empty-space
            // deselect. Replaces the legacy onClick check that almost never
            // matched (events bubble from R3F children, so e.target ===
            // e.currentTarget was rarely true).
            onPointerMissed={() => { if (selected) setSelected(null); }}
          >
            {/* Dalaran D1 — violet ambient. Background stays solid here so
                the fog blends cleanly toward the horizon; the starfield rides
                in front of it and the bloom pass adds the magical glow halo
                across all bright sources. */}
            <color attach="background" args={['#160726']} />
            <fog attach="fog" args={['#1a0830', 28, 90]} />
            <Stars radius={60} depth={20} count={1500} factor={2} fade speed={0.3} />
            <PerfReader statsRef={perfStatsRef} />
            <WebGLContextWatcher onContextLost={handleContextLost} onContextRestored={handleContextRestored} />
            <Suspense fallback={null}>
              <SceneErrorBoundary onError={handleSceneError}>
                {group && <Scene
                  group={group}
                  selectedId={selected}
                  onSelect={handleSelect}
                  eternal={eternal}
                  livePosMapOut={livePosMap}
                  nowEpoch={nowEpoch}
                  possessedId={possessedId}
                  moveInputRef={moveInputRef}
                  cursorGroundRef={cursorGroundRef}
                  moveOrdersRef={moveOrdersRef}
                />}
              </SceneErrorBoundary>
            </Suspense>
            {/* Bloom postprocessing attempted twice (D1 + this round) and
                pulled both times. @react-three/postprocessing v3 transitively
                pulls stats-gl which ships its own three + maath copies; even
                with vite resolve.dedupe applied, the dev server still hits
                "Invalid hook call" + "Multiple instances of THREE" errors
                that black-screen the canvas. Procedural bloom-fake halos in
                D4/D5 (wide additive spheres around bright sources) cover
                ~80% of what real bloom would add at zero risk. */}
          </Canvas>

          {/* Possession HUD — top-center chip while driving an agent */}
          {possessedId && possessionHint && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 25, fontFamily: 'monospace', fontSize: 10,
              background: 'rgba(10,6,18,.92)', border: '1px solid #f59e0b88',
              borderRadius: 3, padding: '5px 12px', pointerEvents: 'none',
              color: '#f5c86a', letterSpacing: 1.2, boxShadow: '0 0 14px #f59e0b33',
            }}>
              ◆ POSSESSING {flatNodes.find(n => n.session.session_id === possessedId)?.name ?? '—'}
              &nbsp;·&nbsp; <span style={{ color: '#e4d4a8' }}>WASD</span> move
              &nbsp;·&nbsp; <span style={{ color: '#e4d4a8' }}>CLICK</span> ground
              &nbsp;·&nbsp; <span style={{ color: '#e4d4a8' }}>ESC</span> release
            </div>
          )}

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
