import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, DepthOfField, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

import { CatMesh } from './CatMesh';
import type { DeveloperProfile } from '@/types/session';
import type { CompanionState } from '@/state/companionMachine';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompanionSceneProps {
  profile:  DeveloperProfile | null;
  cursorX:  number;
  cursorY:  number;
  state:    CompanionState;
}

// ─── Cinematic camera rig ─────────────────────────────────────────────────────

function CameraRig({ state }: { state: CompanionState }) {
  const { camera } = useThree();
  const target     = useRef(new THREE.Vector3(0, 0, 4.5));

  // Dolly camera based on companion state
  const stateZMap: Record<CompanionState, number> = {
    active:    4.5,
    idle:      5.2,
    focus:     4.0,
    fatigue:   5.5,
    neglected: 6.0,
  };

  useFrame(() => {
    const targetZ = stateZMap[state];
    target.current.z += (targetZ - target.current.z) * 0.03;
    camera.position.z  += (target.current.z - camera.position.z) * 0.05;
    camera.lookAt(0, 0.1, 0);
  });

  return null;
}

// ─── Floor plane (receives contact shadow) ────────────────────────────────────

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.72, 0]} receiveShadow>
      <planeGeometry args={[10, 10]} />
      <shadowMaterial opacity={0.18} />
    </mesh>
  );
}

// ─── Scene (inside Canvas) ───────────────────────────────────────────────────

function Scene({ profile, cursorX, cursorY, state }: CompanionSceneProps) {
  return (
    <>
      {/* Camera */}
      <PerspectiveCamera makeDefault fov={45} near={0.1} far={50} position={[0, 0.1, 4.5]} />
      <CameraRig state={state} />

      {/* HDRI lighting */}
      <Environment preset="apartment" background={false} />

      {/* Subtle directional fill */}
      <directionalLight
        position={[3, 5, 3]}
        intensity={0.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <ambientLight intensity={0.15} />

      {/* Cat */}
      <Suspense fallback={null}>
        <CatMesh
          profile={profile}
          cursorX={cursorX}
          cursorY={cursorY}
          state={state}
          geometry={null}   // glTF geometry loaded externally when available
        />
      </Suspense>

      <Floor />

      {/* Orbit controls (disabled in production — for dev camera adjustment) */}
      {import.meta.env.DEV && (
        <OrbitControls
          enablePan={false}
          minDistance={2}
          maxDistance={10}
          maxPolarAngle={Math.PI / 1.8}
        />
      )}

      {/* Post-processing */}
      <EffectComposer>
        <DepthOfField
          focusDistance={0.01}
          focalLength={0.04}
          bokehScale={3}
          height={480}
        />
        <Bloom
          luminanceThreshold={0.7}
          luminanceSmoothing={0.9}
          intensity={0.4}
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

export function CompanionScene({ profile, cursorX, cursorY, state }: CompanionSceneProps) {
  return (
    <Canvas
      shadows
      gl={{
        antialias:     true,
        toneMapping:   THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
    >
      <Scene
        profile={profile}
        cursorX={cursorX}
        cursorY={cursorY}
        state={state}
      />
    </Canvas>
  );
}
