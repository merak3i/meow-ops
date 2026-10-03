// ScryingSanctum.tsx — civic archive scene for local session activity
// Session-bound archive characters · live record paths · Archive Seal

import { useRef, useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, Sparkles } from '@react-three/drei';
import { Activity, RefreshCw, Zap } from 'lucide-react';
// EffectComposer/Bloom removed — was breaking WebGL render pipeline on Apple GPU
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Session } from '@/types/session';
import { SanctumGuide } from './sanctum/SanctumGuide';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { SessionRunGroup } from '@/lib/agent-tree';
import { formatRelativeTime, ageMinutes } from '@/lib/format-time';
import { toISTDate } from '@/lib/format';

// ─── Sanctum sub-modules ─────────────────────────────────────────────────────
//
// The Scrying Sanctum was originally one 5500-line file. The data + pure-
// helper layer was split out to ./sanctum/ to make each concept editable in
// isolation without scrolling through the entire scene definition. The 3D
// component layer (ArchiveEnvironment, SessionChampionNode, ArchiveWarden, LLM Sun,
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
  getShadowTexture, getMarbleTexture, buildClassTexture,
} from './sanctum/textures';
import {
  PerfContext, usePerfLevel, SceneErrorBoundary,
  PerfReader, WebGLContextWatcher,
} from './sanctum/perf';
import { ArchiveWarden } from './sanctum/ArchiveWarden';
import { ArchiveSeal, ArchiveSealMark } from './sanctum/ArchiveSeal';
import { loadRosterArtTexture, SESSION_ROSTER_ART_SPECS } from './sanctum/roster-art';
import { SessionRosterModel } from './sanctum/SessionRosterModel';
import { agentSeparationNudge } from './sanctum/agent-separation.mjs';
import { applySceneCameraZoom, getSceneMinZoom, getSceneZoom } from './sanctum/scene-camera-zoom.mjs';
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

// ─── Archive Environment ─────────────────────────────────────────────────────

const ARCHIVE_INDEX_MARKER_POSITIONS: readonly [number, number, number][] = [
  [9, 0, 0], [0, 0, 9], [-9, 0, 0],
];

const ARCHIVE_INDEX_MARKER_PARTS = [
  { size: [1.05, 0.34, 0.92] as const, offset: [0, 0.17, 0] as const, color: PAL.stone500, roughness: 0.78, metalness: 0.3 },
  { size: [0.66, 2.1, 0.52] as const, offset: [0, 1.28, 0] as const, color: PAL.night700, roughness: 0.66, metalness: 0.26 },
  { size: [0.42, 1.65, 0.04] as const, offset: [0, 1.28, 0.28] as const, color: '#34494b', roughness: 0.56, metalness: 0.32 },
  { size: [0.9, 0.1, 0.68] as const, offset: [0, 2.43, 0] as const, color: PAL.gold, roughness: 0.58, metalness: 0.42 },
] as const;

