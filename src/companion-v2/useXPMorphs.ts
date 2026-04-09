import { useMemo } from 'react';
import type { MorphWeights, DeveloperProfile } from '@/types/session';

export interface MorphTargetMap {
  /** Index into mesh.morphTargetInfluences[] */
  robustness:   number;
  agility:      number;
  intelligence: number;
  size:         number;
  fatigue:      number;
}

// Maps morph target names to their index in the glTF morph target array.
// Adjust these indices to match the actual exported glTF mesh ordering.
const MORPH_INDICES: MorphTargetMap = {
  robustness:   0,
  agility:      1,
  intelligence: 2,
  size:         3,
  fatigue:      4,
};

/**
 * Derive Three.js morphTargetInfluences array from a DeveloperProfile.
 * Returns a stable length-5 Float32Array that can be spread directly onto
 * a BufferGeometry's morphTargetInfluences.
 */
export function useMorphInfluences(profile: DeveloperProfile | null): number[] {
  return useMemo(() => {
    if (!profile) return [0, 0, 0, 0, 0];

    const w = profile.morph_weights;
    const arr = new Array<number>(5).fill(0);

    arr[MORPH_INDICES.robustness]   = w.robustness;
    arr[MORPH_INDICES.agility]      = w.agility;
    arr[MORPH_INDICES.intelligence] = w.intelligence;
    arr[MORPH_INDICES.size]         = w.size;
    arr[MORPH_INDICES.fatigue]      = w.fatigue;

    return arr;
  }, [profile]);
}

/**
 * Compute the visual scale multiplier from the size morph weight.
 * Size 0 (kitten) = 0.6×, size 1 (elder) = 1.3×.
 */
export function morphToScale(weights: MorphWeights): number {
  return 0.6 + weights.size * 0.7;
}

/**
 * Derive a CSS hue-rotate offset (degrees) for the coat colour based on
 * dominant behaviour traits. Biased toward a warm amber for high robustness,
 * cool silver for high intelligence.
 */
export function morphToCoatHue(weights: MorphWeights): number {
  // robustness → warm (+30°), intelligence → cool (−20°)
  return weights.robustness * 30 - weights.intelligence * 20;
}
