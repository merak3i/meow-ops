import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type LODLevel = 'high' | 'medium' | 'low';

// Distance thresholds from camera (world units)
const LOD_HIGH_MAX   = 5;
const LOD_MEDIUM_MAX = 15;

/**
 * Returns the current LOD level based on camera distance to the companion.
 * Updates every frame, stable between level transitions.
 */
export function useLODLevel(companionPos: THREE.Vector3 = new THREE.Vector3()): {
  level: React.MutableRefObject<LODLevel>;
} {
  const { camera } = useThree();
  const level      = useRef<LODLevel>('high');

  useFrame(() => {
    const dist = camera.position.distanceTo(companionPos);

    if (dist < LOD_HIGH_MAX) {
      level.current = 'high';
    } else if (dist < LOD_MEDIUM_MAX) {
      level.current = 'medium';
    } else {
      level.current = 'low';
    }
  });

  return { level };
}

// ─── Shell count per LOD level ────────────────────────────────────────────────
// Fur shell rendering is the most expensive part of the companion.
// Reduce shell count aggressively at distance.

export const FUR_SHELLS_PER_LOD: Record<LODLevel, number> = {
  high:   32,
  medium: 16,
  low:    0,    // No fur at distance — just the base mesh
};

// ─── Drei <Detailed> distances helper ────────────────────────────────────────
// Pass these as the `distances` prop to <Detailed>.

export const LOD_DISTANCES: [number, number, number] = [0, LOD_HIGH_MAX, LOD_MEDIUM_MAX];
