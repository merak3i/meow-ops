import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// How fast the head tracks (lerp factor per frame at 60fps)
const TRACK_SPEED   = 0.08;
// Max rotation clamp angles (radians)
const MAX_YAW       = Math.PI / 4;   // 45° left/right
const MAX_PITCH     = Math.PI / 6;   // 30° up/down
// Distance from screen where tracking "pulls" at full strength
const FULL_PULL_DIST = 0.5;          // in normalised screen units

export interface IKState {
  headRef: React.RefObject<THREE.Object3D | null>;
  eyesRef: React.RefObject<THREE.Object3D | null>;
}

/**
 * Cursor-driven IK for the companion's head and eye bones.
 *
 * Converts mouse position to a world-space look-at target on a virtual plane
 * in front of the cat, then lerps the head rotation toward it.  Clamped to
 * avoid unnatural rotations.
 *
 * Returns refs you attach to the head and eye bones in your JSX.
 */
export function useIK(
  cursorX: number,
  cursorY: number,
  enabled = true,
): IKState {
  const headRef = useRef<THREE.Object3D | null>(null);
  const eyesRef = useRef<THREE.Object3D | null>(null);

  const targetYaw   = useRef(0);
  const targetPitch = useRef(0);
  const { camera }  = useThree();

  // Keep a stable target Euler that we lerp into
  const currentYaw   = useRef(0);
  const currentPitch = useRef(0);

  useEffect(() => {
    if (!enabled) {
      targetYaw.current   = 0;
      targetPitch.current = 0;
    }
  }, [enabled]);

  useFrame(() => {
    if (!headRef.current) return;

    if (enabled) {
      // Map cursor (-1…+1) to yaw/pitch, with strength falloff at extremes
      const strength = Math.max(0, 1 - Math.sqrt(cursorX ** 2 + cursorY ** 2) / FULL_PULL_DIST);

      targetYaw.current   = -cursorX * MAX_YAW   * strength;
      targetPitch.current =  cursorY * MAX_PITCH  * strength;
    }

    // Lerp toward target
    currentYaw.current   += (targetYaw.current   - currentYaw.current)   * TRACK_SPEED;
    currentPitch.current += (targetPitch.current - currentPitch.current) * TRACK_SPEED;

    // Apply clamped rotation to head bone
    headRef.current.rotation.y = THREE.MathUtils.clamp(currentYaw.current,   -MAX_YAW,   MAX_YAW);
    headRef.current.rotation.x = THREE.MathUtils.clamp(currentPitch.current, -MAX_PITCH, MAX_PITCH);

    // Eyes get a slightly amplified version (±5° more) for liveliness
    if (eyesRef.current) {
      eyesRef.current.rotation.y = headRef.current.rotation.y   * 1.2;
      eyesRef.current.rotation.x = headRef.current.rotation.x   * 1.15;
    }

    void camera; // camera available for future projection math
  });

  return { headRef, eyesRef };
}
