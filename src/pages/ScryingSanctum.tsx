// ScryingSanctum.tsx — Dalaran Plaza agent pipeline visualizer
// Pixel-art sprite characters roam a Dalaran plaza · WoW nameplates · Dynamic ley lines

import { useRef, useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, Stars, Sparkles } from '@react-three/drei';
import { Activity, RefreshCw, Zap } from 'lucide-react';
// EffectComposer/Bloom removed — was breaking WebGL render pipeline on Apple GPU
import * as THREE from 'three';
import type { Session } from '@/types/session';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { SessionRunGroup } from '@/lib/agent-tree';
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
  PerfLevel, PerfStats, ClassConfig, EternalStats, PositionedNode,
} from './sanctum/types';
import {
  AURA_PROFILES, DEFAULT_AURA,
  MOVEMENT_PROFILES, DEFAULT_MOVEMENT,
  SIGNATURE_MOVES, pickQuote,
} from './sanctum/classes';
import {
  sessionIdentifier, deriveEternal, blendHex,
  hpPercent, formatGold, dayPrefixLabel, formatRunGroupLabel,
  formatDur, formatSessionDisplayName, sessionFolderLabel, layoutNodes, WAYPOINTS,
} from './sanctum/helpers';
import {
  getShadowTexture, getMarbleTexture, getStainedGlassTexture,
  buildClassTexture,
} from './sanctum/textures';
import {
  PerfContext, usePerfLevel, SceneErrorBoundary,
  PerfReader, WebGLContextWatcher,
} from './sanctum/perf';
import { LichKing } from './sanctum/LichKing';
import { Minimap } from './sanctum/Minimap';
import { SANCTUM_PALETTE as PAL } from './sanctum/palette';
import {
  nextWalkFrame, PHASE_STEP, SETTLE_DURATION, START_DURATION,
  stepPeriodForSpeed, TURN_DURATION,
} from './sanctum/motion.js';
import {
  diffEventSnapshots, EVENT_DURATIONS, snapshotSessions,
  type EventSnapshot, type SanctumEventBeat,
} from './sanctum/events.js';
import {
  ClaudeSun, deriveSunBinding,
  SUN_POSITION, SUN_SELECTION_ID,
} from './sanctum/Sun';

export type { PerfStats };


// ─── Arcane Sanctum Environment ──────────────────────────────────────────────

function CrystalPillar({ position }: { position: [number, number, number] }) {
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
        <meshStandardMaterial color={PAL.stone500} roughness={0.9} />
      </mesh>
      {/* Crystal */}
      <mesh ref={crystalRef} position={[0, 1.2, 0]}>
        <octahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color={PAL.gold} emissive={PAL.gold} emissiveIntensity={0.7}
          transparent opacity={0.85} roughness={0.2} metalness={0.3} />
      </mesh>
      {/* Light column */}
      <mesh ref={beamRef} position={[0, 4, 0]}>
        <cylinderGeometry args={[0.08, 0.02, 6, 8]} />
        <meshBasicMaterial color={PAL.gold} transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>
      {/* Orbiting rune stones */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { runeRefs.current[i] = el; }}>
          <octahedronGeometry args={[0.08, 0]} />
          <meshBasicMaterial color={PAL.stone300} transparent opacity={0.28} />
        </mesh>
      ))}
      {/* Glow light */}
      <pointLight position={[0, 1.2, 0]} color={PAL.gold} intensity={0.16} distance={5} />
    </group>
  );
}

