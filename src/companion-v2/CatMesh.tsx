import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Detailed } from '@react-three/drei';
import * as THREE from 'three';

import { furVertexShader, furFragmentShader, defaultFurUniforms } from './shaders/fur';
import { sssVertexShader, sssFragmentShader, defaultSSSUniforms } from './shaders/sss';
import { useIK } from './useIK';
import { useMorphInfluences, morphToScale } from './useXPMorphs';
import { LOD_DISTANCES, FUR_SHELLS_PER_LOD } from './useLOD';
import { COMPANION_ACCESSORIES } from '@/lib/companion-accessories';
import type { DeveloperProfile } from '@/types/session';
import type { CompanionState } from '@/state/companionMachine';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CatMeshProps {
  profile:              DeveloperProfile | null;
  cursorX:              number;
  cursorY:              number;
  state:                CompanionState;
  geometry:             THREE.BufferGeometry | null;   // pre-loaded high-poly geometry
  equippedAccessories?: string[];
}

// ─── Procedural cat geometry (placeholder) ───────────────────────────────────
// When a real glTF cat model is not yet loaded, we render a stylised
// procedural stand-in so the scene is never empty.

function buildPlaceholderGeometry(): THREE.BufferGeometry {
  // Body sphere
  const geo = new THREE.SphereGeometry(0.5, 32, 24);

  // Add a flat tangent attribute (all pointing in +X) for the fur shader.
  // A proper glTF mesh will have real tangents from Blender.
  const count    = geo.attributes['position']!.count;
  const tangents = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    tangents[i * 3]     = 1;
    tangents[i * 3 + 1] = 0;
    tangents[i * 3 + 2] = 0;
  }
  geo.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));

  return geo;
}

// ─── Shell pass ───────────────────────────────────────────────────────────────

