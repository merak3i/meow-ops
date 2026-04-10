// ActionParticles.tsx — Three.js particle effect triggered by companion actions.
// Feed → green rising sparkles, Play → orange bouncing dots,
// Groom → pink hearts drift, Sleep → blue zzz float, Pet → yellow stars.

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ActionParticlesProps {
  effect: string | null;   // 'feed' | 'play' | 'groom' | 'sleep' | 'pet' | null
}

// ─── Config per effect ────────────────────────────────────────────────────────

const EFFECT_CONFIG: Record<string, { color: number; count: number; speed: number; spread: number }> = {
  feed:  { color: 0x7ac74f, count: 24, speed: 0.8,  spread: 0.4 },
  play:  { color: 0xff8830, count: 30, speed: 1.2,  spread: 0.6 },
  groom: { color: 0xff80c0, count: 20, speed: 0.6,  spread: 0.3 },
  sleep: { color: 0x80c0ff, count: 16, speed: 0.4,  spread: 0.2 },
  pet:   { color: 0xffd700, count: 28, speed: 1.0,  spread: 0.5 },
  room:  { color: 0xc084fc, count: 18, speed: 0.5,  spread: 0.3 },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ActionParticles({ effect }: ActionParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const cfg       = effect ? EFFECT_CONFIG[effect] : null;

  const { positions, velocities } = useMemo(() => {
    const count  = cfg?.count ?? 0;
    const spread = cfg?.spread ?? 0.4;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Origin near cat body
      pos[i * 3]     = (Math.random() - 0.5) * spread;
      pos[i * 3 + 1] = (Math.random() - 0.5) * spread;
      pos[i * 3 + 2] = (Math.random() - 0.5) * spread;

      // Velocity: upward bias, random horizontal drift
      const speed = cfg?.speed ?? 0.8;
      vel[i * 3]     = (Math.random() - 0.5) * speed * 0.4;
      vel[i * 3 + 1] = Math.random() * speed + speed * 0.3;
      vel[i * 3 + 2] = (Math.random() - 0.5) * speed * 0.4;
    }
    return { positions: pos, velocities: vel };
  // Recompute only when effect changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !cfg) return;
    const pos = pointsRef.current.geometry.attributes['position'];
    if (!pos) return;
    const arr = pos.array as Float32Array;

    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3]     += velocities[i * 3]     * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
      // Apply gravity + damping
      velocities[i * 3 + 1] -= 0.5 * delta;
    }
    pos.needsUpdate = true;
  });

  if (!cfg || !effect) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={cfg.color}
        size={0.06}
        sizeAttenuation
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </points>
  );
}