function ArchiveIndexMarkers() {
  const perf = usePerfLevel();
  const staticRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const statusRef = useRef<THREE.InstancedMesh>(null);
  const scanRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    for (const [partIndex, part] of ARCHIVE_INDEX_MARKER_PARTS.entries()) {
      const mesh = staticRefs.current[partIndex];
      if (!mesh) continue;
      ARCHIVE_INDEX_MARKER_POSITIONS.forEach(([x, , z], instanceIndex) => {
        transform.position.set(x + part.offset[0], part.offset[1], z + part.offset[2]);
        transform.updateMatrix();
        mesh.setMatrixAt(instanceIndex, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    const status = statusRef.current;
    const scan = scanRef.current;
    ARCHIVE_INDEX_MARKER_POSITIONS.forEach(([x, , z], instanceIndex) => {
      transform.position.set(x, 2.03, z + 0.315);
      transform.updateMatrix();
      status?.setMatrixAt(instanceIndex, transform.matrix);
      transform.position.set(x, 1.58, z + 0.318);
      transform.updateMatrix();
      scan?.setMatrixAt(instanceIndex, transform.matrix);
    });
    if (status) {
      status.instanceMatrix.needsUpdate = true;
      status.computeBoundingSphere();
    }
    if (scan) {
      scan.instanceMatrix.needsUpdate = true;
      scan.computeBoundingSphere();
    }
  }, [transform]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (statusRef.current) {
      (statusRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.58 + Math.sin(time * 1.25) * 0.16;
    }
    if (scanRef.current) {
      ARCHIVE_INDEX_MARKER_POSITIONS.forEach(([x, , z], instanceIndex) => {
        const y = 0.88 + ((time * 0.28 + Math.abs(z) * 0.1) % 1.4);
        transform.position.set(x, y, z + 0.318);
        transform.updateMatrix();
        scanRef.current!.setMatrixAt(instanceIndex, transform.matrix);
      });
      scanRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {ARCHIVE_INDEX_MARKER_PARTS.map((part, index) => (
        <instancedMesh key={index} ref={(mesh) => { staticRefs.current[index] = mesh; }}
          args={[undefined, undefined, ARCHIVE_INDEX_MARKER_POSITIONS.length]}>
          <boxGeometry args={part.size} />
          <meshStandardMaterial color={part.color} roughness={part.roughness} metalness={part.metalness} />
        </instancedMesh>
      ))}
      <instancedMesh ref={statusRef} args={[undefined, undefined, ARCHIVE_INDEX_MARKER_POSITIONS.length]}>
        <boxGeometry args={[0.22, 0.14, 0.035]} />
        <meshBasicMaterial color={PAL.cyan} transparent opacity={0.65}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={scanRef} args={[undefined, undefined, ARCHIVE_INDEX_MARKER_POSITIONS.length]}>
        <boxGeometry args={[0.3, 0.035, 0.035]} />
        <meshBasicMaterial color={PAL.cyan} transparent opacity={0.54}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      {perf !== 'low' && ARCHIVE_INDEX_MARKER_POSITIONS.map(([x, , z], index) => (
        <pointLight key={index} position={[x, 1.5, z + 0.55]} color={PAL.cyan} intensity={0.1} distance={3} />
      ))}
    </group>
  );
}



// ─── Sanctum — Magical lights + godrays ───────────────────────────────────
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
  const perf = usePerfLevel();
  const groupRef = useRef<THREE.Group>(null);
  const shaftCount = perf === 'low' ? 3 : 6;
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
      {Array.from({ length: shaftCount }, (_, i) => {
        const a = (i / shaftCount) * Math.PI;  // half-rotation since planes are double-sided-equivalent
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
  const perf = usePerfLevel();
  return (
    <Sparkles count={perf === 'low' ? 24 : 120} scale={[20, 8, 20]} size={1.4} color={PAL.gold}
      speed={perf === 'low' ? 0.14 : 0.25} opacity={0.42} position={[0, 2, 0]} />
  );
}

function ArchiveFloor() {
  const indexRingRef = useRef<THREE.Group>(null);
  const wardRingRef = useRef<THREE.Mesh>(null);
  const boundaryMarkRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (indexRingRef.current) indexRingRef.current.rotation.z = t * 0.08;
    if (wardRingRef.current) (wardRingRef.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 0.8) * 0.07;
    if (boundaryMarkRef.current) boundaryMarkRef.current.rotation.z = -t * 0.06;
  });

  const floorMarks = useMemo(() => {
    const radials: { angle: number; inner: number; outer: number }[] = [];
    const boundaryParts: THREE.BufferGeometry[] = [];
    const mergeAndDispose = (parts: THREE.BufferGeometry[], label: string) => {
      try {
        const merged = mergeGeometries(parts, false);
        if (!merged) throw new Error(`${label} geometry could not be merged`);
        return merged;
      } finally {
        parts.forEach((part) => part.dispose());
      }
    };

    for (let index = 0; index < 12; index += 1) {
      radials.push({ angle: (index / 12) * Math.PI * 2, inner: 1.5, outer: 5 });
    }
    for (let index = 0; index < 24; index += 1) {
      radials.push({ angle: (index / 24) * Math.PI * 2, inner: 5.3, outer: 8 });
    }

    // The floor index marks are static geometry; merging preserves their
    // authored layout and lets the parent ring keep its slow rotation.
    const radialGeometryParts = radials.map((mark) => {
      const midRadius = (mark.inner + mark.outer) / 2;
      const geometry = new THREE.PlaneGeometry(0.04, mark.outer - mark.inner);
      const transform = new THREE.Object3D();
      transform.position.set(Math.cos(mark.angle) * midRadius, Math.sin(mark.angle) * midRadius, 0);
      transform.rotation.z = mark.angle + Math.PI / 2;
      transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      return geometry;
    });
    const radialGeometry = mergeAndDispose(radialGeometryParts, 'Archive floor radial');

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const geometry = new THREE.CircleGeometry(0.15, 6);
      geometry.translate(Math.cos(angle) * 5, Math.sin(angle) * 5, 0);
      boundaryParts.push(geometry);
    }
    let boundaryGeometry: THREE.BufferGeometry;
    try {
      boundaryGeometry = mergeAndDispose(boundaryParts, 'Archive floor boundary');
    } catch (error) {
      radialGeometry.dispose();
      throw error;
    }

    return { radialGeometry, boundaryGeometry };
  }, []);

  useEffect(() => () => {
    floorMarks.radialGeometry.dispose();
    floorMarks.boundaryGeometry.dispose();
  }, [floorMarks]);

  return (
    <>
      {/* Limestone-toned marble keeps the floor legible beneath live session paths. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[11.7, 12]} />
        <meshStandardMaterial map={getMarbleTexture()} color="#b7b3a5"
          emissive="#282b26" emissiveIntensity={0.04}
          roughness={0.86} metalness={0.04} />
      </mesh>
      {/* Copper index ring — marks the working area boundary. */}
      <mesh ref={wardRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.038, 0]}>
        <ringGeometry args={[4.9, 5.15, 64]} />
        <meshBasicMaterial color={PAL.gold} transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Eight counter-rotating index marks at radius 5. */}
      <group ref={boundaryMarkRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.036, 0]}>
        <mesh geometry={floorMarks.boundaryGeometry}>
          <meshBasicMaterial color={PAL.gold} transparent opacity={0.28}
            blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      {/* Outer edge ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[11, 11.2, 12]} />
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
      {/* Rotating radial index marks */}
      <group ref={indexRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]}>
        <mesh geometry={floorMarks.radialGeometry}>
          <meshBasicMaterial color={PAL.stone300}
            transparent opacity={0.10} side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      {/* Ground fog disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[10, 48]} />
        <meshBasicMaterial color={PAL.night700} transparent opacity={0.18} />
      </mesh>
    </>
  );
}

function ArchivePaving() {
  const perf = usePerfLevel();
  const geometry = useMemo(() => {
    if (perf === 'low') return null;

    const parts: THREE.BufferGeometry[] = [];
    const gateAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    const count = 48;
    const stepAngle = (Math.PI * 2) / count;

    try {
      for (let row = 0; row < 3; row += 1) {
        const radius = 8.95 + row * 0.82;
        const innerRadius = radius - 0.38;
        const outerRadius = radius + 0.38;
        const offset = row % 2 ? stepAngle / 2 : 0;
        for (let index = 0; index < count; index += 1) {
          const angle = index * stepAngle + offset;
          const crossesGate = gateAngles.some((gate) => {
            const difference = Math.atan2(Math.sin(angle - gate), Math.cos(angle - gate));
            return Math.abs(difference) < 0.12;
          });
          if (crossesGate) continue;

          const start = angle - stepAngle * 0.46;
          const end = angle + stepAngle * 0.46;
          const shape = new THREE.Shape();
          shape.moveTo(outerRadius * Math.cos(start), outerRadius * Math.sin(start));
          shape.absarc(0, 0, outerRadius, start, end, false);
          shape.lineTo(innerRadius * Math.cos(end), innerRadius * Math.sin(end));
          shape.absarc(0, 0, innerRadius, end, start, true);
          shape.closePath();

          const segment = new THREE.ExtrudeGeometry(shape, {
            depth: 0.10,
            bevelEnabled: true,
            bevelSegments: 1,
            steps: 1,
            bevelSize: 0.016,
            bevelThickness: 0.01,
            curveSegments: 3,
          });
          segment.rotateX(-Math.PI / 2);
          segment.translate(0, -0.04, 0);
          parts.push(segment);
        }
      }

      const merged = mergeGeometries(parts, false);
      if (!merged) throw new Error('archive paving geometry could not be merged');
      return merged;
    } finally {
      parts.forEach((part) => part.dispose());
    }
  }, [perf]);

  useEffect(() => {
    if (!geometry) return;
    return () => geometry.dispose();
  }, [geometry]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#9b8e7c" emissive="#241b14"
        emissiveIntensity={0.08} roughness={0.9} metalness={0.02} />
    </mesh>
  );
}

// ─── Ground Paths (radial walkways from gates to center) ────────────────────

function SessionPathNetwork() {
  const GATE_ANGLES = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]; // N(-z), E(+x), S(+z), W(-x)
  const RADII = [5.8, 6.8, 7.8, 8.8, 9.5, 10.3];

  const geometries = useMemo(() => {
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
    const pathParts = segs.map((segment) => {
      const geometry = new THREE.PlaneGeometry(0.8, 1.8);
      const transform = new THREE.Object3D();
      transform.position.set(segment.x, -0.044, segment.z);
      transform.rotation.set(-Math.PI / 2, 0, segment.rot);
      transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      return geometry;
    });
    const gateParts = GATE_ANGLES.map((angle) => {
      const geometry = new THREE.RingGeometry(0.3, 0.4, 8);
      const transform = new THREE.Object3D();
      transform.position.set(Math.sin(angle) * 5.8, -0.042, -Math.cos(angle) * 5.8);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      return geometry;
    });
    const mergeAndDispose = (parts: THREE.BufferGeometry[], label: string) => {
      try {
        const merged = mergeGeometries(parts, false);
        if (!merged) throw new Error(`${label} geometry could not be merged`);
        return merged;
      } finally {
        parts.forEach((part) => part.dispose());
      }
    };
    return {
      paths: mergeAndDispose(pathParts, 'Session paths'),
      gates: mergeAndDispose(gateParts, 'Session gate seals'),
    };
  }, []);

  useEffect(() => () => {
    geometries.paths.dispose();
    geometries.gates.dispose();
  }, [geometries]);

  return (
    <>
      <mesh geometry={geometries.paths}>
        <meshBasicMaterial color="#283c3d" transparent opacity={0.62} side={THREE.DoubleSide} />
      </mesh>
      {/* Eight-ray index seals where paths meet the inner ring. */}
      <mesh geometry={geometries.gates}>
        <meshBasicMaterial color="#64e5c2" transparent opacity={0.24} />
      </mesh>
    </>
  );
}