// ─── Dalaran D4 — Magical lights + godrays ───────────────────────────────────
//
// Three procedural light layers that don't require @react-three/postprocessing
// (which pulls duplicate three+react and breaks hooks). Procedural emissive
// halos give a "bloomed" look on stylized scenes ~80% as well as real bloom.
//
//   SunGodrays     — six vertical light shafts radiating from the LLM Sun
//                     straight down to the ground, slowly rotating
//   AtmosphericMotes — one restrained gold layer for depth.

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
  return (
    <Sparkles count={120} scale={[20, 8, 20]} size={1.4} color={PAL.gold}
      speed={0.25} opacity={0.42} position={[0, 2, 0]} />
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
        <meshStandardMaterial map={getMarbleTexture()} color={PAL.night700}
          emissive={PAL.night900} emissiveIntensity={0.10}
          roughness={0.7} metalness={0.1} />
      </mesh>
      {/* Ward ring — boundary between inner sanctum and outer courtyard */}
      <mesh ref={wardRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.038, 0]}>
        <ringGeometry args={[4.9, 5.15, 64]} />
        <meshBasicMaterial color={PAL.gold} transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Ward rune markers — counter-rotating hex dots at radius 5 */}
      <group ref={wardRuneGroupRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.036, 0]}>
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(angle) * 5, Math.sin(angle) * 5, 0]}>
              <circleGeometry args={[0.15, 6]} />
              <meshBasicMaterial color={PAL.gold} transparent opacity={0.28}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          );
        })}
      </group>
      {/* Outer edge ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[11, 11.2, 64]} />
        <meshBasicMaterial color={PAL.stone300} transparent opacity={0.12}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* One functional ring; S4 turns its sweep into the spend gauge. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.038, 0]}>
        <ringGeometry args={[7.94, 8.06, 64]} />
        <meshBasicMaterial color={PAL.gold} transparent opacity={0.16}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Center glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <circleGeometry args={[1.2, 32]} />
        <meshBasicMaterial color={PAL.cyan} transparent opacity={0.12}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]}>
        <circleGeometry args={[0.5, 24]} />
        <meshBasicMaterial color={PAL.gold} transparent opacity={0.32}
          blending={THREE.AdditiveBlending} depthWrite={false} />
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
              <meshBasicMaterial color={PAL.stone300}
                transparent opacity={0.10} side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          );
        })}
      </group>
      {/* Ground fog disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[10, 48]} />
        <meshBasicMaterial color={PAL.night700} transparent opacity={0.18} />
      </mesh>
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

function DalaranBackdropSpire({ position, height, radius, phase, crown = false }: {
  position: [number, number, number];
  height: number;
  radius: number;
  phase: number;
  crown?: boolean;
}) {
  const windowRef = useRef<THREE.Mesh>(null);
  const orbRef = useRef<THREE.Mesh>(null);
  const bandRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (windowRef.current) {
      (windowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.26 + Math.sin(t * 0.65 + phase) * 0.10;
    }
    if (orbRef.current) {
      orbRef.current.position.y = height + radius * 2.35 + Math.sin(t * 0.85 + phase) * 0.10;
      (orbRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.50 + Math.sin(t * 0.9 + phase) * 0.20;
    }
    if (bandRef.current) bandRef.current.rotation.z = t * 0.18 + phase;
  });

  return (
    <group position={position}>
      {/* Floating island underside: Dalaran as distant mage-city, not a wall. */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[radius * 1.75, radius * 2.2, 0.24, 8]} />
        <meshBasicMaterial color="#090615" transparent opacity={0.72} />
      </mesh>
      {/* Violet stone tower body, intentionally muted so it stays backdrop. */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius * 0.70, radius, height, 8]} />
        <meshBasicMaterial color="#211537" transparent opacity={0.72} />
      </mesh>
      <mesh position={[0, height * 0.54, 0]}>
        <cylinderGeometry args={[radius * 0.90, radius * 1.02, 0.16, 8]} />
        <meshBasicMaterial color="#6f4b22" transparent opacity={0.46} />
      </mesh>
      <mesh ref={bandRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, height + 0.03, 0]}>
        <ringGeometry args={[radius * 0.82, radius * 1.04, 12]} />
        <meshBasicMaterial color="#c19a45" transparent opacity={0.34}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>
      <mesh position={[0, height + radius * 1.15, 0]}>
        <coneGeometry args={[radius * 0.92, radius * 2.3, 8]} />
        <meshBasicMaterial color={crown ? '#4b1e63' : '#2b1642'} transparent opacity={0.82} />
      </mesh>
      <mesh ref={windowRef} position={[0, height * 0.66, radius * 0.72]}>
        <planeGeometry args={[radius * 0.48, radius * 0.92]} />
        <meshBasicMaterial map={getStainedGlassTexture()} transparent opacity={0.32}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh ref={orbRef} position={[0, height + radius * 2.35, 0]}>
        <sphereGeometry args={[radius * 0.18, 10, 10]} />
        <meshBasicMaterial color={crown ? '#ffd36a' : '#a78bfa'} transparent opacity={0.55}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}

