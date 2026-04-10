/**
 * ProceduralCat — multi-part procedural cat anatomy built entirely from
 * Three.js primitives.  No external 3D assets required.
 *
 * Anatomy overview (world-space, sitting pose, cat faces +Z):
 *
 *        EarL  EarR          ← ConeGeometry (triangular), big & prominent
 *       /  Head  \           ← SphereGeometry, large
 *      |  Eyes+Snout |       ← layered spheres + whisker lines
 *       \  Neck  /
 *       [  Body  ]           ← SphereGeometry, wide oval
 *       /  Legs  \
 *      PawL     PawR
 *          Tail →            ← TubeGeometry, wraps right side
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

/** Add circumferential aTangent attribute required by Kajiya-Kay fur shader. */
function withTangents(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos  = geo.attributes['position'];
  const norm = geo.attributes['normal'];
  if (!pos || !norm) return geo;

  const count    = pos.count;
  const tangents = new Float32Array(count * 3);
  const up = new THREE.Vector3(0, 1, 0);
  const n  = new THREE.Vector3();
  const t  = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    n.fromBufferAttribute(norm, i).normalize();
    t.crossVectors(up, n).normalize();
    if (t.lengthSq() < 0.01) t.set(1, 0, 0);
    t.toArray(tangents, i * 3);
  }
  geo.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
  return geo;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

const PATTERN_TYPE: Record<string, number> = {
  solid: 0, stripes: 1, spots: 0, colorpoint: 0, tuxedo: 0, patches: 0,
};

// ─── SSS mesh — uses vec3 colour uniform, no texture ─────────────────────────

