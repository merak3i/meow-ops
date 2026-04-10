/**
 * ProceduralCat — multi-part procedural cat anatomy built entirely from
 * Three.js primitives.  No external 3D assets required.
 *
 * Anatomy:
 *   Body (CapsuleGeometry) — fur shells + SSS base
 *   Neck (CylinderGeometry) — solid coat colour
 *   Head (SphereGeometry)   — fur shells + SSS base, carries IK ref
 *     ├─ Ears × 2  (ConeGeometry)  — solid
 *     ├─ Snout     (SphereGeometry) — SSS
 *     ├─ Nose      (SphereGeometry) — standard
 *     └─ Eyes × 2  — sclera + iris + pupil + catchlight
 *   Front legs × 2 (CapsuleGeometry) — solid coat
 *   Paws × 2       (SphereGeometry)  — SSS
 *   Tail           (TubeGeometry)    — fur shells
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { furVertexShader, furFragmentShader, defaultFurUniforms } from './shaders/fur';
import { sssVertexShader, sssFragmentShader, defaultSSSUniforms } from './shaders/sss';
import { getBreed } from '@/lib/companion-breeds';
import type { CatAnimTargets } from './useCatAnimation';
import type { MorphWeights } from '@/types/session';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Add aTangent attribute (circumferential direction) needed by fur shader. */
function withTangents(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const positions = geo.attributes['position'];
  const normals   = geo.attributes['normal'];
  if (!positions || !normals) return geo;

  const count    = positions.count;
  const tangents = new Float32Array(count * 3);
  const up = new THREE.Vector3(0, 1, 0);
  const n  = new THREE.Vector3();
  const t  = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    n.fromBufferAttribute(normals, i).normalize();
    t.crossVectors(up, n).normalize();
    if (t.lengthSq() < 0.01) t.set(1, 0, 0);
    t.toArray(tangents, i * 3);
  }
  geo.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
  return geo;
}

/** Hex colour → [r, g, b] floats (0–1). */
function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/** Pattern type → float (matches shader uPatternType). */
const PATTERN_TYPE: Record<string, number> = {
  solid: 0, stripes: 1, spots: 2, colorpoint: 3, tuxedo: 3, patches: 0,
};

// ─── Shell renderer ───────────────────────────────────────────────────────────
// Renders N fur shells on top of a geometry using the Kajiya-Kay fur shader.

interface FurShellsProps {
  geometry:    THREE.BufferGeometry;
  shellCount:  number;
  baseColor:   [number, number, number];
  tipColor:    [number, number, number];
  furLength:   number;
  stripeScale: number;
  patternType: number;
  timeRef:     React.MutableRefObject<number>;
  fatigue:     number;
}