function DalaranBackdrop() {
  const spires = useMemo(() => [
    { x: -11.5, z: -15.2, h: 4.9, r: 0.46, crown: false },
    { x: -7.4,  z: -16.0, h: 6.4, r: 0.58, crown: false },
    { x: -2.6,  z: -16.4, h: 8.2, r: 0.74, crown: true },
    { x: 2.5,   z: -16.2, h: 6.9, r: 0.62, crown: false },
    { x: 7.4,   z: -15.7, h: 5.7, r: 0.54, crown: false },
    { x: 11.5,  z: -15.0, h: 4.7, r: 0.44, crown: false },
  ], []);

  return (
    <group>
      {/* Broad violet haze behind the sun and skyline. This is the cheapest
          way to make the plaza feel embedded in a magical city. */}
      <mesh position={[0, 5.0, -17.2]}>
        <planeGeometry args={[34, 8]} />
        <meshBasicMaterial color="#3b1f70" transparent opacity={0.16}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>

      {spires.map((s, i) => (
        <DalaranBackdropSpire
          key={i}
          position={[s.x, 0, s.z]}
          height={s.h}
          radius={s.r}
          phase={i * 0.9}
          crown={s.crown}
        />
      ))}

      {/* Gold-trim sky bridges: small, distant, and above the floor plane. */}
      {spires.slice(0, -1).map((s, i) => {
        const next = spires[i + 1]!;
        const mx = (s.x + next.x) / 2;
        const mz = (s.z + next.z) / 2;
        const len = Math.hypot(next.x - s.x, next.z - s.z);
        const rot = Math.atan2(next.z - s.z, next.x - s.x);
        return (
          <group key={`bridge-${i}`} position={[mx, 2.0 + (i % 2) * 0.35, mz]} rotation={[0, -rot, 0]}>
            <mesh>
              <boxGeometry args={[len * 0.72, 0.10, 0.18]} />
              <meshBasicMaterial color="#2a1a3e" transparent opacity={0.56} />
            </mesh>
            <mesh position={[0, 0.08, 0]}>
              <boxGeometry args={[len * 0.64, 0.035, 0.22]} />
              <meshBasicMaterial color="#c19a45" transparent opacity={0.38} />
            </mesh>
          </group>
        );
      })}

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
// The Eternal sits visually deeper into haze, so foreground action pops.
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

function PlazaEnvironment() {
  const pillarPositions: [number, number, number][] = [
    [0, 0, -9], [9, 0, 0], [0, 0, 9], [-9, 0, 0],
  ];

  return (
    <>
      <ArcaneFloor />
      <StageRim />
      <AtmosphericFog />
      <DalaranBackdrop />
      {pillarPositions.map((position, i) => (
        <CrystalPillar key={i} position={position} />
      ))}
      {/* Perimeter buildings intentionally hidden: the Sanctum now reads as
          an open ritual floor rather than a crowded city perimeter. */}
      {/* Dalaran D4 — magical lights + sparkles + faked godrays. All
          procedural; no postprocessing dep. */}
      <SunGodrays />
      <AtmosphericMotes />
      <ArcanePaths />
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
      <div className="sanctum-hud-panel" style={{
        width: 190, background: 'rgba(8,6,14,.88)',
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
    ages.current.forEach((currentAge, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const nextAge = currentAge + delta;
      ages.current[i] = nextAge;
      if (isMoving.current && nextAge > 0.12 * (i + 1)) {
        // Spawn at origin (parent group position)
        mesh.position.set(
          (Math.random() - 0.5) * 0.6,
          0.2 + Math.random() * 0.8,
          (Math.random() - 0.5) * 0.6,
        );
        ages.current[i] = 0;
      }
      const life = ages.current[i] ?? 0;
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
    ages.current.forEach((currentAge, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const nextAge = currentAge + delta;
      ages.current[i] = nextAge;

      // Spawn new puff at ground level when moving
      if (isMoving.current && nextSpawn.current <= 0 && nextAge > 0.6) {
        mesh.position.set(
          (Math.random() - 0.5) * 0.5,
          0.05,
          (Math.random() - 0.5) * 0.5,
        );
        mesh.scale.setScalar(0.5);
        ages.current[i] = 0;
        nextSpawn.current = 0.12; // stagger spawns
      }

      const life = ages.current[i] ?? 0;
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
  const facingRef   = useRef<1 | -1>(1);
  const pendingFacingRef = useRef<1 | -1>(1);
  const turnTimerRef = useRef(0);
  const wasMovingRef = useRef(false);
  const startTimerRef = useRef(0);
  const settleTimerRef = useRef(0);
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
    let desiredFacing: 1 | -1 | null = null;
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
        desiredFacing = mi.x > 0 ? 1 : mi.x < 0 ? -1 : facingRef.current;
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
            desiredFacing = dx > 0 ? 1 : -1;
          }
        } else {
          velocityRef.current = Math.max(0, velocityRef.current - delta * 4);
          // Face cursor when idle
          const cx = cursorGroundRef.current.x - livePosRef.current.x;
          desiredFacing = cx > 0 ? 1 : cx < 0 ? -1 : facingRef.current;
        }
      }
      // Clamp to plaza bounds
      livePosRef.current.x = Math.max(-10.5, Math.min(10.5, livePosRef.current.x));
      livePosRef.current.z = Math.max(-10.5, Math.min(10.5, livePosRef.current.z));
      // Walk cycle
      if (moving) {
        frameTimer.current += delta;
        if (frameTimer.current > stepPeriodForSpeed(Math.max(velocityRef.current, movProf.speed * 0.35))) {
          frameTimer.current = 0;
          frameRef.current = nextWalkFrame(frameRef.current);
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
        desiredFacing = dx > 0 ? 1 : -1;

        // ── Walk cycle with bounce ──
        frameTimer.current += delta;
        if (frameTimer.current > stepPeriodForSpeed(Math.max(velocityRef.current, movProf.speed * 0.35))) {
          frameTimer.current = 0;
          frameRef.current = nextWalkFrame(frameRef.current);
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
    if (moving && !wasMovingRef.current) startTimerRef.current = START_DURATION;
    if (!moving && wasMovingRef.current) {
      settleTimerRef.current = SETTLE_DURATION;
      frameRef.current = 0;
      if (spriteRef.current) {
        (spriteRef.current.material as THREE.SpriteMaterial).map = textures[0];
        (spriteRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }
    wasMovingRef.current = moving;
    startTimerRef.current = Math.max(0, startTimerRef.current - delta);
    settleTimerRef.current = Math.max(0, settleTimerRef.current - delta);

    if (desiredFacing && desiredFacing !== facingRef.current && turnTimerRef.current <= 0) {
      pendingFacingRef.current = desiredFacing;
      turnTimerRef.current = TURN_DURATION;
    }
    if (turnTimerRef.current > 0) {
      turnTimerRef.current = Math.max(0, turnTimerRef.current - delta);
      if (turnTimerRef.current === 0) facingRef.current = pendingFacingRef.current;
    }

    isMovingRef.current = moving;

    // ── Idle breathing bob + walk bounce + selection float ──
    const idlePhase   = pn.idx * PHASE_STEP;
    const breathe     = Math.sin(t * movProf.breatheSpeed + idlePhase) * movProf.breatheAmp;
    const walkBounce  = moving ? Math.abs(Math.sin(t * 8)) * movProf.bounceAmp : 0;
    // Selected characters float slightly higher so they pop above the crowd
    const selectFloat = selected && !dragActive.current ? Math.sin(t * 1.5 + idlePhase) * 0.06 : 0;
    const spriteY     = breathe + walkBounce + selectFloat;

    if (spriteRef.current) {
      spriteRef.current.position.y = 1.5 + spriteY + liftY;
      const baseScale  = 2.0 * spawnEase;
      const hoverBoost = hovered.current ? 1.08 : 1.0;
      const dragBoost  = 1 + dragLift.current * 0.06;
      const turnProgress = turnTimerRef.current / TURN_DURATION;
      const turnSquash = turnTimerRef.current > 0 ? Math.sin(turnProgress * Math.PI) : 0;
      const startProgress = startTimerRef.current / START_DURATION;
      const settleProgress = settleTimerRef.current / SETTLE_DURATION;
      const actionScaleY = 1 - turnSquash * 0.08
        - (startTimerRef.current > 0 ? Math.sin(startProgress * Math.PI) * 0.08 : 0)
        + (settleTimerRef.current > 0 ? Math.sin(settleProgress * Math.PI) * 0.04 : 0);
      const actionScaleX = 1 + turnSquash * 0.06
        + (settleTimerRef.current > 0 ? Math.sin(settleProgress * Math.PI) * 0.03 : 0);
      spriteRef.current.scale.y = 3.0 * spawnEase * hoverBoost * dragBoost * actionScaleY;
      spriteRef.current.scale.x = baseScale * hoverBoost * dragBoost * actionScaleX * facingRef.current;
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
        // Ninelives: spectral glitch
        auraPulse = 1 + (Math.sin(t * auraProf.speed) * Math.sin(t * 13.7) > 0.3 ? auraProf.amplitude : -auraProf.amplitude * 0.5);
      } else if (auraProf.style === 'breathe') {
        // Slow sine wave
        auraPulse = 1 + Math.sin(t * auraProf.speed + pn.idx * PHASE_STEP) * auraProf.amplitude;
      } else {
        // Sharp pulse
        auraPulse = 1 + Math.abs(Math.sin(t * auraProf.speed + pn.idx * PHASE_STEP)) * auraProf.amplitude;
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
    <div className="sanctum-hud-panel" style={{
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
          { icon: '📁', label: 'Folder',   val: `[${sessionFolderLabel(session, 34)}]` },
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



// ─── Full 3D Scene ────────────────────────────────────────────────────────────

function CostGauge({ ratio, pulse }: { ratio: number; pulse: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const lift = pulse ? Math.max(0, Math.sin(state.clock.elapsedTime * 9)) : 0;
    ref.current.scale.setScalar(1 + lift * 0.025);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.34 + lift * 0.42;
  });
  const sweep = Math.max(0.03, Math.min(1, ratio)) * Math.PI * 2;
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      <ringGeometry args={[8.45, 8.62, 96, 1, -Math.PI / 2, sweep]} />
      <meshBasicMaterial color={PAL.gold} transparent opacity={0.34}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function EventBeatVisual({ beat, livePosMap }: {
  beat?: SanctumEventBeat;
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const origin = beat?.sessionId ? livePosMap.current.get(beat.sessionId) : null;
  const x = origin?.x ?? 0;
  const z = origin?.z ?? 0;
  const ghostCurve = useMemo(() => new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x, 0.9, z), new THREE.Vector3(2.5, 5.2, -3.4), new THREE.Vector3(5, 2.4, -7.3),
  ), [x, z]);
  useFrame((state) => {
    if (!groupRef.current || !beat) return;
    start.current ??= state.clock.elapsedTime;
    const p = Math.min(1, (state.clock.elapsedTime - start.current) / (EVENT_DURATIONS[beat.type] / 1000));
    groupRef.current.scale.setScalar(0.65 + p * 1.9);
    groupRef.current.children.forEach((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (material) material.opacity = Math.max(0, (1 - p) * 0.8);
    });
  });
  if (!beat || beat.type === 'E5') return null;
  return (
    <group ref={groupRef} position={beat.type === 'E1' ? [0, 0.08, 0] : [x, 0.08, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.66, 40]} />
        <meshBasicMaterial color={beat.type === 'E3' ? PAL.cyan : PAL.gold}
          transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {beat.type === 'E3' && (
        <mesh position={[-x, 0, -z]}>
          <tubeGeometry args={[ghostCurve, 32, 0.025, 5, false]} />
          <meshBasicMaterial color={PAL.cyan} transparent opacity={0.55}
            blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function Scene({ group, selectedId, onSelect, livePosMapOut, nowEpoch, possessedId, moveInputRef, cursorGroundRef, moveOrdersRef, eternal, eventBeat, eventBeatKey = 0, costGauge = 0 }: {
  group: SessionRunGroup; selectedId: string | null; onSelect: (id: string | null) => void;
  livePosMapOut:   React.MutableRefObject<Map<string, THREE.Vector3>>;
  nowEpoch:        number;
  possessedId:     string | null;
  moveInputRef:    React.MutableRefObject<{ x: number; z: number }>;
  cursorGroundRef: React.MutableRefObject<THREE.Vector3>;
  moveOrdersRef:   React.MutableRefObject<Map<string, THREE.Vector3 | null>>;
  eternal:         EternalStats;
  eventBeat?:       SanctumEventBeat;
  eventBeatKey?:    number;
  costGauge?:       number;
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

      {/* The Eternal — permanent custodian of cumulative spend +
          ghost-count stats. Mirrors the Violet Citadel from the opposite
          back corner. Rendered here in Scene (not inside PlazaEnvironment)
          because PlazaEnvironment doesn't receive the eternal prop —
          having it inside there caused a ReferenceError that tripped the
          SceneErrorBoundary in production minified builds (caught
          2026-04-28 hotfix). */}
      <LichKing eternal={eternal} roarKey={eventBeat?.type === 'E3' ? eventBeatKey : 0} />
      <CostGauge ratio={costGauge} pulse={eventBeat?.type === 'E4'} />
      <EventBeatVisual key={eventBeatKey} {...(eventBeat ? { beat: eventBeat } : {})} livePosMap={livePosMap} />

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
  const groupCost = group?.totalCost ?? 0;
  const dayMaxCost = useMemo(() => {
    if (!group) return 1;
    const day = toISTDate(group.startedAt);
    return Math.max(1, ...groups.filter((candidate) => toISTDate(candidate.startedAt) === day)
      .map((candidate) => candidate.totalCost));
  }, [group, groups]);
  const costGauge = Math.min(1, groupCost / dayMaxCost);

  const [eventQueue, setEventQueue] = useState<Array<{ beat: SanctumEventBeat; key: number }>>([]);
  const eventSequenceRef = useRef(0);
  const previousEventSnapshot = useRef<EventSnapshot | null>(null);
  const enqueueBeats = useCallback((beats: SanctumEventBeat[]) => {
    if (!beats.length) return;
    setEventQueue((queue) => [...queue, ...beats.map((beat) => ({ beat, key: ++eventSequenceRef.current }))]);
  }, []);

  useEffect(() => {
    const next = snapshotSessions(flatNodes.map((node) => node.session), selected, groupCost);
    enqueueBeats(diffEventSnapshots(previousEventSnapshot.current, next));
    previousEventSnapshot.current = next;
  }, [enqueueBeats, flatNodes, groupCost, selected]);

  const activeEvent = eventQueue[0];
  useEffect(() => {
    if (!activeEvent) return;
    const id = window.setTimeout(() => setEventQueue((queue) => queue.slice(1)), EVENT_DURATIONS[activeEvent.beat.type]);
    return () => window.clearTimeout(id);
  }, [activeEvent]);

  // Dev rehearsal: 1 = portal arrival, 3 = ghost wisp + Eternal roar.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const rehearse = (event: KeyboardEvent) => {
      if (event.key !== '1' && event.key !== '3') return;
      const target = flatNodes[0]?.session.session_id;
      enqueueBeats([{ type: event.key === '1' ? 'E1' : 'E3', ...(target ? { sessionId: target } : {}) }]);
    };
    window.addEventListener('keydown', rehearse);
    return () => window.removeEventListener('keydown', rehearse);
  }, [enqueueBeats, flatNodes]);
  // Eternal stats — cumulative across ALL sessions (not run group). Drives
  // The Eternal's label + aura scale + ghost wisp count.
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
        height: '100vh', minHeight: 680,
        background: 'radial-gradient(ellipse at 50% 0%, rgba(92,47,138,.22), transparent 44%), #050310',
        borderRadius: 0, overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div className="sanctum-hud-panel" style={{
          minHeight: 70,
          padding: '12px 22px', borderBottom: '1px solid rgba(219,184,94,.18)',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          zIndex: 10, position: 'relative',
          background: 'linear-gradient(180deg, rgba(13,7,28,.94), rgba(5,3,14,.82))',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 1px 0 rgba(255,255,255,.03) inset, 0 18px 42px rgba(0,0,0,.35)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 236 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#f2d27a',
              background: 'radial-gradient(circle at 50% 35%, rgba(242,210,122,.22), rgba(94,47,150,.08) 62%, rgba(0,0,0,.28))',
              border: '1px solid rgba(200,168,85,.26)',
              boxShadow: '0 0 24px rgba(200,168,85,.18), 0 0 0 1px rgba(255,255,255,.03) inset',
            }}>
              <Activity size={17} strokeWidth={1.8} />
            </div>
            <div>
              <div className="sanctum-hud-title" style={{
                fontFamily: '"Cinzel", serif', fontWeight: 700,
                fontSize: 14, color: '#dfc16f',
                letterSpacing: 4.2, textTransform: 'uppercase',
                textShadow: '0 0 18px rgba(200,168,85,.24)',
              }}>
                Scrying Sanctum
              </div>
              <div style={{ fontSize: 10.5, color: '#a9945d', fontFamily: 'monospace', letterSpacing: 1.2 }}>
                Dalaran agent visualizer
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace' }}>
            <div style={{
              minWidth: 74, padding: '6px 9px', borderRadius: 7,
              background: 'rgba(0,0,0,.28)', border: '1px solid rgba(200,168,85,.16)',
            }}>
              <div style={{ fontSize: 7.5, color: '#c8a85566', letterSpacing: 1.4, textTransform: 'uppercase' }}>Agents</div>
              <div style={{ fontSize: 12, color: '#e8d5a3' }}>{flatNodes.length}</div>
            </div>
            <div style={{
              minWidth: 86, padding: '6px 9px', borderRadius: 7,
              background: 'rgba(0,0,0,.28)', border: '1px solid rgba(200,168,85,.16)',
            }}>
              <div style={{ fontSize: 7.5, color: '#c8a85566', letterSpacing: 1.4, textTransform: 'uppercase' }}>Spend</div>
              <div style={{ fontSize: 12, color: '#d9b85f' }}>{formatGold(group?.totalCost ?? 0)}</div>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 10, marginLeft: 'auto', minWidth: 0,
            flex: '1 1 520px', flexWrap: 'wrap',
          }}>
            <select value={runIdx} onChange={(e) => { setRunIdx(+e.target.value); setSelected(null); }}
              style={{
                background: 'rgba(0,0,0,.48)', border: '1px solid rgba(200,168,85,.28)',
                borderRadius: 7, color: '#f2dc9b', fontSize: 11,
                padding: '8px 12px', fontFamily: 'monospace', cursor: 'pointer',
                width: 'clamp(220px, 38vw, 620px)', minWidth: 0,
                flex: '1 1 240px',
                boxShadow: '0 0 0 1px rgba(255,255,255,.025) inset',
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
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(0,0,0,.42)', border: '1px solid rgba(200,168,85,.28)',
                borderRadius: 7, color: syncing ? '#c8a85566' : '#d9b85f',
                fontSize: 10, padding: '7px 11px', fontFamily: 'monospace',
                cursor: syncing ? 'wait' : 'pointer', letterSpacing: 1,
                whiteSpace: 'nowrap',
              }}>
              <RefreshCw size={12} style={{ transform: syncing ? 'rotate(20deg)' : undefined }} />
              {syncing ? 'SYNCING' : 'SYNC'}
            </button>
            {/* Perf preset cycling button */}
            <button onClick={cyclePerf} title="Cycle performance preset (Low / Normal / Ornate)"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(0,0,0,.42)', border: `1px solid ${perfLevel === 'low' ? '#f59e0b66' : perfLevel === 'ornate' ? '#8b5cf666' : 'rgba(200,168,85,.28)'}`,
                borderRadius: 7,
                color: perfLevel === 'low' ? '#f59e0b' : perfLevel === 'ornate' ? '#a78bfa' : '#c8a85599',
                fontSize: 10, padding: '7px 11px', fontFamily: 'monospace',
                cursor: 'pointer', letterSpacing: 1, whiteSpace: 'nowrap',
              }}>
              <Zap size={12} />
              {PERF_LABELS[perfLevel]}
            </button>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 8.5, letterSpacing: 2, padding: '6px 10px',
              border: '1px solid #63f7b355', borderRadius: 7,
              color: '#63f7b3', background: 'rgba(99,247,179,.07)',
              fontFamily: 'monospace', textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              <Activity size={10} />
              Active
            </div>
          </div>
        </div>

        {/* Per-session roster — Phase B replaces the per-class legend so
            multiple same-class champions in a run group are no longer
            indistinguishable. Each row binds a session to its character
            class + identifier (branch tail or hash). Click a row to select
            that champion (same plumbing as clicking it in the 3D scene). */}
        <div className="sanctum-hud-panel" style={{
          position: 'absolute', top: 118, left: 22, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 4,
          width: 244, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
          pointerEvents: 'auto',
          fontFamily: 'monospace',
          padding: 8,
          background: 'linear-gradient(135deg, rgba(10,6,22,.78), rgba(5,3,12,.48))',
          border: '1px solid rgba(200,168,85,.16)',
          borderRadius: 8,
          boxShadow: '0 18px 48px rgba(0,0,0,.34), 0 0 0 1px rgba(255,255,255,.02) inset',
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '2px 2px 7px', marginBottom: 2,
            borderBottom: '1px solid rgba(200,168,85,.12)',
          }}>
            <span style={{ fontSize: 8, color: '#c8a85577', letterSpacing: 1.8, textTransform: 'uppercase' }}>
              Champions
            </span>
            <span style={{ fontSize: 8, color: '#63f7b388' }}>{flatNodes.length}</span>
          </div>
          {flatNodes.map((pn) => {
            const ident = sessionIdentifier(pn.session);
            const isSel = selected === pn.session.session_id;
            const displayName = formatSessionDisplayName(pn.session, { maxTitle: 36, maxFolder: 18 });
            const fullDisplayName = formatSessionDisplayName(pn.session, { maxTitle: 100, maxFolder: 60 });
            return (
              <button
                key={pn.session.session_id}
                onClick={() => handleSelect(isSel ? null : pn.session.session_id)}
                title={`${fullDisplayName} · ${pn.cls.label} · ${pn.session.model}`}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'flex-start', gap: 7,
                  background: isSel ? `${ident.accent}24` : 'rgba(255,255,255,.015)',
                  border: `1px solid ${isSel ? `${ident.accent}88` : 'rgba(200,168,85,.08)'}`,
                  borderRadius: 6,
                  padding: '6px 7px',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  boxShadow: isSel ? `0 0 18px ${ident.accent}22` : 'none',
                }}
              >
                <span style={{ fontSize: 9, color: pn.cls.color, opacity: 0.95, marginTop: 2 }}>◆</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{
                    display: 'block',
                    fontSize: 8.5, color: '#e8d5a3',
                    letterSpacing: 0.2, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {displayName}
                  </span>
                  <span style={{
                    display: 'block', marginTop: 2,
                    fontSize: 7, color: `${ident.accent}cc`,
                    letterSpacing: 0.8, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textShadow: `0 0 3px ${ident.accent}55`,
                  }}>
                    {ident.tag} · {pn.cls.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Controls hint */}
        <div className="sanctum-hud-panel" style={{
          position: 'absolute', top: 118,
          right: selectedNode ? 292 : 22,
          zIndex: 10, pointerEvents: 'none', fontFamily: 'monospace',
          transition: 'right 0.2s ease',
          padding: '8px 10px',
          background: 'rgba(7,4,16,.36)',
          border: '1px solid rgba(200,168,85,.10)',
          borderRadius: 8,
          backdropFilter: 'blur(8px)',
        }}>
          {['SCROLL · ZOOM', 'DRAG  · PAN', 'CLICK · SELECT', '` · HUD'].map((hint) => (
            <div key={hint} style={{ fontSize: 8, color: '#c8a85555', letterSpacing: 1.5, textAlign: 'right', marginBottom: 2 }}>
              {hint}
            </div>
          ))}
        </div>

        {/* WebGL Canvas */}
        <div style={{ flex: '1 1 0', minHeight: 0, position: 'relative' }}>
          {/* Cinematic vignette: keeps the eye on the central plaza while
              leaving the Eternal and far towers readable. Pure CSS overlay
              with `pointer-events: none` so Canvas interaction stays intact. */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(4,2,12,.42) 76%, rgba(2,1,6,.88) 100%), linear-gradient(180deg, rgba(2,1,8,.28) 0%, transparent 22%, rgba(2,1,8,.32) 100%)',
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
            <Stars radius={60} depth={20} count={800} factor={2} fade speed={0.3} />
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
                  {...(activeEvent ? { eventBeat: activeEvent.beat, eventBeatKey: activeEvent.key } : {})}
                  costGauge={costGauge}
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

          {activeEvent && (
            <div className="sanctum-hud-panel" style={{
              position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 22,
              padding: '6px 12px', borderRadius: 8, pointerEvents: 'none', fontFamily: 'monospace',
              color: activeEvent.beat.type === 'E3' ? PAL.cyan : PAL.gold,
              background: 'rgba(8,5,20,.72)', border: '1px solid rgba(242,208,107,.20)',
              backdropFilter: 'blur(14px)', letterSpacing: 1.4, fontSize: 10,
            }}>
              {activeEvent.beat.type} · {{ E1: 'PORTAL ARRIVAL', E2: 'VICTORY', E3: 'WISP ASCENSION', E4: 'SPEND PULSE', E5: 'CHAMPION FOCUS' }[activeEvent.beat.type]}
            </div>
          )}

          {/* Possession HUD — top-center chip while driving an agent */}
          {possessedId && possessionHint && (
            <div className="sanctum-hud-panel" style={{
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
            <div className="sanctum-hud-panel" style={{
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
            <div className="sanctum-hud-panel" style={{
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