function SSSMesh({
  geometry,
  color,
  subsurfaceColor,
}: {
  geometry:        THREE.BufferGeometry;
  color:           string;
  subsurfaceColor?: string;
}) {
  const albedo = useMemo(() => hexToRgb(color), [color]);
  const sssCol = useMemo(
    () => subsurfaceColor ? hexToRgb(subsurfaceColor) : ([0.95, 0.55, 0.50] as [number, number, number]),
    [subsurfaceColor],
  );

  const uniforms = useMemo(() => ({
    ...defaultSSSUniforms(),
    uAlbedoColor:     { value: albedo },
    uSubsurfaceColor: { value: sssCol },
    uWrapFactor:      { value: 0.55 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Update camera position each frame (no re-render cost)
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

// ─── Fur shell renderer ───────────────────────────────────────────────────────

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
  geometry, shellCount, baseColor, tipColor,
  furLength, stripeScale, patternType, timeRef, fatigue,
}: FurShellsProps) {
  return (
    <>
      {Array.from({ length: shellCount }, (_, i) => {
        const u: Record<string, { value: unknown }> = {
          ...defaultFurUniforms(),
          uShellIndex:  { value: i },
          uShellCount:  { value: shellCount },
          uFatigue:     { value: fatigue },
          uTime:        { value: timeRef.current },
          uBaseColor:   { value: baseColor },
          uTipColor:    { value: tipColor },
          uFurLength:   { value: furLength },
          uStripeScale: { value: stripeScale },
          uPatternType: { value: patternType },
        };
        return (
          <mesh key={i} geometry={geometry}>
            <shaderMaterial
              vertexShader={furVertexShader}
              fragmentShader={furFragmentShader}
              uniforms={u}
              side={THREE.FrontSide}
              transparent={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

// ─── Eye assembly ─────────────────────────────────────────────────────────────

function Eye({ eyeColor, flip }: { eyeColor: string; flip: boolean }) {
  return (
    <>
      {/* Sclera */}
      <mesh>
        <sphereGeometry args={[0.078, 20, 20]} />
        <meshStandardMaterial color="white" roughness={0.04} />
      </mesh>
      {/* Iris */}
      <mesh position={[0, 0, 0.072]}>
        <circleGeometry args={[0.060, 28]} />
        <meshStandardMaterial color={eyeColor} roughness={0.04} metalness={0.2} />
      </mesh>
      {/* Pupil — vertical slit */}
      <mesh position={[0, 0, 0.074]}>
        <planeGeometry args={[0.022, 0.058]} />
        <meshStandardMaterial color="#050505" roughness={0} />
      </mesh>
      {/* Catchlight */}
      <mesh position={[flip ? -0.026 : 0.026, 0.024, 0.068]}>
        <sphereGeometry args={[0.014, 8, 8]} />
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={1.0} roughness={0} />
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

  const baseColor   = useMemo(() => hexToRgb(pal.body),   [pal.body]);
  const tipColor    = useMemo(() => hexToRgb(pal.accent),  [pal.accent]);
  const furLength   = sil.fur === 'long' ? 0.16 : sil.fur === 'medium' ? 0.11 : 0.08;
  const bodyShells  = sil.fur === 'long' ? 22 : 18;
  const stripeScale = sil.pattern === 'stripes' ? 3.0 : 0;
  const patternType = PATTERN_TYPE[sil.pattern] ?? 0;

  // Morph-driven tweaks
  const headScale  = 1 + morphWeights.intelligence * 0.12;
  const bodyScaleX = 1 + morphWeights.robustness  * 0.14;
  const fatigue    = morphWeights.fatigue;

  // ── Geometries ─────────────────────────────────────────────────────────────
  // Body: wide oval — NOT a tall capsule. Sitting cat is wider than tall.
  const bodyGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.28, 28, 22);
    g.scale(bodyScaleX * 1.55, 1.25, 1.40);   // wide × 0.87 tall × 0.98 deep
    return withTangents(g);
  }, [bodyScaleX]);

  // Head: slightly flattened sphere, noticeably large (cats have big heads)
  const headGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.27 * headScale, 26, 22);
    g.scale(1.0, 0.96, 0.94);
    return withTangents(g);
  }, [headScale]);

  // Snout/muzzle: small egg protruding from lower face
  const snoutGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.12, 18, 14);
    g.scale(0.80, 0.65, 1.10);
    return withTangents(g);
  }, []);

  // Ears: triangular cones — radialSegments=3 gives sharp pointed ears
  const earOuterGeo = useMemo(
    () => new THREE.ConeGeometry(0.125, 0.285, 3, 1),
    [],
  );
  // Inner ear: slightly smaller, same shape, warm pink
  const earInnerGeo = useMemo(
    () => {
      const g = new THREE.ConeGeometry(0.072, 0.210, 3, 1);
      g.translate(0, 0.014, 0.010);   // offset slightly inward/forward
      return g;
    },
    [],
  );

  // Neck: short tapered cylinder
  const neckGeo = useMemo(
    () => new THREE.CylinderGeometry(0.130, 0.160, 0.160, 12),
    [],
  );

  // Front legs: short capsules
  const legGeo = useMemo(
    () => new THREE.CapsuleGeometry(0.052, 0.090, 6, 10),
    [],
  );

  // Paws: flat oval, SSS skin
  const pawGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.082, 16, 12);
    g.scale(1.18, 0.52, 1.32);
    return withTangents(g);
  }, []);

  // Tail: organic curve wrapping from behind-left to front-right
  const tailGeo = useMemo(() => {
    const pts = [
      new THREE.Vector3( 0.00,  0.00,  0.00),
      new THREE.Vector3( 0.20, -0.06,  0.04),
      new THREE.Vector3( 0.38, -0.14,  0.10),
      new THREE.Vector3( 0.46, -0.24,  0.20),
      new THREE.Vector3( 0.46, -0.30,  0.30),
    ];
    return withTangents(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.050, 8, false),
    );
  }, []);

  // Whiskers: 3 per side — stored as line point pairs
  const whiskerData = useMemo(() => [
    // [start, end] — all relative to head group
    // Left side
    { s: [-0.09, -0.062, 0.230] as [number,number,number], e: [-0.44, -0.040, 0.270] as [number,number,number] },
    { s: [-0.09, -0.082, 0.230] as [number,number,number], e: [-0.43, -0.082, 0.270] as [number,number,number] },
    { s: [-0.09, -0.102, 0.230] as [number,number,number], e: [-0.41, -0.120, 0.270] as [number,number,number] },
    // Right side
    { s: [ 0.09, -0.062, 0.230] as [number,number,number], e: [ 0.44, -0.040, 0.270] as [number,number,number] },
    { s: [ 0.09, -0.082, 0.230] as [number,number,number], e: [ 0.43, -0.082, 0.270] as [number,number,number] },
    { s: [ 0.09, -0.102, 0.230] as [number,number,number], e: [ 0.41, -0.120, 0.270] as [number,number,number] },
  ], []);

  const whiskerObjects = useMemo(() =>
    whiskerData.map(({ s, e }) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s[0], s[1], s[2]),
        new THREE.Vector3(e[0], e[1], e[2]),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: '#cccccc', transparent: true, opacity: 0.75,
      });
      return new THREE.Line(geo, mat);
    }),
  [whiskerData]);

  // ── Animation refs ─────────────────────────────────────────────────────────
  const bodyGroupRef = useRef<THREE.Group>(null);
  const tailRootRef  = useRef<THREE.Group>(null);
  const tailMidRef   = useRef<THREE.Group>(null);
  const earLRef      = useRef<THREE.Group>(null);
  const earRRef      = useRef<THREE.Group>(null);
  const eyeLRef      = useRef<THREE.Group>(null);
  const eyeRRef      = useRef<THREE.Group>(null);
  const pawLRef      = useRef<THREE.Group>(null);
  const pawRRef      = useRef<THREE.Group>(null);

  const timeRef = useRef(0);

  useFrame(({ clock }) => {
    timeRef.current = clock.getElapsedTime();
    const a = animTargets.current;

    if (bodyGroupRef.current) {
      bodyGroupRef.current.position.y = a.breathY;
      bodyGroupRef.current.rotation.z = a.bodyRoll;
    }
    if (tailRootRef.current) tailRootRef.current.rotation.z = a.tailBaseAngle;
    if (tailMidRef.current)  tailMidRef.current.rotation.z  = a.tailTipAngle;

    if (earLRef.current) earLRef.current.rotation.x = a.earLAngle;
    if (earRRef.current) earRRef.current.rotation.x = a.earRAngle;

    // Blink — scale.y drives eyelid squish
    const openY = Math.max(0.06, a.eyeOpenness);
    if (eyeLRef.current) eyeLRef.current.scale.y = openY;
    if (eyeRRef.current) eyeRRef.current.scale.y = openY;

    if (pawLRef.current) {
      pawLRef.current.position.y = -0.46 + a.pawLiftL * 0.13;
      pawLRef.current.position.z =  0.20 + a.pawLiftL * 0.08;
    }
    if (pawRRef.current) {
      pawRRef.current.position.y = -0.46 + a.pawLiftR * 0.13;
      pawRRef.current.position.z =  0.20 + a.pawLiftR * 0.08;
    }
  });

  // ── Ear base rotation (ear type) ──────────────────────────────────────────
  const earBaseRotX = sil.ear === 'folded' ? 0.50 : -0.08;
  const earRotL = new THREE.Euler(earBaseRotX,  0.08,  0.14);
  const earRotR = new THREE.Euler(earBaseRotX, -0.08, -0.14);

  // Inner ear colour: blend nose colour toward pink
  const innerEarColor = useMemo(() => {
    const base  = new THREE.Color(pal.nose);
    const pink  = new THREE.Color('#ffb4a8');
    return '#' + base.lerp(pink, 0.6).getHexString();
  }, [pal.nose]);

  // ── Body dimensions for positioning ───────────────────────────────────────
  // Body SphereGeometry(0.28) × scale(1.55, 1.25, 1.40) → halfH = 0.28*1.25 = 0.35
  const bodyHalfH = 0.28 * 1.25;   // 0.350
  // Head SphereGeometry(0.27) × scale(1, 0.96, 0.94) → radius ≈ 0.27
  const headR      = 0.27 * headScale;
  // Head centre sits just above body top with a small neck overlap
  const headCentreY = bodyHalfH + headR * 0.55;   // ≈ 0.350 + 0.149 = 0.499 → ~0.50

  return (
    <group ref={bodyGroupRef}>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <SSSMesh geometry={bodyGeo} color={pal.body} subsurfaceColor={pal.nose} />
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

      {/* ── Neck ──────────────────────────────────────────────────────────── */}
      <mesh geometry={neckGeo} position={[0, bodyHalfH + 0.010, 0.030]}>
        <meshStandardMaterial color={pal.body} roughness={0.80} />
      </mesh>

      {/* ── Head group — IK ref attaches here ─────────────────────────────── */}
      <group
        ref={headRef as React.RefObject<THREE.Group>}
        position={[0, headCentreY, 0.042]}
      >
        {/* Head fur + SSS */}
        <SSSMesh geometry={headGeo} color={pal.body} subsurfaceColor={pal.nose} />
        <FurShells
          geometry={headGeo}
          shellCount={14}
          baseColor={baseColor}
          tipColor={tipColor}
          furLength={furLength * 0.80}
          stripeScale={0}
          patternType={0}
          timeRef={timeRef}
          fatigue={fatigue}
        />

        {/* ── Ears ──────────────────────────────────────────────────────── */}
        {/* Left ear */}
        <group
          ref={earLRef}
          position={[0.155, 0.230, 0.014]}
          rotation={earRotL}
        >
          <mesh geometry={earOuterGeo}>
            <meshStandardMaterial color={pal.body} roughness={0.78} />
          </mesh>
          <mesh geometry={earInnerGeo}>
            <meshStandardMaterial color={innerEarColor} roughness={0.70} side={THREE.FrontSide} />
          </mesh>
        </group>

        {/* Right ear */}
        <group
          ref={earRRef}
          position={[-0.155, 0.230, 0.014]}
          rotation={earRotR}
        >
          <mesh geometry={earOuterGeo}>
            <meshStandardMaterial color={pal.body} roughness={0.78} />
          </mesh>
          <mesh geometry={earInnerGeo}>
            <meshStandardMaterial color={innerEarColor} roughness={0.70} side={THREE.FrontSide} />
          </mesh>
        </group>

        {/* ── Snout ─────────────────────────────────────────────────────── */}
        <mesh geometry={snoutGeo} position={[0, -0.062, 0.212]}>
          <meshStandardMaterial color={pal.belly} roughness={0.68} />
        </mesh>

        {/* Nose */}
        <mesh position={[0, -0.098, 0.270]}>
          <sphereGeometry args={[0.024, 10, 10]} />
          <meshStandardMaterial color={pal.nose} roughness={0.50} />
        </mesh>

        {/* ── Eye group (eyesRef for IK amplification) ──────────────────── */}
        <group ref={eyesRef as React.RefObject<THREE.Group>}>

          {/* Left eye */}
          <group ref={eyeLRef} position={[0.108, 0.036, 0.220]}>
            <Eye eyeColor={pal.eyes} flip={false} />
          </group>

          {/* Right eye */}
          <group ref={eyeRRef} position={[-0.108, 0.036, 0.220]}>
            <Eye eyeColor={pal.eyes} flip={true} />
          </group>
        </group>

        {/* ── Whiskers ──────────────────────────────────────────────────── */}
        {whiskerObjects.map((line, i) => (
          <primitive key={i} object={line} />
        ))}

      </group>

      {/* ── Front legs ────────────────────────────────────────────────────── */}
      <mesh geometry={legGeo} position={[ 0.150, -bodyHalfH + 0.030, 0.130]} rotation={[0.16, 0, 0.06]}>
        <meshStandardMaterial color={pal.body} roughness={0.80} />
      </mesh>
      <mesh geometry={legGeo} position={[-0.150, -bodyHalfH + 0.030, 0.130]} rotation={[0.16, 0, -0.06]}>
        <meshStandardMaterial color={pal.body} roughness={0.80} />
      </mesh>

      {/* ── Paws (SSS — exposed skin) ──────────────────────────────────────── */}
      <group ref={pawLRef} position={[ 0.150, -0.460, 0.200]}>
        <SSSMesh geometry={pawGeo} color={pal.belly} subsurfaceColor={pal.nose} />
      </group>
      <group ref={pawRRef} position={[-0.150, -0.460, 0.200]}>
        <SSSMesh geometry={pawGeo} color={pal.belly} subsurfaceColor={pal.nose} />
      </group>

      {/* ── Tail ──────────────────────────────────────────────────────────── */}
      <group ref={tailRootRef} position={[0, -0.200, -0.250]}>
        <group ref={tailMidRef} position={[0.15, -0.04, 0]}>
          <SSSMesh geometry={tailGeo} color={pal.accent} subsurfaceColor={pal.nose} />
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