function FurShells({
  geometry,
  fatigue,
  shellCount,
  time,
  camPos,
}: {
  geometry: THREE.BufferGeometry;
  fatigue:  number;
  shellCount: number;
  time:     number;
  camPos:   THREE.Vector3;
}) {
  return (
    <>
      {Array.from({ length: shellCount }, (_, i) => {
        const uniforms: Record<string, { value: unknown }> = {
          ...defaultFurUniforms(),
          uShellIndex:  { value: i },
          uShellCount:  { value: shellCount },
          uFatigue:     { value: fatigue },
          uTime:        { value: time },
          uCamPos:      { value: [camPos.x, camPos.y, camPos.z] },
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

// ─── Base body mesh (SSS) ─────────────────────────────────────────────────────

function BodyMesh({
  geometry,
  camPos,
  lightDir,
}: {
  geometry: THREE.BufferGeometry;
  camPos:   THREE.Vector3;
  lightDir: THREE.Vector3;
}) {
  const uniforms = useMemo(
    () => ({
      ...defaultSSSUniforms(),
      uCamPos:   { value: [camPos.x, camPos.y, camPos.z] },
      uLightDir: { value: [lightDir.x, lightDir.y, lightDir.z] },
    }),
    // uniforms are mutated each frame — only create once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Update per-frame values by mutating (no re-render cost)
  useFrame(({ camera }) => {
    (uniforms['uCamPos'] as { value: number[] }).value = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
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

// ─── Accessory overlays ───────────────────────────────────────────────────────
// Procedural 3D primitives placed on the appropriate bone position.
// Intentionally simple (game-like) — no 3D art assets needed.

function AccessoryOverlays({ accessories }: { accessories: string[] }) {
  return (
    <>
      {accessories.map((key) => {
        const acc = COMPANION_ACCESSORIES[key as keyof typeof COMPANION_ACCESSORIES];
        if (!acc) return null;

        const color = new THREE.Color(acc.color);

        switch (acc.slot) {
          case 'head':
            // Hat / crown — box on head group, y+0.35 from body centre
            return (
              <mesh key={key} position={[0, 0.35, 0.15]}>
                <boxGeometry args={[0.25, 0.14, 0.25]} />
                <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
              </mesh>
            );

          case 'neck':
            // Collar — torus ring around neck
            return (
              <mesh key={key} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.18, 0.03, 8, 24]} />
                <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} />
              </mesh>
            );

          case 'back':
          case 'shoulder': {
            // Wings / mantle — two angled planes behind body
            return (
              <group key={key} position={[0, 0.08, -0.18]}>
                <mesh position={[-0.26, 0, 0]} rotation={[0.1, -0.5, 0.3]}>
                  <planeGeometry args={[0.38, 0.28]} />
                  <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.85} />
                </mesh>
                <mesh position={[0.26, 0, 0]} rotation={[0.1, 0.5, -0.3]}>
                  <planeGeometry args={[0.38, 0.28]} />
                  <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.85} />
                </mesh>
              </group>
            );
          }

          default:
            return null;
        }
      })}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CatMesh({ profile, cursorX, cursorY, state, geometry, equippedAccessories = [] }: CatMeshProps) {
  const groupRef  = useRef<THREE.Group>(null);
  const meshRef   = useRef<THREE.Mesh>(null);
  const timeRef   = useRef(0);
  const camPos    = useRef(new THREE.Vector3());
  const lightDir  = useMemo(() => new THREE.Vector3(0.4, 0.8, 0.5).normalize(), []);

  const morphInfluences = useMorphInfluences(profile);
  const scale           = profile ? morphToScale(profile.morph_weights) : 0.8;

  const { headRef } = useIK(cursorX, cursorY, state !== 'fatigue' && state !== 'neglected' && state !== 'concerned');

  // Resolved geometry — prefer loaded glTF, fall back to placeholder
  const resolvedGeo = useMemo(
    () => geometry ?? buildPlaceholderGeometry(),
    [geometry],
  );

  // Apply morph target influences to the mesh
  useEffect(() => {
    if (!meshRef.current?.morphTargetInfluences) return;
    morphInfluences.forEach((v, i) => {
      if (meshRef.current!.morphTargetInfluences) {
        meshRef.current!.morphTargetInfluences[i] = v;
      }
    });
  }, [morphInfluences]);

  // Idle breathing + state-driven animations
  useFrame(({ clock, camera }) => {
    timeRef.current = clock.getElapsedTime();
    camPos.current.copy(camera.position);

    if (!groupRef.current) return;

    const t = timeRef.current;

    switch (state) {
      case 'idle':
      case 'neglected': {
        // Slow breath with slight droop
        groupRef.current.position.y = Math.sin(t * 0.4) * 0.01 - 0.02;
        groupRef.current.rotation.z = Math.sin(t * 0.3) * 0.02 - 0.03;
        break;
      }
      case 'concerned': {
        // Slow, laboured breathing — head droops
        groupRef.current.position.y = Math.sin(t * 0.5) * 0.012 - 0.03;
        groupRef.current.rotation.z = Math.sin(t * 0.35) * 0.025 - 0.04;
        break;
      }
      case 'fatigue': {
        // Heavy breathing, drooping head
        groupRef.current.position.y = Math.sin(t * 0.8) * 0.015 - 0.05;
        groupRef.current.rotation.z = Math.sin(t * 0.5) * 0.04 - 0.06;
        break;
      }
      case 'focus': {
        // Perfectly still with very subtle micro-tremor
        groupRef.current.position.y = Math.sin(t * 1.2) * 0.003;
        groupRef.current.rotation.z = Math.sin(t * 0.9) * 0.005;
        break;
      }
      default: {
        // Active — alert breathing
        groupRef.current.position.y = Math.sin(t * 0.9) * 0.012;
        groupRef.current.rotation.z = Math.sin(t * 0.6) * 0.01;
      }
    }
  });

  const shellCount = FUR_SHELLS_PER_LOD['high'];

  return (
    <group ref={groupRef} scale={[scale, scale, scale]}>
      {/* Accessory overlays (rendered at group level — scale applies) */}
      <AccessoryOverlays accessories={equippedAccessories} />

      {/* Head bone — IK applies rotation here */}
      <group ref={headRef as React.RefObject<THREE.Group>} position={[0, 0.35, 0]}>
        {/* Eyes would be a separate mesh in a real glTF — placeholder sphere */}
        <mesh position={[0.12, 0.05, 0.38]} scale={0.06}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[-0.12, 0.05, 0.38]} scale={0.06}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      </group>

      {/* Body — SSS base pass first, then fur shells on top */}
      <Detailed distances={LOD_DISTANCES}>
        {/* High — full fur shells */}
        <group>
          <BodyMesh geometry={resolvedGeo} camPos={camPos.current} lightDir={lightDir} />
          <FurShells
            geometry={resolvedGeo}
            fatigue={profile?.morph_weights.fatigue ?? 0}
            shellCount={shellCount}
            time={timeRef.current}
            camPos={camPos.current}
          />
        </group>

        {/* Medium — 16 shells */}
        <group>
          <BodyMesh geometry={resolvedGeo} camPos={camPos.current} lightDir={lightDir} />
          <FurShells
            geometry={resolvedGeo}
            fatigue={profile?.morph_weights.fatigue ?? 0}
            shellCount={16}
            time={timeRef.current}
            camPos={camPos.current}
          />
        </group>

        {/* Low — body only, no fur */}
        <BodyMesh geometry={resolvedGeo} camPos={camPos.current} lightDir={lightDir} />
      </Detailed>
    </group>
  );
}
