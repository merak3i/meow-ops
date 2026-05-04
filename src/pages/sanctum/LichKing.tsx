// LichKing — permanent custodian of eternal ops stats.
//
// A mounted figure on an icy plinth at [8, 0, -8] (back-right from the
// camera, mirrors the Violet Citadel back-left). Built from primitives + a
// hand-drawn mounted pixel-art sprite (see textures.ts → getLichKingTexture).
// Doesn't roam, doesn't participate in the per-session selection flow. He IS
// the eternal axis: while champions (current run group) come and go, the
// Lich King is always there with the all-time numbers above his helm.
//
// Eternal-stat mapping:
//   - totalSpend   → headline number on the floating label, also drives the
//                    frosty aura's scale (logarithmic, so $100 vs $10k reads
//                    proportional)
//   - ghostCount   → number of orbiting ghost wisps (capped at 8 so the
//                    visual stays clean even with hundreds of failed sessions)
//   - totalSessions → secondary footer number on the label
//
// The silhouette is now reference-inspired: armored undead horse, rider with
// spiked helm, sword stretched left, torn cloak, and blue ice base. All
// additive blending so the figure reads against the violet floor.

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

import type { EternalStats } from './types';
import { getLichKingTexture } from './textures';

export function LichKing({ eternal }: { eternal: EternalStats }) {
  const mountRef = useRef<THREE.Group>(null);
  const wispsRef = useRef<THREE.Group>(null);
  const capeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hoofMistRefs = useRef<(THREE.Mesh | null)[]>([]);
  const eyeHaloRef = useRef<THREE.Mesh>(null);
  const swordRef = useRef<THREE.Mesh>(null);
  const swordGroupRef = useRef<THREE.Group>(null);
  const frostRingRef = useRef<THREE.Mesh>(null);
  const roarRingRef = useRef<THREE.Mesh>(null);
  const roarWaveRef = useRef<THREE.Mesh>(null);
  const roarCrownRef = useRef<THREE.Mesh>(null);
  const auraRef  = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const breath = Math.sin(t * 1.12);
    const weightShift = Math.sin(t * 2.35 + 0.4);
    const hoofLift = Math.max(0, Math.sin(t * 2.35 + 0.85));

    if (mountRef.current) {
      mountRef.current.position.y = breath * 0.055 + hoofLift * 0.035;
      mountRef.current.rotation.z = Math.sin(t * 0.72) * 0.018 + weightShift * 0.006;
      mountRef.current.scale.set(1 - breath * 0.010, 1 + breath * 0.030, 1);
    }
    capeRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const phase = t * (1.3 + i * 0.22) + i * 1.7;
      mesh.rotation.z = -0.22 - i * 0.06 + Math.sin(phase) * 0.11;
      mesh.position.x = -1.18 - i * 0.28 + Math.sin(phase * 0.75) * 0.05;
      mesh.position.y = 3.55 - i * 0.16 + Math.cos(phase) * 0.045;
      mesh.scale.y = 1 + Math.sin(phase + 0.7) * 0.12;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.32 + Math.sin(phase + 1.1) * 0.08;
    });
    hoofMistRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const cycle = (t * 0.58 + i * 0.31) % 1;
      const s = 0.55 + cycle * 1.4;
      mesh.scale.set(s * 1.45, s, 1);
      mesh.position.y = 0.72 + cycle * 0.16;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.20 * (1 - cycle);
    });
    if (wispsRef.current) wispsRef.current.rotation.y = -t * 0.18;
    // The sprite's eye cavities have a static blue glow baked in. We pulse
    // a small additive halo plane in front of the helm to add the
    // "watching you" feel without animating the texture itself.
    if (eyeHaloRef.current) {
      const pulse = 0.45 + Math.sin(t * 1.9) * 0.28;
      (eyeHaloRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    if (swordRef.current) {
      const roarCycle = (t % 7.2) / 7.2;
      const roarBoost = roarCycle < 0.16 ? 0.35 * (1 - roarCycle / 0.16) : 0;
      (swordRef.current.material as THREE.MeshBasicMaterial).opacity = 0.78 + Math.sin(t * 1.15) * 0.18 + roarBoost;
    }
    if (swordGroupRef.current) {
      swordGroupRef.current.rotation.z = -0.05 + Math.sin(t * 1.05) * 0.030;
      swordGroupRef.current.position.y = Math.sin(t * 1.25 + 0.4) * 0.035;
    }
    if (frostRingRef.current) {
      frostRingRef.current.rotation.z = t * 0.28;
      (frostRingRef.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 1.35) * 0.07;
    }

    // Rare high-energy beat: every ~7s an icy roar rolls out from the dais.
    const cycle = (t % 7.2) / 7.2;
    const roarActive = cycle < 0.34;
    const roar = roarActive ? 1 - cycle / 0.34 : 0;
    if (roarRingRef.current) {
      roarRingRef.current.scale.setScalar(0.85 + cycle * 4.6);
      (roarRingRef.current.material as THREE.MeshBasicMaterial).opacity = roar * 0.42;
    }
    if (roarWaveRef.current) {
      roarWaveRef.current.scale.setScalar(0.6 + cycle * 2.4);
      (roarWaveRef.current.material as THREE.MeshBasicMaterial).opacity = roar * 0.18;
    }
    if (roarCrownRef.current) {
      roarCrownRef.current.rotation.y = t * 0.7;
      roarCrownRef.current.position.y = 2.55 + cycle * 1.2;
      (roarCrownRef.current.material as THREE.MeshBasicMaterial).opacity = roar * 0.26;
    }
    if (auraRef.current) auraRef.current.scale.setScalar((auraScale) * (1 + Math.sin(t * 0.45) * 0.04));
  });

  // Aura scales logarithmically with cumulative spend so the figure feels
  // heavier as costs accumulate. $1 → 1.0, $100 → 1.3, $1k → 1.45,
  // $10k → 1.6, $100k → 1.75. Capped at 2.0 so a runaway burn doesn't
  // dominate the scene.
  const auraScale = useMemo(() => {
    return Math.min(2.0, 1 + Math.log10(Math.max(1, eternal.totalSpend)) * 0.15);
  }, [eternal.totalSpend]);

  // Cap ghost wisps at 8 so the orbit stays legible even on accounts with
  // hundreds of failed sessions.
  const wispCount = Math.min(eternal.ghostCount, 8);

  // Format spend — always with thousands separators when ≥$1k.
  const spendLabel = useMemo(() => {
    if (eternal.totalSpend < 100)  return `$${eternal.totalSpend.toFixed(2)}`;
    if (eternal.totalSpend < 1000) return `$${eternal.totalSpend.toFixed(0)}`;
    return `$${eternal.totalSpend.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }, [eternal.totalSpend]);

  return (
    <group position={[5.0, 0, -7.3]}>
      {/* Frosty aura — large hemisphere, additive, scales with eternal spend.
          Lifted by +0.20 to follow the new third platform step. */}
      <mesh ref={auraRef} position={[0, 1.4, 0]}>
        <sphereGeometry args={[2.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#4a7fcf" transparent opacity={0.10}
          blending={THREE.AdditiveBlending} side={THREE.BackSide}
          depthWrite={false} fog={false} />
      </mesh>

      {/* Icy plinth — black iron base plus snow shelf, matching the mounted
          reference without adding perimeter architecture back into scene. */}
      <mesh position={[0, 0.10, 0]}>
        <cylinderGeometry args={[3.6, 3.8, 0.20, 28]} />
        <meshBasicMaterial color="#070910" />
      </mesh>
      <mesh position={[0, 0.30, 0]}>
        <cylinderGeometry args={[3.05, 3.25, 0.26, 20]} />
        <meshBasicMaterial color="#151923" />
      </mesh>
      <mesh position={[0, 0.50, 0]}>
        <cylinderGeometry args={[2.55, 2.85, 0.28, 14]} />
        <meshBasicMaterial color="#d6e8ee" />
      </mesh>
      {/* Iron spikes around the base lip. */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const r = 3.25;
        return (
          <mesh key={`spike-${i}`} position={[Math.cos(a) * r, 0.58, Math.sin(a) * r]} rotation={[0, -a, 0]}>
            <coneGeometry args={[0.10, 0.55, 4]} />
            <meshBasicMaterial color="#090a0f" />
          </mesh>
        );
      })}
      {/* Blue ice crystal cluster at the front-left of the plinth. */}
      {[
        [-1.45, 0.85, 1.08, 0.85],
        [-1.05, 0.75, 1.02, 0.65],
        [-1.75, 0.68, 0.82, 0.55],
        [-0.72, 0.62, 1.20, 0.45],
      ].map(([x, y, z, s], i) => (
        <mesh key={`ice-${i}`} position={[x!, y!, z!]} rotation={[0.2, i * 0.55, 0.25]}>
          <octahedronGeometry args={[s!, 0]} />
          <meshBasicMaterial color={i % 2 === 0 ? '#42d8ff' : '#8eeaff'} transparent opacity={0.72}
            blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
      ))}

      {/* Mounted Lich King — hand-drawn sprite: spiked rider, armored undead
          horse, torn cloak, and ice base. Wide billboard to match the
          side-facing reference composition. */}
      <group ref={mountRef}>
        {/* Separate cape ribbons give the baked sprite real cloth motion. */}
        {[0, 1, 2].map((i) => (
          <mesh
            key={`cape-${i}`}
            ref={(m) => { capeRefs.current[i] = m; }}
            renderOrder={1}
            position={[-1.18 - i * 0.28, 3.55 - i * 0.16, 0.035]}
            rotation={[0, 0, -0.24 - i * 0.05]}
          >
            <planeGeometry args={[0.42 + i * 0.08, 2.0 - i * 0.22]} />
            <meshBasicMaterial
              color={i === 0 ? '#170822' : i === 1 ? '#250d32' : '#0b0618'}
              transparent opacity={0.34} side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending} depthWrite={false} fog={false}
            />
          </mesh>
        ))}
        <sprite scale={[7.9, 5.9, 1]} position={[0, 3.65, 0.10]}>
          <spriteMaterial map={getLichKingTexture()} transparent alphaTest={0.05} fog={false} />
        </sprite>
        {/* Eye-glow halo — pulses near the rider's helm. */}
        <mesh ref={eyeHaloRef} position={[-0.78, 5.18, 0.28]}>
          <planeGeometry args={[0.86, 0.20]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.40}
            blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>

        {/* Horizontal blade glow stretched left, matching the reference pose. */}
        <group ref={swordGroupRef} position={[-2.25, 4.62, 0.42]} rotation={[0, 0, -0.05]}>
          <mesh ref={swordRef} position={[0, 0, 0]}>
            <boxGeometry args={[3.8, 0.09, 0.035]} />
            <meshBasicMaterial color="#5cd2ff" transparent opacity={0.85}
              blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
          </mesh>
          <mesh position={[0.05, 0, 0.01]}>
            <boxGeometry args={[3.65, 0.035, 0.012]} />
            <meshBasicMaterial color="#0f1a2a" />
          </mesh>
          <mesh position={[1.85, 0, 0.02]}>
            <sphereGeometry args={[0.09, 10, 10]} />
            <meshBasicMaterial color="#7de3ff" transparent opacity={0.95}
              blending={THREE.AdditiveBlending} fog={false} />
          </mesh>
        </group>
      </group>
      {/* Ground frost ring — sits on the new top step (y=0.62) around the
          boots. Slightly wider than the top step so it spills onto the
          mid step, reinforcing the multi-tier dais. */}
      <mesh ref={frostRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.62, 0]}>
        <ringGeometry args={[0.9, 2.2, 48]} />
        <meshBasicMaterial color="#5cd2ff" transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>
      {/* Hoof frost wisps: quiet continuous motion tied to the mount weight shift. */}
      {[[-1.0, 0.0], [0.88, 0.05], [1.55, -0.05]].map(([x, z], i) => (
        <mesh
          key={`hoof-mist-${i}`}
          ref={(m) => { hoofMistRefs.current[i] = m; }}
          rotation={[-Math.PI / 2, 0, i * 0.7]}
          position={[x!, 0.72, z!]}
        >
          <ringGeometry args={[0.18, 0.28, 18]} />
          <meshBasicMaterial color="#8eeaff" transparent opacity={0.16}
            blending={THREE.AdditiveBlending} depthWrite={false}
            side={THREE.DoubleSide} fog={false} />
        </mesh>
      ))}
      {/* Periodic icy roar / weapon pulse: one low ring, one vertical wave,
          one crown arc. These are transform-only and cheap to animate. */}
      <mesh ref={roarRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.68, 0]}>
        <ringGeometry args={[0.72, 0.82, 64]} />
        <meshBasicMaterial color="#8eeaff" transparent opacity={0}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>
      <mesh ref={roarWaveRef} position={[0, 2.15, 0]}>
        <sphereGeometry args={[1.35, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#5cd2ff" transparent opacity={0}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.BackSide} fog={false} />
      </mesh>
      <mesh ref={roarCrownRef} position={[0, 2.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.65, 0.018, 6, 48]} />
        <meshBasicMaterial color="#dffaff" transparent opacity={0}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>

      {/* Ghost wisps — orbiting at varied radii/heights, count = ghostCount
          capped at 8. Souls of failed sessions made visual. */}
      <group ref={wispsRef} position={[0, 1.6, 0]}>
        {Array.from({ length: wispCount }, (_, i) => {
          const a = (i / Math.max(1, wispCount)) * Math.PI * 2;
          const r = 1.85 + (i % 2) * 0.35;
          const y = (i % 3) * 0.45 - 0.30;
          return (
            <mesh key={i} position={[Math.cos(a) * r, y, Math.sin(a) * r]}>
              <sphereGeometry args={[0.10, 8, 8]} />
              <meshBasicMaterial color="#9cccff" transparent opacity={0.55}
                blending={THREE.AdditiveBlending} fog={false} />
            </mesh>
          );
        })}
      </group>

      {/* Floating eternal-stats label above the helm */}
      <Html center position={[0, 7.05, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontFamily: 'monospace',
          color: '#5cd2ff',
          background: 'rgba(8,10,28,0.88)',
          border: '1px solid #5cd2ff66',
          borderRadius: 3,
          padding: '4px 9px 5px',
          fontSize: 9,
          letterSpacing: 1,
          whiteSpace: 'nowrap',
          textShadow: '0 0 4px #5cd2ff66',
          userSelect: 'none',
          textAlign: 'center',
          boxShadow: '0 0 12px rgba(92,210,255,0.18)',
        }}>
          <div style={{
            fontFamily: '"Cinzel", serif',
            fontSize: 9, fontWeight: 700, opacity: 0.85,
            letterSpacing: 3, marginBottom: 3,
          }}>
            ETERNAL · LICH KING
          </div>
          <div style={{ fontWeight: 'bold' }}>{spendLabel} spent</div>
          <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1 }}>
            {eternal.ghostCount} ghosts · {eternal.totalSessions} sessions
          </div>
        </div>
      </Html>
    </group>
  );
}
