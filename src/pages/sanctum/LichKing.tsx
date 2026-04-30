// LichKing — permanent custodian of eternal ops stats.
//
// A monumental figure on a raised throne at [8, 0, -8] (back-right from the
// camera, mirrors the Violet Citadel back-left). Built from primitives + a
// hand-drawn 128×192 pixel-art sprite (see textures.ts → getLichKingTexture).
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
// Frostmourne planted in front of the throne sells the lore reading. Eyes
// pulse blue, sword glows blue, frosty hemispherical mist domes the platform.
// All additive blending so the figure reads against the violet floor.

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

import type { EternalStats } from './types';
import { getLichKingTexture } from './textures';

export function LichKing({ eternal }: { eternal: EternalStats }) {
  const wispsRef = useRef<THREE.Group>(null);
  const eyeHaloRef = useRef<THREE.Mesh>(null);
  const swordRef = useRef<THREE.Mesh>(null);
  const auraRef  = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (wispsRef.current) wispsRef.current.rotation.y = -t * 0.18;
    // The sprite's eye cavities have a static blue glow baked in. We pulse
    // a small additive halo plane in front of the helm to add the
    // "watching you" feel without animating the texture itself.
    if (eyeHaloRef.current) {
      const pulse = 0.35 + Math.sin(t * 1.4) * 0.20;
      (eyeHaloRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    if (swordRef.current) {
      (swordRef.current.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 0.7) * 0.20;
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
    <group position={[8, 0, -8]}>
      {/* Frosty aura — large hemisphere, additive, scales with eternal spend.
          Lifted by +0.20 to follow the new third platform step. */}
      <mesh ref={auraRef} position={[0, 1.4, 0]}>
        <sphereGeometry args={[2.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#4a7fcf" transparent opacity={0.10}
          blending={THREE.AdditiveBlending} side={THREE.BackSide}
          depthWrite={false} fog={false} />
      </mesh>

      {/* Stone platform — wider three-step ziggurat. Earlier the dais was
          two narrow steps (top radius 1.7) which made the Lich King feel
          like he perched in the back-right corner. The pyramid now reads
          as commanding the back-right, balancing the Violet Citadel that
          mirrors from the back-left. Top step still 1.9–2.1 so the throne
          + sprite fit; the wider lower steps spread the visual weight. */}
      <mesh position={[0, 0.10, 0]}>
        <cylinderGeometry args={[3.4, 3.6, 0.20, 24]} />
        <meshBasicMaterial color="#13091e" />
      </mesh>
      <mesh position={[0, 0.30, 0]}>
        <cylinderGeometry args={[2.6, 2.8, 0.20, 20]} />
        <meshBasicMaterial color="#1a1428" />
      </mesh>
      <mesh position={[0, 0.50, 0]}>
        <cylinderGeometry args={[1.9, 2.1, 0.20, 16]} />
        <meshBasicMaterial color="#231a36" />
      </mesh>
      {/* Sweeping front stair — three slim slabs descending toward the
          plaza so the dais reads as approachable, not a sealed plinth.
          Slabs are slightly wider than tall so they read as steps from
          the orthographic camera. */}
      <mesh position={[0, 0.10, 2.4]}>
        <boxGeometry args={[2.0, 0.20, 0.6]} />
        <meshBasicMaterial color="#13091e" />
      </mesh>
      <mesh position={[0, 0.30, 2.0]}>
        <boxGeometry args={[1.6, 0.20, 0.5]} />
        <meshBasicMaterial color="#1a1428" />
      </mesh>
      <mesh position={[0, 0.50, 1.6]}>
        <boxGeometry args={[1.2, 0.20, 0.4]} />
        <meshBasicMaterial color="#231a36" />
      </mesh>

      {/* Throne — back panel + seat + armrests, all lifted +0.20 for the
          new top step at y=0.60. */}
      <mesh position={[0, 2.05, -0.6]}>
        <boxGeometry args={[1.3, 2.6, 0.18]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>
      <mesh position={[0, 0.98, -0.05]}>
        <boxGeometry args={[1.0, 0.18, 0.9]} />
        <meshBasicMaterial color="#241636" />
      </mesh>
      <mesh position={[-0.55, 1.30, -0.05]}>
        <boxGeometry args={[0.18, 0.5, 0.9]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>
      <mesh position={[0.55, 1.30, -0.05]}>
        <boxGeometry args={[0.18, 0.5, 0.9]} />
        <meshBasicMaterial color="#1a0f28" />
      </mesh>

      {/* Lich body — hand-drawn pixel sprite (Arthas-style: horns + skull
          pauldrons + chest skull + ornate cape + frost mist around boots).
          128×192 source, billboard so it always faces the camera. Scale
          3.8×5.4. Feet anchor to top step (y=0.60); sprite center =
          0.60 + 5.4/2 = 3.30. */}
      <sprite scale={[3.8, 5.4, 1]} position={[0, 3.30, 0.05]}>
        <spriteMaterial map={getLichKingTexture()} transparent alphaTest={0.05} fog={false} />
      </sprite>
      {/* Eye-glow halo — pulses in front of the helm. Sits at world y =
          3.30 + 1.52 = 4.82, in z=0.20 to stay forward of the sprite. */}
      <mesh ref={eyeHaloRef} position={[0, 4.82, 0.20]}>
        <planeGeometry args={[0.95, 0.22]} />
        <meshBasicMaterial color="#5cd2ff" transparent opacity={0.40}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Ground frost ring — sits on the new top step (y=0.62) around the
          boots. Slightly wider than the top step so it spills onto the
          mid step, reinforcing the multi-tier dais. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.62, 0]}>
        <ringGeometry args={[0.9, 2.2, 48]} />
        <meshBasicMaterial color="#5cd2ff" transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide} fog={false} />
      </mesh>

      {/* Frostmourne — planted blade-up in front of the throne. Lifted
          +0.20 to anchor on the top step, blade still extends upward
          past the Lich's chest. */}
      <group position={[0, 0.7, 0.55]}>
        {/* Dalaran D5 — wide bloom-fake halo around the blade. Cylinder
            with very low additive opacity so Frostmourne reads as bloomed
            without postprocessing. */}
        <mesh position={[0, 0.95, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 1.9, 12, 1, true]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.06}
            blending={THREE.AdditiveBlending} side={THREE.DoubleSide}
            depthWrite={false} fog={false} />
        </mesh>
        {/* Blade glow (wider, additive) */}
        <mesh ref={swordRef} position={[0, 0.95, 0]}>
          <boxGeometry args={[0.12, 1.7, 0.03]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.85}
            blending={THREE.AdditiveBlending} fog={false} />
        </mesh>
        {/* Blade core (solid, dark) */}
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[0.06, 1.7, 0.012]} />
          <meshBasicMaterial color="#0f1a2a" />
        </mesh>
        {/* Crossguard */}
        <mesh position={[0, 0.10, 0]}>
          <boxGeometry args={[0.34, 0.06, 0.10]} />
          <meshBasicMaterial color="#1a0f28" />
        </mesh>
        {/* Hilt */}
        <mesh position={[0, -0.10, 0]}>
          <boxGeometry args={[0.06, 0.30, 0.06]} />
          <meshBasicMaterial color="#241636" />
        </mesh>
        {/* Pommel — blue gem */}
        <mesh position={[0, -0.30, 0]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshBasicMaterial color="#5cd2ff" transparent opacity={0.85}
            blending={THREE.AdditiveBlending} fog={false} />
        </mesh>
      </group>

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
      <Html center position={[0, 4.4, 0]} style={{ pointerEvents: 'none' }}>
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