function ArchiveAtrium() {
  const perf = usePerfLevel();
  const geometry = useMemo(() => {
    const casework: THREE.BufferGeometry[] = [];
    const stone: THREE.BufferGeometry[] = [];
    const copper: THREE.BufferGeometry[] = [];
    const books: THREE.BufferGeometry[] = [];
    const bookPalette = ['#665b4a', '#465a57', '#6b4f40', '#687064', '#817355', '#4c5049']
      .map((color) => new THREE.Color(color));
    const addBox = (
      target: THREE.BufferGeometry[],
      position: [number, number, number],
      size: [number, number, number],
      rotationY = 0,
    ) => {
      const box = new THREE.BoxGeometry(...size);
      box.rotateY(rotationY);
      box.translate(...position);
      target.push(box);
    };
    const addBook = (
      position: [number, number, number],
      size: [number, number, number],
      rotationY: number,
      color: THREE.Color,
    ) => {
      const book = new THREE.BoxGeometry(...size);
      const positionAttribute = book.getAttribute('position');
      const vertexColors = new Float32Array(positionAttribute.count * 3);
      for (let vertex = 0; vertex < positionAttribute.count; vertex += 1) {
        color.toArray(vertexColors, vertex * 3);
      }
      book.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
      book.rotateY(rotationY);
      book.translate(...position);
      books.push(book);
    };
    const radialSegments = perf === 'low' ? 32 : 48;
    const shelfRows = perf === 'low' ? 2 : 3;
    const shelfRadius = 13.2;
    const shelfHeight = 2.15;
    const shelfDepth = 1.0;
    const gateHalfWidth = 1.9;
    const gateAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

    for (let index = 0; index < radialSegments; index += 1) {
      const angle = ((index + 0.5) / radialSegments) * Math.PI * 2;
      const gateDistance = gateAngles.reduce((nearest, gate) => {
        const difference = Math.atan2(Math.sin(angle - gate), Math.cos(angle - gate));
        return Math.min(nearest, Math.abs(difference) * shelfRadius);
      }, Number.POSITIVE_INFINITY);
      if (gateDistance < gateHalfWidth) continue;

      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const tangentX = -radialZ;
      const tangentZ = radialX;
      const x = radialX * shelfRadius;
      const z = radialZ * shelfRadius;
      const rotationY = -Math.PI / 2 - angle;
      const width = (Math.PI * 2 * shelfRadius / radialSegments) * 0.86;
      const frontX = x - radialX * (shelfDepth / 2 + 0.025);
      const frontZ = z - radialZ * (shelfDepth / 2 + 0.025);

      addBox(casework, [x, shelfHeight / 2, z], [width, shelfHeight, shelfDepth], rotationY);
      addBox(stone, [x, 0.12, z], [width + 0.12, 0.20, shelfDepth + 0.14], rotationY);
      addBox(stone, [x, shelfHeight + 0.06, z], [width + 0.16, 0.12, shelfDepth + 0.18], rotationY);

      for (let row = 1; row <= shelfRows; row += 1) {
        const y = 0.32 + row * 0.56;
        addBox(copper, [frontX, y, frontZ], [width * 0.9, 0.035, 0.035], rotationY);
      }

      const bookCount = perf === 'low' ? 5 : 4;
      const bookStep = (width * 0.7) / bookCount;
      for (let row = 0; row < shelfRows; row += 1) {
        const centerY = 0.32 + (row + 0.5) * 0.56;
        for (let bookIndex = 0; bookIndex < bookCount; bookIndex += 1) {
          const variant = index * 17 + row * 7 + bookIndex * 3;
          const bookWidth = bookStep * (0.74 + (variant % 4) * 0.06);
          const bookHeight = 0.36 + (variant % 4) * 0.025;
          const bookDepth = 0.28 + (variant % 3) * 0.035;
          const bookRadius = shelfRadius - shelfDepth / 2 - bookDepth / 2 - 0.035;
          const tangentOffset = (bookIndex - (bookCount - 1) / 2) * bookStep;
          const color = bookPalette[variant % bookPalette.length]!;
          addBook(
            [
              radialX * bookRadius + tangentX * tangentOffset,
              centerY,
              radialZ * bookRadius + tangentZ * tangentOffset,
            ],
            [bookWidth, bookHeight, bookDepth],
            rotationY,
            color,
          );
        }
      }
    }

    // Low limestone piers define four wide aisles through the continuous shelf ring.
    for (const angle of gateAngles) {
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const tangentX = -radialZ;
      const tangentZ = radialX;
      const rotationY = -Math.PI / 2 - angle;
      for (const side of [-1, 1]) {
        const offset = side * (gateHalfWidth + 0.28);
        const x = radialX * shelfRadius + tangentX * offset;
        const z = radialZ * shelfRadius + tangentZ * offset;
        addBox(stone, [x, shelfHeight / 2, z], [0.38, shelfHeight + 0.24, shelfDepth + 0.18], rotationY);
        addBox(copper, [x, shelfHeight + 0.23, z], [0.52, 0.06, shelfDepth + 0.22], rotationY);
      }
    }

    // Three offset elliptical roof rims frame the skylights without a tower silhouette.
    const skylightCount = perf === 'low' ? 1 : 3;
    const skylights = [
      { x: -6.5, z: -2.3, radiusX: 2.2, radiusZ: 1.45 },
      { x: 0.3, z: 2.1, radiusX: 2.45, radiusZ: 1.55 },
      { x: 6.4, z: -2.2, radiusX: 2.2, radiusZ: 1.45 },
    ];
    for (const opening of skylights.slice(0, skylightCount)) {
      const rim = new THREE.TorusGeometry(1, 0.09, 5, 64);
      rim.rotateX(Math.PI / 2);
      rim.scale(opening.radiusX, 1, opening.radiusZ);
      rim.translate(opening.x, 6.9, opening.z);
      stone.push(rim);
    }

    const merge = (parts: THREE.BufferGeometry[]) => {
      if (!parts.length) return new THREE.BufferGeometry();
      try {
        const result = mergeGeometries(parts, false);
        if (!result) throw new Error('Archive atrium geometry could not be merged');
        return result;
      } finally {
        parts.forEach((part) => part.dispose());
      }
    };
    return [merge(casework), merge(stone), merge(copper), merge(books)] as const;
  }, [perf]);

  useEffect(() => () => geometry.forEach((part) => part.dispose()), [geometry]);

  return (
    <group>
      <mesh geometry={geometry[0]}>
        <meshStandardMaterial color="#302d28" roughness={0.86} metalness={0.06} />
      </mesh>
      <mesh geometry={geometry[1]}>
        <meshStandardMaterial color="#9a9588" roughness={0.92} metalness={0.03} />
      </mesh>
      <mesh geometry={geometry[2]}>
        <meshStandardMaterial color="#8a6948" roughness={0.64} metalness={0.38} />
      </mesh>
      <mesh geometry={geometry[3]}>
        <meshStandardMaterial color="#ffffff" roughness={0.9} vertexColors />
      </mesh>
      {[0, 1].map((ring) => (
        <mesh key={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06 + ring * 0.015, -10.8]}>
          <ringGeometry args={[8.8 + ring * 0.22, 8.9 + ring * 0.22, 96]} />
          <meshBasicMaterial color={ring === 0 ? '#2b6459' : '#9a774e'} transparent opacity={0.3}
            blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Stage Rim ──────────────────────────────────────────────────────────────
//
// Flat annular ring on the floor at radius 8.0–8.5 framing the champion
// performance area. Champions roam to ±5.5 (waypoint corners ≈ 7.8 from
// origin) so the rim sits *just outside* their reach — defines the stage
// edge without obstructing movement. 12 additive teal index marks ride on
// the lip giving the eye anchor points around the circle. Pure decals,
// no vertical extrusion (a 3D lip would clip champions at corner waypoints).

function StageRim() {
  const indexMarks = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    try {
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        const radius = 8.22;
        const mark = new THREE.PlaneGeometry(0.45, 0.18);
        const transform = new THREE.Object3D();
        transform.position.set(Math.cos(angle) * radius, 0.05, Math.sin(angle) * radius);
        transform.rotation.set(-Math.PI / 2, 0, -angle);
        transform.updateMatrix();
        mark.applyMatrix4(transform.matrix);
        parts.push(mark);
      }
      const merged = mergeGeometries(parts, false);
      if (!merged) throw new Error('Stage rim index marks could not be merged');
      return merged;
    } finally {
      parts.forEach((part) => part.dispose());
    }
  }, []);

  useEffect(() => () => indexMarks.dispose(), [indexMarks]);

  return (
    <group>
      {/* Outer dark band — reads as the cut stone edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[8.00, 8.50, 12]} />
      <meshBasicMaterial color="#112024" side={THREE.DoubleSide} />
      </mesh>
      {/* Inner lighter highlight — sells the chamfered top of the lip */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry args={[7.92, 8.02, 12]} />
      <meshBasicMaterial color="#294247" side={THREE.DoubleSide} />
      </mesh>
      {/* Twelve tangent index marks share one merged draw call. */}
      <mesh geometry={indexMarks}>
        <meshBasicMaterial color="#64e5c2" transparent opacity={0.42}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>
    </group>
  );
}

// ─── Atmospheric Fog Bands ───────────────────────────────────────────────────
//
// Stacked additive planes at the back of the scene push the archive stacks and
// Archive Warden deeper into haze, so foreground action pops.
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
        <meshBasicMaterial color="#143b3f" transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
      {/* Mid back band — tighter wash sitting in front of the far band */}
      <mesh position={[0, 2.5, -10]}>
        <planeGeometry args={[32, 5]} />
        <meshBasicMaterial color="#1b4a43" transparent opacity={0.11}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
      {/* Side bands — subtler flanks angled inward, frame the wings */}
      <mesh position={[-12, 2.8, -3]} rotation={[0, Math.PI / 4, 0]}>
        <planeGeometry args={[16, 5]} />
        <meshBasicMaterial color="#1a3e3b" transparent opacity={0.09}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[12, 2.8, -3]} rotation={[0, -Math.PI / 4, 0]}>
        <planeGeometry args={[16, 5]} />
        <meshBasicMaterial color="#1a3e3b" transparent opacity={0.09}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
          side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function IndexSpindle() {
  const perf = usePerfLevel();
  const rotorRef = useRef<THREE.Group>(null);
  const sealRef = useRef<THREE.Mesh>(null);
  const rotorGeometry = useMemo(() => {
    if (perf === 'low') return null;
    const parts: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const geometry = new THREE.BoxGeometry(0.34, 0.12, 0.52);
      const transform = new THREE.Object3D();
      transform.position.set(Math.cos(angle) * 0.78, 0.06, Math.sin(angle) * 0.78);
      transform.rotation.y = -angle;
      transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      parts[index % 2]!.push(geometry);
    }
    try {
      const merged = parts.map((group, index) => {
        const geometry = mergeGeometries(group, false);
        if (!geometry) throw new Error(`Index spindle rotor material ${index} could not be merged`);
        return geometry;
      });
      return merged as [THREE.BufferGeometry, THREE.BufferGeometry];
    } finally {
      parts.flat().forEach((geometry) => geometry.dispose());
    }
  }, [perf]);

  useEffect(() => () => rotorGeometry?.forEach((geometry) => geometry.dispose()), [rotorGeometry]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (rotorRef.current) rotorRef.current.rotation.y = time * 0.12;
    if (sealRef.current) {
      sealRef.current.rotation.y = -time * 0.35;
      sealRef.current.position.y = 2.05 + Math.sin(time * 0.7) * 0.06;
    }
  });

  if (perf === 'low' || !rotorGeometry) return null;

  return (
    <group position={[-5.8, 0, 2.5]} scale={1.1}>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[1.5, 1.68, 0.32, 8]} />
        <meshStandardMaterial color="#24343a" roughness={0.72} metalness={0.28} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[1.25, 1.42, 0.12, 8]} />
        <meshStandardMaterial color="#9a774e" roughness={0.56} metalness={0.46} />
      </mesh>
      <group ref={rotorRef} position={[0, 0.44, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.02, 0.045, 6, 32]} />
          <meshStandardMaterial color="#64e5c2" emissive="#237b6a" emissiveIntensity={0.8}
            metalness={0.32} roughness={0.42} />
        </mesh>
        <mesh geometry={rotorGeometry[0]}>
          <meshStandardMaterial color="#40545a" roughness={0.6} metalness={0.25} />
        </mesh>
        <mesh geometry={rotorGeometry[1]}>
          <meshStandardMaterial color="#34474d" roughness={0.6} metalness={0.25} />
        </mesh>
      </group>
      <mesh ref={sealRef} position={[0, 2.05, 0]}>
        <octahedronGeometry args={[0.38, 0]} />
        <meshBasicMaterial color="#64e5c2" transparent opacity={0.82}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.46, 0]}>
        <circleGeometry args={[0.26, 8]} />
        <meshBasicMaterial color="#e5bb78" />
      </mesh>
    </group>
  );
}



