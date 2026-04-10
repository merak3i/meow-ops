import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, DepthOfField, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

import { CatMesh }          from './CatMesh';
import { ActionParticles }  from './ActionParticles';
import type { DeveloperProfile } from '@/types/session';
import type { CompanionState }   from '@/state/companionMachine';
import type { MemoryMark }       from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompanionSceneProps {
  profile:              DeveloperProfile | null;
  cursorX:              number;
  cursorY:              number;
  state:                CompanionState;
  breed?:               string;
  roomTier?:            number;
  actionEffect?:        string | null;
  equippedAccessories?: string[];
  memoryMarks?:         MemoryMark[];
  onPetSignal?:         React.MutableRefObject<boolean>;
}

// ─── Room tier → drei HDRI preset ────────────────────────────────────────────

type DreiPreset = 'sunset' | 'apartment' | 'forest' | 'night' | 'warehouse' | 'city';

function roomPreset(tier: number): DreiPreset {
  if (tier <= 1) return 'sunset';
  if (tier === 2) return 'apartment';
  if (tier === 3) return 'forest';
  if (tier === 4) return 'night';
  if (tier === 5) return 'warehouse';
  return 'city';
}

// ─── Cinematic camera rig ─────────────────────────────────────────────────────

function CameraRig({ state }: { state: CompanionState }) {
  const { camera } = useThree();
  const target     = useRef(new THREE.Vector3(0, 0, 4.5));

  const stateZMap: Record<CompanionState, number> = {
    active:    4.5,
    idle:      5.2,
    focus:     4.0,
    fatigue:   5.5,
    neglected: 6.0,
    concerned: 5.0,
  };

  useFrame(() => {
    const targetZ = stateZMap[state] ?? 4.5;
    target.current.z += (targetZ - target.current.z) * 0.03;
    camera.position.z  += (target.current.z - camera.position.z) * 0.05;
    camera.lookAt(0, 0.1, 0);
  });

  return null;
}

// ─── Floor ────────────────────────────────────────────────────────────────────

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.72, 0]} receiveShadow>
      <planeGeometry args={[10, 10]} />
      <shadowMaterial opacity={0.22} />
    </mesh>
  );
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({
  profile, cursorX, cursorY, state, breed, roomTier, actionEffect,
  equippedAccessories, memoryMarks, onPetSignal,
}: CompanionSceneProps) {
  const preset = roomPreset(roomTier ?? 0);

  return (
    <>
      <PerspectiveCamera makeDefault fov={45} near={0.1} far={50} position={[0, 0.1, 4.5]} />
      <CameraRig state={state} />

      {/* HDRI environment */}
      <Environment preset={preset} background={false} />

      {/* Warm key light — upper right front */}
      <directionalLight
        position={[2.5, 4.5, 3]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        color="#fff5e0"
      />

      {/* Cool rim light from behind — creates Stray-style silhouette separation */}
      <directionalLight
        position={[-1.5, 2.5, -3.5]}
        intensity={0.40}
        color="#a0c8ff"
      />

      {/* Warm fill from lower left */}
      <pointLight position={[-2, 0.8, 2]} intensity={0.28} color="#ffcc88" />

      {/* Cat */}
      <Suspense fallback={null}>
        <CatMesh
          profile={profile}
          cursorX={cursorX}
          cursorY={cursorY}
          state={state}
          breed={breed ?? 'tabby'}
          equippedAccessories={equippedAccessories ?? []}
          memoryMarks={memoryMarks ?? []}
          onPetSignal={onPetSignal}
        />
      </Suspense>

      <ActionParticles effect={actionEffect ?? null} />
      <Floor />

      {import.meta.env.DEV && (
        <OrbitControls
          enablePan={false}
          minDistance={2}
          maxDistance={10}
          maxPolarAngle={Math.PI / 1.8}
        />
      )}

      <EffectComposer>
        <DepthOfField
          focusDistance={0.01}
          focalLength={0.04}
          bokehScale={3}
          height={480}
        />
        <Bloom
          luminanceThreshold={0.65}
          luminanceSmoothing={0.9}
          intensity={0.5}
          blendFunction={BlendFunction.SCREEN}
        />
        <Vignette
          offset={0.4}
          darkness={0.55}
          blendFunction={BlendFunction.NORMAL}
        />
      </EffectComposer>
    </>
  );
}

// ─── Exported canvas wrapper ──────────────────────────────────────────────────

export function CompanionScene({
  profile, cursorX, cursorY, state, breed, roomTier, actionEffect,
  equippedAccessories, memoryMarks, onPetSignal,
}: CompanionSceneProps) {
  return (
    <Canvas
      shadows
      gl={{
        antialias:             true,
        toneMapping:           THREE.ACESFilmicToneMapping,
        toneMappingExposure:   1.15,
        outputColorSpace:      THREE.SRGBColorSpace,
        preserveDrawingBuffer: true,
      }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
    >
      <Scene
        profile={profile}
        cursorX={cursorX}
        cursorY={cursorY}
        state={state}
        breed={breed}
        roomTier={roomTier}
        actionEffect={actionEffect}
        equippedAccessories={equippedAccessories}
        memoryMarks={memoryMarks}
        onPetSignal={onPetSignal}
      />
    </Canvas>
  );
}