function FurShells({
  geometry, shellCount, baseColor, tipColor, furLength,
  stripeScale, patternType, timeRef, fatigue,
}: FurShellsProps) {
  return (
    <>
      {Array.from({ length: shellCount }, (_, i) => {
        const uniforms: Record<string, { value: unknown }> = {
          ...defaultFurUniforms(),
          uShellIndex:    { value: i },
          uShellCount:    { value: shellCount },
          uFatigue:       { value: fatigue },
          uTime:          { value: timeRef.current },
          uBaseColor:     { value: baseColor },
          uTipColor:      { value: tipColor },
          uFurLength:     { value: furLength },
          uStripeScale:   { value: stripeScale },
          uPatternType:   { value: patternType },
        };
        return (
          <mesh key={i} geometry={geometry}>
            <shaderMaterial
              vertexShader={furVertexShader}
              fragmentShader={furFragmentShader}
              uniforms={uniforms}
              side={THREE.FrontSide}
              transparent={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

// ─── SSS base mesh ────────────────────────────────────────────────────────────

function SSSMesh({ geometry, color }: { geometry: THREE.BufferGeometry; color: string }) {
  const camPos  = useMemo(() => new THREE.Vector3(), []);
  const lightDir = useMemo(() => new THREE.Vector3(0.4, 0.8, 0.5).normalize(), []);
  const [r, g, b] = hexToRgb(color);

  const uniforms = useMemo(() => ({
    ...defaultSSSUniforms(),
    uSubsurfaceColor: { value: [r * 0.9 + 0.1, g * 0.4, b * 0.3] },
    uLightDir:        { value: [lightDir.x, lightDir.y, lightDir.z] },
    uCamPos:          { value: [camPos.x, camPos.y, camPos.z] },
    uWrapFactor:      { value: 0.55 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useFrame(({ camera }) => {
    (uniforms['uCamPos'] as { value: number[] }).value = [
      camera.position.x, camera.position.y, camera.position.z,
    ];
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        vertexShader={sssVertexShader}
        fragmentShader={sssFragmentShader}
        uniforms={uniforms}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

// ─── Eye assembly ─────────────────────────────────────────────────────────────
// Scale.y is controlled externally via ref to animate blink.

function Eye({ eyeColor, flip }: { eyeColor: string; flip: boolean }) {
  const scleraGeo = useMemo(() => new THREE.SphereGeometry(0.068, 20, 20), []);
  const catchGeo  = useMemo(() => new THREE.SphereGeometry(0.013, 8, 8),  []);

  return (
    <>
      {/* Sclera */}
      <mesh geometry={scleraGeo}>
        <meshStandardMaterial color="white" roughness={0.05} />
      </mesh>

      {/* Iris */}
      <mesh position={[0, 0, 0.063]}>
        <circleGeometry args={[0.052, 24]} />
        <meshStandardMaterial color={eyeColor} roughness={0.05} metalness={0.15} />
      </mesh>

      {/* Pupil */}
      <mesh position={[0, 0, 0.065]}>
        <circleGeometry args={[0.026, 24]} />
        <meshStandardMaterial color="#060606" roughness={0} />
      </mesh>

      {/* Catchlight */}
      <mesh geometry={catchGeo} position={[flip ? -0.022 : 0.022, 0.020, 0.060]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.9} roughness={0} />
      </mesh>
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProceduralCatProps {
  breed:        string;
  headRef:      React.RefObject<THREE.Object3D | null>;
  eyesRef:      React.RefObject<THREE.Object3D | null>;
  animTargets:  React.MutableRefObject<CatAnimTargets>;
  morphWeights: MorphWeights;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProceduralCat({
  breed, headRef, eyesRef, animTargets, morphWeights,
}: ProceduralCatProps) {
  // ── Breed data ─────────────────────────────────────────────────────────────
  const breedData = getBreed(breed) as {
    palette:    { body: string; accent: string; belly: string; eyes: string; nose: string };
    silhouette: { ear: string; fur: string; body: string; tail: string; pattern: string };
  };
  const pal = breedData.palette;
  const sil = breedData.silhouette;

  const baseColor  = useMemo(() => hexToRgb(pal.body),   [pal.body]);
  const tipColor   = useMemo(() => hexToRgb(pal.accent),  [pal.accent]);
  const furLength  = sil.fur === 'long' ? 0.17 : sil.fur === 'medium' ? 0.12 : 0.09;
  const bodyShells = sil.fur === 'long' ? 24 : 20;
  const stripeScale = (sil.pattern === 'stripes') ? 3.2 : 0;
  const patternType = PATTERN_TYPE[sil.pattern] ?? 0;

  // Morph-driven size tweaks
  const headScale = 1 + morphWeights.intelligence * 0.14;
  const bodyScaleX = 1 + morphWeights.robustness * 0.16;

  // ── Geometries (memoized) ──────────────────────────────────────────────────
  const bodyGeo = useMemo(() => withTangents(
    new THREE.CapsuleGeometry(0.23 * bodyScaleX, 0.30, 10, 20)
  ), [bodyScaleX]);

  const headGeo = useMemo(() => withTangents(
    (() => {
      const g = new THREE.SphereGeometry(0.27 * headScale, 24, 20);
      g.scale(1, 0.96, 0.93);
      return g;
    })()
  ), [headScale]);

  const snoutGeo = useMemo(() => withTangents(
    (() => {
      const g = new THREE.SphereGeometry(0.115, 16, 14);
      g.scale(0.82, 0.68, 1.10);
      return g;
    })()
  ), []);

  const earGeo = useMemo(() => {
    // radialSegments=3 → triangular cross-section for sharp ears
    const g = new THREE.ConeGeometry(0.092, 0.195, 3, 1);
    return g;
  }, []);

  const neckGeo = useMemo(() =>
    new THREE.CylinderGeometry(0.135, 0.160, 0.20, 12),
  []);

  const legGeo = useMemo(() =>
    new THREE.CapsuleGeometry(0.052, 0.120, 6, 10),
  []);

  const pawGeo = useMemo(() => withTangents(
    (() => {
      const g = new THREE.SphereGeometry(0.080, 14, 12);
      g.scale(1.15, 0.55, 1.30);
      return g;
    })()
  ), []);

  const tailGeo = useMemo(() => {
    const pts = [
      new THREE.Vector3(0.00,  0.00,  0.00),
      new THREE.Vector3(0.18, -0.08,  0.02),
      new THREE.Vector3(0.34, -0.18,  0.06),
      new THREE.Vector3(0.42, -0.26,  0.16),
      new THREE.Vector3(0.44, -0.32,  0.28),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = withTangents(new THREE.TubeGeometry(curve, 22, 0.052, 8, false));
    return g;
  }, []);

  // ── Refs for per-part animation ────────────────────────────────────────────
  const bodyGroupRef = useRef<THREE.Group>(null);
  const tailRootRef  = useRef<THREE.Group>(null);
  const tailMidRef   = useRef<THREE.Group>(null);
  const earLRef      = useRef<THREE.Mesh>(null);
  const earRRef      = useRef<THREE.Mesh>(null);
  const eyeLRef      = useRef<THREE.Group>(null);
  const eyeRRef      = useRef<THREE.Group>(null);
  const pawLRef      = useRef<THREE.Group>(null);
  const pawRRef      = useRef<THREE.Group>(null);

  const timeRef = useRef(0);

  // ── Animation frame ────────────────────────────────────────────────────────
  useFrame(({ clock }) => {
    timeRef.current = clock.getElapsedTime();
    const a = animTargets.current;

    if (bodyGroupRef.current) {
      bodyGroupRef.current.position.y = a.breathY;
      bodyGroupRef.current.rotation.z = a.bodyRoll;
    }
    if (tailRootRef.current) tailRootRef.current.rotation.z = a.tailBaseAngle;
    if (tailMidRef.current)  tailMidRef.current.rotation.z  = a.tailTipAngle;
    if (earLRef.current)     earLRef.current.rotation.x     = a.earLAngle;
    if (earRRef.current)     earRRef.current.rotation.x     = a.earRAngle;

    // Eye blink — squish scale.y to simulate eyelid close
    const openY = Math.max(0.05, a.eyeOpenness);
    if (eyeLRef.current) eyeLRef.current.scale.y = openY;
    if (eyeRRef.current) eyeRRef.current.scale.y = openY;

    if (pawLRef.current) {
      pawLRef.current.position.y = -0.44 + a.pawLiftL * 0.12;
      pawLRef.current.position.z =  0.18 + a.pawLiftL * 0.07;
    }
    if (pawRRef.current) {
      pawRRef.current.position.y = -0.44 + a.pawLiftR * 0.12;
      pawRRef.current.position.z =  0.18 + a.pawLiftR * 0.07;
    }
  });

  // ── Ear rotation: folded vs pointed vs tufted ──────────────────────────────
  const earBaseRotX = sil.ear === 'folded' ? 0.55 : -0.10;
  const earRotLBase = new THREE.Euler(earBaseRotX, 0.10,  0.18);
  const earRotRBase = new THREE.Euler(earBaseRotX, -0.10, -0.18);

  // Fatigue → color shift (subtle)
  const fatigue = morphWeights.fatigue;

  return (
    <group ref={bodyGroupRef}>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <group position={[0, 0, 0]}>
        <SSSMesh geometry={bodyGeo} color={pal.body} />
        <FurShells
          geometry={bodyGeo}
          shellCount={bodyShells}
          baseColor={baseColor}
          tipColor={tipColor}
          furLength={furLength}
          stripeScale={stripeScale}
          patternType={patternType}
          timeRef={timeRef}
          fatigue={fatigue}
        />
      </group>

      {/* ── Neck ──────────────────────────────────────────────────────────── */}
      <mesh geometry={neckGeo} position={[0, 0.34, 0.03]}>
        <meshStandardMaterial color={pal.body} roughness={0.82} />
      </mesh>

      {/* ── Head group — IK attaches here ─────────────────────────────────── */}
      <group ref={headRef as React.RefObject<THREE.Group>} position={[0, 0.57, 0.05]}>

        {/* Head mesh */}
        <SSSMesh geometry={headGeo} color={pal.body} />
        <FurShells
          geometry={headGeo}
          shellCount={14}
          baseColor={baseColor}
          tipColor={tipColor}
          furLength={furLength * 0.85}
          stripeScale={0}
          patternType={0}
          timeRef={timeRef}
          fatigue={fatigue}
        />

        {/* Snout */}
        <mesh geometry={snoutGeo} position={[0, -0.068, 0.205]}>
          <meshStandardMaterial color={pal.belly} roughness={0.7} />
        </mesh>

        {/* Nose */}
        <mesh position={[0, -0.102, 0.268]}>
          <sphereGeometry args={[0.025, 10, 10]} />
          <meshStandardMaterial color={pal.nose} roughness={0.5} />
        </mesh>

        {/* Left ear */}
        <mesh
          ref={earLRef}
          geometry={earGeo}
          position={[0.138, 0.222, -0.010]}
          rotation={earRotLBase}
        >
          <meshStandardMaterial color={pal.body} roughness={0.80} />
        </mesh>

        {/* Right ear */}
        <mesh
          ref={earRRef}
          geometry={earGeo}
          position={[-0.138, 0.222, -0.010]}
          rotation={earRotRBase}
        >
          <meshStandardMaterial color={pal.body} roughness={0.80} />
        </mesh>

        {/* Eye group — eyesRef for IK additional rotation */}
        <group ref={eyesRef as React.RefObject<THREE.Group>}>

          {/* Left eye — scale.y driven by eyeLRef in useFrame */}
          <group ref={eyeLRef} position={[0.106, 0.040, 0.214]}>
            <Eye eyeColor={pal.eyes} flip={false} />
          </group>

          {/* Right eye */}
          <group ref={eyeRRef} position={[-0.106, 0.040, 0.214]}>
            <Eye eyeColor={pal.eyes} flip={true} />
          </group>

        </group>
      </group>

      {/* ── Front legs ────────────────────────────────────────────────────── */}
      <mesh geometry={legGeo} position={[0.148, -0.285, 0.110]} rotation={[0.18, 0, 0.06]}>
        <meshStandardMaterial color={pal.body} roughness={0.82} />
      </mesh>
      <mesh geometry={legGeo} position={[-0.148, -0.285, 0.110]} rotation={[0.18, 0, -0.06]}>
        <meshStandardMaterial color={pal.body} roughness={0.82} />
      </mesh>

      {/* ── Paws ──────────────────────────────────────────────────────────── */}
      <group ref={pawLRef} position={[0.148, -0.440, 0.180]}>
        <SSSMesh geometry={pawGeo} color={pal.belly} />
      </group>
      <group ref={pawRRef} position={[-0.148, -0.440, 0.180]}>
        <SSSMesh geometry={pawGeo} color={pal.belly} />
      </group>

      {/* ── Tail ──────────────────────────────────────────────────────────── */}
      <group ref={tailRootRef} position={[0, -0.20, -0.240]}>
        <group ref={tailMidRef} position={[0.18, -0.06, 0]}>
          <SSSMesh geometry={tailGeo} color={pal.accent} />
          <FurShells
            geometry={tailGeo}
            shellCount={12}
            baseColor={tipColor}
            tipColor={baseColor}
            furLength={furLength}
            stripeScale={0}
            patternType={0}
            timeRef={timeRef}
            fatigue={fatigue}
          />
        </group>
      </group>

    </group>
  );
}