function ArchiveEnvironment() {
  return (
    <>
      <ArchiveFloor />
      <ArchivePaving />
      <StageRim />
      <AtmosphericFog />
      <ArchiveAtrium />
      <IndexSpindle />
      <ArchiveIndexMarkers />
      {/* The four aisles stay open so the archive floor and session paths remain readable. */}
      <SunGodrays />
      <AtmosphericMotes />
      <SessionPathNetwork />
    </>
  );
}

// ─── session Nameplate ────────────────────────────────────────────────────────────

function SessionNameplate({ pn, maxCost, selected, nowEpoch, possessed }: {
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
      <div className="sanctum-hud-panel sanctum-session-nameplate" data-testid="sanctum-session-nameplate" style={{
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

// ─── session Champion Node ────────────────────────────────────────────────────────

function SessionChampionNode({ pn, maxCost, maxTokens, selected, onClick, onPosUpdate, parentPos, livePosMap, controlsRef, isDraggingRef, nowEpoch, possessed, moveInputRef, cursorGroundRef, moveOrdersRef }: {
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
  const perf = usePerfLevel();
  const groupRef    = useRef<THREE.Group>(null);
  const spriteRef   = useRef<THREE.Sprite>(null);
  const spriteTextureOverrideRef = useRef<THREE.Texture | null>(null);
  const modelGroupRef = useRef<THREE.Group>(null);
  const [modelReady, setModelReady] = useState(false);
  const [rosterArtReady, setRosterArtReady] = useState(false);
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
  const rosterPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('roster') === '3d';
  const onModelReadyChange = useCallback((ready: boolean) => setModelReady(ready), []);
  const showRosterModel = rosterPreview && selected;
  const rosterArtSpec = SESSION_ROSTER_ART_SPECS[catType];

  useEffect(() => {
    let active = true;
    let artTexture: THREE.CanvasTexture | null = null;
    const sprite = spriteRef.current;
    setRosterArtReady(false);
    if (!sprite || !rosterArtSpec) return () => { active = false; };

    void loadRosterArtTexture(rosterArtSpec).then(loadedTexture => {
      if (!active) return;
      artTexture = loadedTexture;
        spriteTextureOverrideRef.current = artTexture;
        (sprite.material as THREE.SpriteMaterial).map = artTexture;
        (sprite.material as THREE.SpriteMaterial).needsUpdate = true;
        setRosterArtReady(true);
    }).catch(() => {
      // Keep the normal sprite visible if a local concept image is unavailable.
    });

    return () => {
      active = false;
      if (spriteTextureOverrideRef.current === artTexture) spriteTextureOverrideRef.current = null;
      const currentSprite = spriteRef.current;
      if (currentSprite) {
        (currentSprite.material as THREE.SpriteMaterial).map = textures[frameRef.current] ?? textures[0];
        (currentSprite.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    };
  }, [rosterArtSpec, textures]);

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
            (spriteRef.current.material as THREE.SpriteMaterial).map = spriteTextureOverrideRef.current ?? textures[frameRef.current]!;
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
            (spriteRef.current.material as THREE.SpriteMaterial).map = spriteTextureOverrideRef.current ?? textures[frameRef.current]!;
            (spriteRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
          }
        }
      }

      // ── Collision avoidance: keep silhouettes apart in the angled camera ──
      const myId = pn.session.session_id;
      let separationX = 0;
      let separationZ = 0;
      livePosMap.current.forEach((otherPos, otherId) => {
        const [nudgeX, nudgeZ] = agentSeparationNudge(
          livePosRef.current.x,
          livePosRef.current.z,
          otherPos.x,
          otherPos.z,
          myId,
          otherId,
          delta,
        );
        separationX += nudgeX;
        separationZ += nudgeZ;
      });
      const separationLength = Math.sqrt(separationX * separationX + separationZ * separationZ);
      const separationScale = separationLength > 0.12 ? 0.12 / separationLength : 1;
      livePosRef.current.x += separationX * separationScale;
      livePosRef.current.z += separationZ * separationScale;
    }
    if (moving && !wasMovingRef.current) startTimerRef.current = START_DURATION;
    if (!moving && wasMovingRef.current) {
      settleTimerRef.current = SETTLE_DURATION;
      frameRef.current = 0;
      if (spriteRef.current) {
        (spriteRef.current.material as THREE.SpriteMaterial).map = spriteTextureOverrideRef.current ?? textures[0];
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
    if (modelGroupRef.current) {
      modelGroupRef.current.position.y = spriteY + liftY;
      modelGroupRef.current.scale.setScalar(spawnEase * (hovered.current ? 1.08 : 1) * (1 + dragLift.current * 0.06));
    }

    // ── Shadow: shrinks + fades as character lifts ──
    if (shadowRef.current) {
      const liftShrink  = 1 - dragLift.current * 0.55;
      const shadowScale = 0.35 * (1 - walkBounce * 1.5) * spawnEase * liftShrink;
      shadowRef.current.scale.setScalar(shadowScale / 0.35);
      (shadowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * liftShrink;
    }

    groupRef.current.position.copy(livePosRef.current);
    onPosUpdate(pn.session.session_id, livePosRef.current);

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
        // Lanternmote: spectral glitch
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
      {/* Phase B — one pedestal accent ring. Its hash-derived color
          distinguishes same-class sessions; the inner floor aura retains
          the class tint. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <ringGeometry args={[1.10, 1.22, 48]} />
        <meshBasicMaterial color={ident.accent} transparent opacity={0.45}
          blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
          depthWrite={false} fog={false} />
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
      {/* Original 3D studies load only in the local `?roster=3d` review and
          only for the selected session. The familiar sprite remains the
          loading/error fallback and stays in use everywhere else. */}
      {showRosterModel && (
        <group ref={modelGroupRef}>
          <SessionRosterModel catType={catType} isMovingRef={isMovingRef} onReadyChange={onModelReadyChange} />
        </group>
      )}
      {/* Keep session portraits readable above nearby archive props; otherwise
          normal-tier atrium geometry hides most roster sprites. */}
      <sprite ref={spriteRef} visible={!showRosterModel || !modelReady} scale={[2.0, 3.0, 1]} position={[0, 1.5, 0]}>
        <spriteMaterial map={textures[0]} transparent alphaTest={0.1} depthTest={false} depthWrite={false} />
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
      {/* Low preset drops decorative per-session effects to preserve frame budget. */}
      {perf !== 'low' && <CharacterTrail color={trailColor} isMoving={isMovingRef} />}
      {perf !== 'low' && <FootstepDust isMoving={isMovingRef} />}
      {/* Phase B — compact session key. Branch tails stay in the side roster;
          the fixed-width hash keeps moving labels short and easy to match. */}
      <Html center position={[0, 3.05, 0]} style={{ pointerEvents: 'none' }}>
        <div data-testid={showRosterModel && modelReady
          ? 'sanctum-roster-model-loaded'
          : rosterArtSpec && rosterArtReady ? 'sanctum-roster-character-loaded' : undefined} style={{
          fontSize: 8.5,
          color: ident.accent,
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          letterSpacing: 1,
          textShadow: `0 0 4px ${ident.accent}66, 0 0 2px rgba(0,0,0,.9)`,
          userSelect: 'none',
          opacity: 0.85,
          textAlign: 'center',
        }} className="sanctum-session-tag" data-session-tag="true" data-session-selected={selected ? 'true' : undefined}
          data-roster-role={rosterArtSpec && rosterArtReady ? catType : undefined}>
          {showRosterModel && modelReady ? `${c.label} · 3D study` : `#${ident.hashShort}`}
        </div>
      </Html>
      {/* Nameplate is click-to-open: hidden by default, shows only when this
          character is selected (or possessed by an admin). Keeps the Sanctum
          floor readable instead of plastered with HUD cards. */}
      {(selected || possessed) && !showRosterModel && (
        <SessionNameplate pn={pn} maxCost={maxCost} maxTokens={maxTokens} selected={selected}
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

function SceneZoomController({ zoom }: { zoom: number }) {
  const camera = useThree(state => state.camera);
  const canvas = useThree(state => state.gl.domElement);

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    applySceneCameraZoom(camera, zoom);
    canvas.dataset.sceneCameraZoom = String(camera.zoom);
  }, [camera, canvas, zoom]);

  return null;
}

// ─── Session flow path ────────────────────────────────────────────────────────

// Flowing session flow: parent → child particle stream. Vertex-colored gradient
// along the arc shows direction. Normal/Ornate use four orbs; Low uses one and
// fewer curve segments to keep linked-session motion lighter.
function SessionFlowLine({ childId, parentId, color, parentColor, livePosMap }: {
  childId:     string;
  parentId:    string;
  color:       string;
  parentColor: string;
  livePosMap:  React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const perf = usePerfLevel();
  const segmentCount = perf === 'low' ? 12 : 24;
  const orbCount = perf === 'low' ? 1 : 4;

  const parentC = useMemo(() => new THREE.Color(parentColor), [parentColor]);
  const childC  = useMemo(() => new THREE.Color(color), [color]);

  // Gradient line (vertex colors go parent → child along the arc)
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segmentCount + 1) * 3), 3));
    const colors = new Float32Array((segmentCount + 1) * 3);
    for (let i = 0; i <= segmentCount; i++) {
      const t = i / segmentCount;
      const c = new THREE.Color().lerpColors(parentC, childC, t);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [parentC, childC, segmentCount]);

  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, linewidth: 2 }),
    [],
  );
  const lineObj = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ), []);
  const curvePoint = useMemo(() => new THREE.Vector3(), []);

  // Convoy of flowing orbs, phases staggered evenly along 0..1
  const orbRefs = useRef<(THREE.Mesh | null)[]>([]);
  const orbColors = useMemo(
    () => Array.from({ length: orbCount }, (_, i) => {
      const t = i / (orbCount - 1);
      return new THREE.Color().lerpColors(parentC, childC, t);
    }),
    [parentC, childC, orbCount],
  );
  const phase = useRef(0);

  useEffect(() => () => { lineGeo.dispose(); lineMat.dispose(); }, [lineGeo, lineMat]);

  useFrame((state, delta) => {
    const from = livePosMap.current.get(parentId);
    const to   = livePosMap.current.get(childId);
    if (!from || !to) return;

    const midY = Math.max(from.y, to.y) + 2.5;
    curve.v0.copy(from).setY(from.y + 1.2);
    curve.v1.set((from.x + to.x) / 2, midY, (from.z + to.z) / 2);
    curve.v2.copy(to).setY(to.y + 1.2);

    // Update line geometry positions only — colors stay constant
    const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= segmentCount; i++) {
      const p = curve.getPoint(i / segmentCount, curvePoint);
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;

    // Convoy flows parent → child
    phase.current = (phase.current + delta * 0.42) % 1;
    for (let i = 0; i < orbCount; i++) {
      const ref = orbRefs.current[i];
      if (!ref) continue;
      const t = (phase.current + i / orbCount) % 1;
      ref.position.copy(curve.getPoint(t, curvePoint));
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


// ─── Session Index Dial ──────────────────────────────────────────────────────
//
// Ground-level magical centerpiece directly under the LLM Sun. Two counter-
// rotating runic rings + an inner glow disc. Decorative only — sells the
// "you are in a archive atrium" feel without any click behavior.
function SessionIndexDial() {
  const ringRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (ringRef.current) ringRef.current.rotation.z = time * 0.08;
    if (coreRef.current) {
      const material = coreRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.62 + Math.sin(time * 1.05) * 0.12;
    }
  });

  return (
    <group position={[0, 0.07, 0]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.5, 2.72, 12]} />
        <meshBasicMaterial color="#9a774e" transparent opacity={0.62}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <ringGeometry args={[1.8, 1.9, 8]} />
        <meshBasicMaterial color="#64e5c2" transparent opacity={0.42}
          blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={coreRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[0.72, 12]} />
        <meshBasicMaterial color="#64e5c2" transparent opacity={0.62}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
        <ArchiveSeal size={2.25} />
      </group>
    </group>
  );
}



// Curved compute ray from the sun to a single agent. Normal/Ornate use two
// flowing particles; Low keeps one particle and a shorter curve per session.
function ComputeRay({ sessionId, color, livePosMap }: {
  sessionId: string;
  color: string;
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
}) {
  const perf = usePerfLevel();
  const segmentCount = perf === 'low' ? 8 : 16;
  const orbCount = perf === 'low' ? 1 : 2;

  const sunC   = useMemo(() => new THREE.Color('#ffcb6a'), []);
  const agentC = useMemo(() => new THREE.Color(color), [color]);

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segmentCount + 1) * 3), 3));
    const colors = new Float32Array((segmentCount + 1) * 3);
    for (let i = 0; i <= segmentCount; i++) {
      const t = i / segmentCount;
      const c = new THREE.Color().lerpColors(sunC, agentC, t);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [sunC, agentC, segmentCount]);

  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }),
    [],
  );
  const lineObj = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat]);
  const orbRefs = useRef<(THREE.Mesh | null)[]>([]);
  const orbColors = useMemo(() => Array.from({ length: orbCount }, (_, index) => {
    const t = index / Math.max(1, orbCount - 1);
    return new THREE.Color().lerpColors(sunC, agentC, t);
  }), [sunC, agentC, orbCount]);
  const phase = useRef(Math.random());
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ), []);
  const curvePoint = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => () => { lineGeo.dispose(); lineMat.dispose(); }, [lineGeo, lineMat]);

  useFrame((state, delta) => {
    const to = livePosMap.current.get(sessionId);
    if (!to) return;
    const from = SUN_POSITION;
    // Arc peaks between sun and agent
    curve.v0.copy(from);
    curve.v1.set(
      (from.x + to.x) / 2,
      Math.max(from.y, to.y + 1.5) + 1.5,
      (from.z + to.z) / 2,
    );
    curve.v2.copy(to).setY(to.y + 1.5);

    const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= segmentCount; i++) {
      const p = curve.getPoint(i / segmentCount, curvePoint);
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;

    // Flowing sun → agent
    phase.current = (phase.current + delta * 0.55) % 1;
    for (let i = 0; i < orbCount; i++) {
      const ref = orbRefs.current[i];
      if (!ref) continue;
      const t = orbCount === 1 ? phase.current : (phase.current + i / orbCount) % 1;
      ref.position.copy(curve.getPoint(t, curvePoint));
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
      {orbColors.map((colorAtPoint, i) => {
        return (
          <mesh key={i} ref={(el) => { orbRefs.current[i] = el; }}>
            <sphereGeometry args={[0.07, 6, 6]} />
            <meshStandardMaterial color={colorAtPoint} emissive={colorAtPoint} emissiveIntensity={4}
              transparent opacity={0.7} />
          </mesh>
        );
      })}
    </>
  );
}

// ─── session Tooltip Overlay ──────────────────────────────────────────────────────

function SessionTooltipOverlay({ session, cls, name, onClose }: {
  session: Session; cls: ClassConfig; name: string; onClose: () => void;
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
    <div className="sanctum-hud-panel sanctum-session-inspector" data-testid="sanctum-session-inspector" style={{
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
            {catType.toUpperCase()} · {cls.label} · {session.model}
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
            Archive milestones
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
            Tools used
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

function Scene({ group, selectedId, onSelect, livePosMapOut, nowEpoch, possessedId, moveInputRef, cursorGroundRef, moveOrdersRef, eternal, eventBeat, eventBeatKey = 0, costGauge = 0, compactViewport, cameraMinZoom }: {
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
  compactViewport:  boolean;
  cameraMinZoom:    number;
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
  const cameraCenter = useMemo(
    () => compactViewport ? center.clone().add(new THREE.Vector3(4.8, 0, -2.8)) : center,
    [center, compactViewport],
  );

  // Session-reactive ambient: compute aggregate intensity from total cost
  const totalCost = useMemo(() => nodes.reduce((s, n) => s + n.session.estimated_cost_usd, 0), [nodes]);
  // Scale: $0 → dim, $5+ → vibrant. Clamp 0..1
  const intensity = Math.min(1, totalCost / 5);
  const ambientInt = 0.48 + intensity * 0.14;   // daylight floor + session-reactive lift
  const pointInt   = 0.45 + intensity * 0.5;     // token volume still warms the Index Sun
  // Warmer hue as cost increases
  const ambientColor = intensity > 0.5 ? '#d1d0c2' : '#b7c5b7';
  const pointColor   = intensity > 0.7 ? '#e8b830' : '#c8a855';

  return (
    <>
      {/* Soft stone-toned distance fog gives the far archive depth without dimming the record floor. */}
      <fog attach="fog" args={['#344440', 30, 76]} />
      <ambientLight intensity={ambientInt} color={ambientColor} />
      <directionalLight position={[10, 20, 10]} intensity={1.25} color="#fff9eb" />
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
        <ArchiveEnvironment />
      </Suspense>

      {/* Archive Warden: permanent record keeper for cumulative local stats. */}
      <ArchiveWarden eternal={eternal} pulseKey={eventBeat?.type === 'E3' ? eventBeatKey : 0} />
      <CostGauge ratio={costGauge} pulse={eventBeat?.type === 'E4'} />
      <EventBeatVisual key={eventBeatKey} {...(eventBeat ? { beat: eventBeat } : {})} livePosMap={livePosMap} />

      {connections.map((conn) => (
        <SessionFlowLine key={conn.key} childId={conn.childId} parentId={conn.parentId}
          color={conn.color} parentColor={conn.parentColor} livePosMap={livePosMap} />
      ))}

      {nodes.map((pn) => (
        <SessionChampionNode
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

      {/* Session index dial below the LLM Sun's live token stream. */}
      <SessionIndexDial />

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

      <OrbitControls ref={controlsRef} target={cameraCenter} enableDamping dampingFactor={0.06}
        minZoom={cameraMinZoom} maxZoom={180}
        maxPolarAngle={Math.PI / 2.4} minPolarAngle={Math.PI / 8} />

      <CameraController
        controlsRef={controlsRef}
        selectedPos={selectedId ? (livePosMap.current.get(selectedId) ?? null) : null}
        center={cameraCenter}
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
      background: 'radial-gradient(ellipse at 25% 15%,rgba(24,81,71,.42) 0%,#0b1719 48%,#071114 100%)',
      flexDirection: 'column', gap: 12, color: '#c8a85544', fontFamily: 'monospace',
    }}>
      <div style={{ fontSize: 36, color: '#64e5c2' }}>◈</div>
      <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase' }}>Archive ready</div>
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
  const [hudStats,  setHudStats]  = useState<PerfStats>({ fps: 0, p95Ms: 0, calls: 0, triangles: 0, geometries: 0 });
  const [errorCount, setErrorCount] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [perfLevel, setPerfLevel] = useState<PerfLevel>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'low' : 'normal',
  );
  const [compactViewport, setCompactViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );

  useEffect(() => {
    const updateViewport = () => {
      setViewportWidth(window.innerWidth);
      setCompactViewport(window.matchMedia('(max-width: 720px)').matches);
    };
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);
  const sceneZoom = getSceneZoom(viewportWidth);
  const cameraMinZoom = getSceneMinZoom(viewportWidth);

  const livePosMap  = useRef(new Map<string, THREE.Vector3>());
  const perfStatsRef = useRef<PerfStats>({ fps: 0, p95Ms: 0, calls: 0, triangles: 0, geometries: 0 });

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
  const [eventNow, setEventNow] = useState(() => Date.now());
  const eventSequenceRef = useRef(0);
  const previousEventSnapshot = useRef<EventSnapshot | null>(null);
  const eventContextRef = useRef(group?.id ?? null);
  const enqueueBeats = useCallback((beats: SanctumEventBeat[]) => {
    if (!beats.length) return;
    setEventQueue((queue) => [...queue, ...beats.map((beat) => ({ beat, key: ++eventSequenceRef.current }))]);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setEventNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const contextId = group?.id ?? null;
    if (eventContextRef.current !== contextId) {
      eventContextRef.current = contextId;
      previousEventSnapshot.current = null;
      setEventQueue([]);
    }
    const next = snapshotSessions(flatNodes.map((node) => node.session), selected, groupCost, contextId, eventNow);
    enqueueBeats(diffEventSnapshots(previousEventSnapshot.current, next));
    previousEventSnapshot.current = next;
  }, [enqueueBeats, eventNow, flatNodes, group?.id, groupCost, selected]);

  const activeEvent = eventQueue[0];
  useEffect(() => {
    if (!activeEvent) return;
    const id = window.setTimeout(() => setEventQueue((queue) => queue.slice(1)), EVENT_DURATIONS[activeEvent.beat.type]);
    return () => window.clearTimeout(id);
  }, [activeEvent]);

  // Dev rehearsal: 1 = session arrival, 3 = incomplete-record pulse.
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
  // Archive totals across all local sessions (not just the visible run group).
  const [archiveEternal, setArchiveEternal] = useState<EternalStats | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    setArchiveEternal(null);
    void (async () => {
      try {
        const base = new URL(import.meta.env.VITE_LOCAL_SYNC_URL || 'http://127.0.0.1:7337');
        if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) return;
        const response = await fetch(new URL('/loop-eng/eternal-stats', base), {
          headers: { 'x-meow-ops-local': '1' }, signal: controller.signal,
        });
        const data = await response.json();
        const stats = data.stats;
        if (!response.ok || !data.ok || stats?.scope !== 'archive'
          || !['totalSpend', 'totalTokens', 'totalSessions', 'ghostCount'].every(key => typeof stats[key] === 'number' && Number.isFinite(stats[key]) && stats[key] >= 0)) return;
        if (!controller.signal.aborted) setArchiveEternal(stats);
      } catch { /* The visibly labelled preview remains available offline. */ }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [sessions]);
  const eternal = useMemo(() => archiveEternal ?? { ...deriveEternal(sessions), scope: 'preview' as const }, [archiveEternal, sessions]);

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
        background: 'radial-gradient(ellipse at 50% 0%, rgba(48,110,96,.20), transparent 44%), #071114',
        borderRadius: 0, overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div className="sanctum-hud-panel sanctum-toolbar" style={{
          minHeight: 70,
          padding: '12px 22px', borderBottom: '1px solid rgba(215,164,99,.2)',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          zIndex: 10, position: 'relative',
          background: 'linear-gradient(180deg, rgba(15,29,33,.96), rgba(7,17,20,.88))',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 1px 0 rgba(255,255,255,.03) inset, 0 18px 42px rgba(0,0,0,.35)',
        }}>
          <div className="sanctum-toolbar-brand" style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 236 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#64e5c2',
              background: 'radial-gradient(circle at 50% 35%, rgba(100,229,194,.20), rgba(33,84,75,.09) 62%, rgba(0,0,0,.28))',
              border: '1px solid rgba(100,229,194,.25)',
              boxShadow: '0 0 24px rgba(100,229,194,.16), 0 0 0 1px rgba(255,255,255,.03) inset',
            }}>
              <Activity size={17} strokeWidth={1.8} />
            </div>
            <div>
              <div className="sanctum-hud-title" style={{
                fontFamily: '"Cinzel", serif', fontWeight: 700,
                fontSize: 14, color: '#d7a463',
                letterSpacing: 4.2, textTransform: 'uppercase',
                textShadow: '0 0 18px rgba(215,164,99,.2)',
              }}>
                Sanctum
              </div>
              <div style={{ fontSize: 10.5, color: '#91b2a7', fontFamily: 'monospace', letterSpacing: 1.2 }}>
                Sanctum session archive
              </div>
            </div>
          </div>

          <div className="sanctum-toolbar-metrics" style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace' }}>
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

          <div className="sanctum-toolbar-controls" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 10, marginLeft: 'auto', minWidth: 0,
            flex: '1 1 520px', flexWrap: 'wrap',
          }}>
            <select className="sanctum-toolbar-run-group" value={runIdx} onChange={(e) => { setRunIdx(+e.target.value); setSelected(null); }}
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
            <SanctumGuide
              key={selectedNode ? JSON.stringify([selectedNode.session.source, selectedNode.session.project, selectedNode.session.session_id]) : 'unselected'}
              session={selectedNode?.session ?? null}
            />
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
        <div className="sanctum-hud-panel sanctum-roster" style={{
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
              Session index
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
                <ArchiveSealMark />
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
                    {ident.tag} · {pn.cls.label} · #{ident.hashShort}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Controls hint */}
        <div className="sanctum-hud-panel sanctum-controls-hint" style={{
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
          {/* Soft vignette keeps the eye on the archive floor while
              keeping the Archive Warden and record stacks readable. Pure CSS overlay
              with `pointer-events: none` so Canvas interaction stays intact. */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 50%, transparent 56%, rgba(1,12,13,.18) 78%, rgba(2,9,11,.48) 100%), linear-gradient(180deg, rgba(2,11,12,.12) 0%, transparent 22%, rgba(2,9,11,.18) 100%)',
          }} />

          <Canvas
            orthographic
            camera={{ position: [14, 12, 14], zoom: sceneZoom, up: [0, 1, 0], near: 0.1, far: 500 }}
            dpr={perfLevel === 'low' ? 1 : perfLevel === 'normal' ? [1, 1.25] : [1, 1.5]}
            gl={{ antialias: false, alpha: false }}
            // R3F's onPointerMissed fires when a click lands but no 3D mesh
            // with a handler was hit — the proper primitive for empty-space
            // deselect. Replaces the legacy onClick check that almost never
            // matched (events bubble from R3F children, so e.target ===
            // e.currentTarget was rarely true).
            onPointerMissed={() => { if (selected) setSelected(null); }}
          >
            <SceneZoomController zoom={sceneZoom} />
            {/* The open roof reads as a muted daylight well behind the limestone archive. */}
            <color attach="background" args={['#263835']} />
            <fog attach="fog" args={['#344440', 30, 76]} />
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
                  compactViewport={compactViewport}
                  cameraMinZoom={cameraMinZoom}
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
              background: 'rgba(8,18,23,.78)', border: '1px solid rgba(215,164,99,.24)',
              backdropFilter: 'blur(14px)', letterSpacing: 1.4, fontSize: 10,
            }}>
              {activeEvent.beat.type} · {{ E1: 'SESSION ARRIVAL', E2: 'RUN COMPLETE', E3: 'INCOMPLETE RECORD', E4: 'SPEND PULSE', E5: 'SESSION SELECTED' }[activeEvent.beat.type]}
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
              ◆ DIRECTING {flatNodes.find(n => n.session.session_id === possessedId)?.name ?? '—'}
              &nbsp;·&nbsp; <span style={{ color: '#e4d4a8' }}>WASD</span> move
              &nbsp;·&nbsp; <span style={{ color: '#e4d4a8' }}>CLICK</span> ground
              &nbsp;·&nbsp; <span style={{ color: '#e4d4a8' }}>ESC</span> release
            </div>
          )}

          {/* Minimap */}
          {group && <Minimap livePosMap={livePosMap} nodes={flatNodes} selectedId={selected} compact={compactViewport} />}

          {selectedNode && (
            <SessionTooltipOverlay
              session={selectedNode.session}
              cls={selectedNode.cls}
              name={selectedNode.name}
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
                  { label: 'P95 MS', value: `${hudStats.p95Ms}`, color: hudStats.p95Ms > 50 ? '#ef4444' : hudStats.p95Ms > 25 ? '#f59e0b' : '#22c55e' },
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
