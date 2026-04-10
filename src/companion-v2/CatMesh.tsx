import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { useIK }                    from './useIK';
import { useMorphInfluences, morphToScale } from './useXPMorphs';
import { useCatAnimation }          from './useCatAnimation';
import { ProceduralCat }            from './ProceduralCat';
import type { CatZone }             from './ProceduralCat';
import { COMPANION_ACCESSORIES }    from '@/lib/companion-accessories';
import type { DeveloperProfile }    from '@/types/session';
import type { CompanionState }      from '@/state/companionMachine';
import type { MemoryMark }          from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CatMeshProps {
  profile:              DeveloperProfile | null;
  cursorX:              number;
  cursorY:              number;
  state:                CompanionState;
  breed?:               string;
  equippedAccessories?: string[];
  memoryMarks?:         MemoryMark[];
  onPetSignal?:         React.MutableRefObject<boolean>;
  onZoneEnter?:         (zone: CatZone) => void;
  onZoneLeave?:         () => void;
  onZoneClick?:         (zone: CatZone) => void;
}

// ─── Accessory overlays ───────────────────────────────────────────────────────

function AccessoryOverlays({ accessories }: { accessories: string[] }) {
  return (
    <>
      {accessories.map((key) => {
        const acc = COMPANION_ACCESSORIES[key as keyof typeof COMPANION_ACCESSORIES];
        if (!acc) return null;
        const color = new THREE.Color(acc.color);

        switch (acc.slot) {
          case 'head':
            return (
              <mesh key={key} position={[0, 0.88, 0.12]}>
                <boxGeometry args={[0.26, 0.14, 0.26]} />
                <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
              </mesh>
            );
          case 'neck':
            return (
              <mesh key={key} position={[0, 0.36, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.175, 0.028, 8, 24]} />
                <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} />
              </mesh>
            );
          case 'back':
          case 'shoulder':
            return (
              <group key={key} position={[0, 0.10, -0.18]}>
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
          default:
            return null;
        }
      })}
    </>
  );
}

// ─── Memory markings ──────────────────────────────────────────────────────────

interface MarkConfig {
  position: [number, number, number];
  rotation: [number, number, number];
  size:     [number, number];
  color:    string;
}

const MARK_CONFIG: Record<string, MarkConfig> = {
  'scar':          { position: [-0.25, 0.15, 0.22],  rotation: [0, 0.3, 0.1],   size: [0.12, 0.06], color: '#888888' },
  'gold-stripe':   { position: [0,    -0.30, -0.20],  rotation: [0.3, 0, 0],     size: [0.08, 0.22], color: '#FFD700' },
  'star-mark':     { position: [0,     0.52, 0.20],   rotation: [0, 0, 0],       size: [0.10, 0.10], color: '#7C3AED' },
  'big-run-blaze': { position: [0,     0.08, 0.44],   rotation: [0, 0, 0],       size: [0.20, 0.14], color: '#F97316' },
  'crown-mark':    { position: [0,     0.62, 0.08],   rotation: [-0.25, 0, 0],   size: [0.14, 0.08], color: '#06B6D4' },
};

function MemoryMarkings({ marks }: { marks: MemoryMark[] }) {
  return (
    <>
      {marks.map((m) => {
        const cfg = MARK_CONFIG[m.type];
        if (!cfg) return null;
        return (
          <mesh key={m.type} position={cfg.position} rotation={cfg.rotation}>
            <planeGeometry args={cfg.size} />
            <meshBasicMaterial
              color={cfg.color}
              transparent
              opacity={0.72}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CatMesh({
  profile, cursorX, cursorY, state,
  breed = 'tabby',
  equippedAccessories = [],
  memoryMarks = [],
  onPetSignal,
  onZoneEnter,
  onZoneLeave,
  onZoneClick,
}: CatMeshProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Internal pet signal if no external ref provided
  const internalPetRef = useRef(false);
  const petSignalRef   = onPetSignal ?? internalPetRef;

  const morphWeights = profile?.morph_weights ?? {
    robustness: 0.5, agility: 0.5, intelligence: 0.5, size: 0.5, fatigue: 0,
  };

  const scale        = profile ? morphToScale(profile.morph_weights) : 0.8;
  const morphInfl    = useMorphInfluences(profile);
  const animTargets  = useCatAnimation(state, petSignalRef);

  const { headRef, eyesRef } = useIK(
    cursorX, cursorY,
    state !== 'fatigue' && state !== 'neglected' && state !== 'concerned',
  );

  // Morph influences applied if a future real GLTF is loaded
  void morphInfl;

  useFrame(() => {
    if (!groupRef.current) return;
    // Top-level group only carries scale — breathing is inside ProceduralCat
  });

  return (
    <group ref={groupRef} scale={[scale, scale, scale]}>
      <AccessoryOverlays accessories={equippedAccessories} />
      <MemoryMarkings marks={memoryMarks} />

      <ProceduralCat
        breed={breed}
        headRef={headRef as React.RefObject<THREE.Object3D | null>}
        eyesRef={eyesRef as React.RefObject<THREE.Object3D | null>}
        animTargets={animTargets}
        morphWeights={morphWeights}
        onZoneEnter={onZoneEnter}
        onZoneLeave={onZoneLeave}
        onZoneClick={onZoneClick}
      />
    </group>
  );
}
