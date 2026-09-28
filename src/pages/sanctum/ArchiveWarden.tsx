import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { EternalStats } from './types';
import { ArchiveSeal } from './ArchiveSeal';
import { usePerfLevel } from './perf';

const SIGNATURE_TEAL = '#64e5c2';
const WARDEN_ROBE_PROFILE = [
  new THREE.Vector2(0.84, 0.16),
  new THREE.Vector2(0.95, 0.38),
  new THREE.Vector2(0.91, 0.66),
  new THREE.Vector2(0.82, 0.94),
  new THREE.Vector2(0.77, 1.24),
  new THREE.Vector2(0.72, 1.55),
  new THREE.Vector2(0.68, 1.84),
  new THREE.Vector2(0.58, 2.13),
  new THREE.Vector2(0.42, 2.38),
];

function roundedPlate(width: number, height: number, radius: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
  return shape;
}

const WARDEN_BADGE_FRAME = roundedPlate(1.7, 1.58, 0.18);
const WARDEN_BADGE_INSET = roundedPlate(1.52, 1.4, 0.14);
const WARDEN_PAULDRON = roundedPlate(0.96, 0.5, 0.11);

function createWardenRobeGeometry() {
  const profile = new THREE.SplineCurve(WARDEN_ROBE_PROFILE).getPoints(48);
  const geometry = new THREE.LatheGeometry(profile, 48);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const shadow = new THREE.Color('#202f32');
  const cloth = new THREE.Color('#304447');
  const light = new THREE.Color('#435657');
  const scratch = new THREE.Color();

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const angle = Math.atan2(z, x);
    const lowerCloth = THREE.MathUtils.smoothstep(1.9 - y, 0.15, 1.35);
    const fold = Math.cos(angle * 9 + y * 0.8);
    const fineFold = Math.sin(angle * 17 - y * 1.15);
    const radius = Math.hypot(x, z) + lowerCloth * (0.018 * fold + 0.006 * fineFold);
    positions.setXYZ(index, Math.cos(angle) * radius, y, Math.sin(angle) * radius);

    const shade = THREE.MathUtils.clamp(0.44 + lowerCloth * (fold * 0.22 + fineFold * 0.05), 0, 1);
    scratch.copy(shadow).lerp(cloth, shade).lerp(light, Math.max(0, fold) * lowerCloth * 0.22);
    scratch.toArray(colors, index * 3);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function ArchiveWarden({ eternal, pulseKey = 0 }: { eternal: EternalStats; pulseKey?: number }) {
  const perf = usePerfLevel();
  const robeGeometry = useMemo(createWardenRobeGeometry, []);
  const figureRef = useRef<THREE.Group>(null);
  const sealRef = useRef<THREE.Group>(null);
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseDiscRef = useRef<THREE.Mesh>(null);
  const pulseStartedRef = useRef(-99);
  const pendingPulseRef = useRef(false);
  const nextPulseRef = useRef(55 + Math.random() * 45);

  useEffect(() => {
    if (pulseKey > 0) pendingPulseRef.current = true;
  }, [pulseKey]);

  useEffect(() => () => robeGeometry.dispose(), [robeGeometry]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (figureRef.current) {
      figureRef.current.position.y = Math.sin(time * 0.72) * 0.045;
      figureRef.current.rotation.y = Math.sin(time * 0.36) * 0.025;
    }
    if (sealRef.current) sealRef.current.rotation.z = Math.sin(time * 0.25) * 0.025;

    if (pendingPulseRef.current || time >= nextPulseRef.current) {
      pulseStartedRef.current = time;
      pendingPulseRef.current = false;
      nextPulseRef.current = time + 55 + Math.random() * 45;
    }
    const elapsed = time - pulseStartedRef.current;
    const progress = Math.max(0, Math.min(1, elapsed / 2.2));
    const strength = elapsed >= 0 && elapsed < 2.2 ? 1 - progress : 0;
    if (pulseRingRef.current) {
      pulseRingRef.current.scale.setScalar(0.8 + progress * 4.2);
      (pulseRingRef.current.material as THREE.MeshBasicMaterial).opacity = strength * 0.35;
    }
    if (pulseDiscRef.current) {
      (pulseDiscRef.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + strength * 0.30;
    }
  });

  const ghostMarks = Math.min(eternal.ghostCount, 8);
  const spendLabel = useMemo(() => {
    if (eternal.totalSpend < 100) return `$${eternal.totalSpend.toFixed(2)}`;
    return `$${eternal.totalSpend.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }, [eternal.totalSpend]);

  return (
    <group position={[5, 0, -6.8]} scale={1.46}>
      <mesh position={[0, 1.8, 0]}>
        <sphereGeometry args={[2.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#59cbb5" transparent opacity={0.075}
          blending={THREE.AdditiveBlending} side={THREE.BackSide} depthWrite={false} fog={false} />
      </mesh>

      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[2.0, 2.15, 0.24, 32]} />
        <meshStandardMaterial color="#18252d" roughness={0.72} metalness={0.28} />
      </mesh>
      <mesh position={[0, 0.29, 0]}>
        <cylinderGeometry args={[1.7, 1.84, 0.12, 32]} />
        <meshStandardMaterial color="#b08852" roughness={0.62} metalness={0.45} />
      </mesh>

      <group ref={figureRef} position={[0, 0.35, 0]}>
        {perf !== 'low' && <pointLight position={[0, 2.15, 2.0]} color={SIGNATURE_TEAL} intensity={1.5} distance={7} />}
        {/* Folded cloth gives the archive robe a softer, layered surface. */}
        <mesh geometry={robeGeometry} position={[0, 0, 0]}>
          <meshStandardMaterial vertexColors emissive="#0d1a1d" emissiveIntensity={0.12}
            roughness={0.94} metalness={0.02} />
        </mesh>
        {/* The hood wraps the rear of the mask and leaves the face opening clear. */}
        <mesh position={[0, 2.86, -0.02]} scale={[1.08, 1.12, 1.02]}>
          <sphereGeometry args={[0.77, 32, 20, Math.PI, Math.PI, 0, Math.PI * 0.72]} />
          <meshStandardMaterial color="#1e2b2d" roughness={0.98} metalness={0.01}
            side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 2.86, 0]}>
          <sphereGeometry args={[0.7, 24, 18]} />
          <meshStandardMaterial color="#82999b" emissive="#294344" emissiveIntensity={0.3}
            roughness={0.62} metalness={0.12} />
        </mesh>
        <mesh position={[0, 2.82, 0.56]} scale={[1, 0.68, 0.2]}>
          <sphereGeometry args={[0.7, 20, 14]} />
          <meshStandardMaterial color="#101b20" roughness={0.38} metalness={0.45} />
        </mesh>
        {[ -1, 1 ].map((side) => (
          <group key={side}>
            <mesh position={[side * 0.94, 2.34, 0]} rotation={[0, 0, side * -0.14]} scale={[1.12, 0.72, 0.82]}>
              <sphereGeometry args={[0.5, 20, 14]} />
              <meshStandardMaterial color="#718789" emissive="#243d3d" emissiveIntensity={0.28}
                roughness={0.72} metalness={0.1} />
            </mesh>
            {side === 1 && (
              <group position={[side * 0.94, 2.34, 0.37]} rotation={[0, side * 0.08, side * -0.14]}>
                <mesh>
                  <extrudeGeometry args={[WARDEN_PAULDRON, {
                    depth: 0.07, bevelEnabled: true, bevelSegments: 2,
                    bevelSize: 0.035, bevelThickness: 0.025,
                  }]} />
                  <meshStandardMaterial color="#7c8b89" roughness={0.82} metalness={0.16} />
                </mesh>
                <mesh position={[0, -0.15, 0.09]}>
                  <boxGeometry args={[0.58, 0.028, 0.018]} />
                  <meshStandardMaterial color="#a08054" roughness={0.7} metalness={0.32} />
                </mesh>
              </group>
            )}
            <mesh position={[side * 1.12, 1.58, 0.04]} rotation={[0, 0, side * -0.16]}>
              <cylinderGeometry args={[0.15, 0.24, 1.15, 12]} />
              <meshStandardMaterial color="#5a7275" emissive="#1d3335" emissiveIntensity={0.25}
                roughness={0.72} metalness={0.1} />
            </mesh>
            <mesh position={[side * 1.22, 0.98, 0.04]} rotation={[0, 0, side * -0.16]}>
              <cylinderGeometry args={[0.13, 0.17, 0.42, 12]} />
              <meshStandardMaterial color="#a08054" roughness={0.72} metalness={0.3} flatShading />
            </mesh>
            <mesh position={[side * 0.4, 0.4, 0.05]}>
              <cylinderGeometry args={[0.2, 0.24, 1.06, 12]} />
              <meshStandardMaterial color="#4a6265" emissive="#182e30" emissiveIntensity={0.22}
                roughness={0.72} metalness={0.1} />
            </mesh>
          </group>
        ))}

        {/* Copper-framed inset gives the exact authored Seal a readable surface. */}
        <mesh position={[0, 1.73, 0.69]}>
          <extrudeGeometry args={[WARDEN_BADGE_FRAME, {
            depth: 0.045, bevelEnabled: true, bevelSegments: 2,
            bevelSize: 0.018, bevelThickness: 0.018,
          }]} />
          <meshStandardMaterial color="#a08054" roughness={0.68} metalness={0.36} />
        </mesh>
        <mesh position={[0, 1.73, 0.74]}>
          <shapeGeometry args={[WARDEN_BADGE_INSET]} />
          <meshStandardMaterial color="#182a2d" roughness={0.82} metalness={0.24} />
        </mesh>

        {/* Offset index folio: three staggered leaves reinforce the records-keeper role. */}
        <group position={[-0.25, 0.52, 0.87]} rotation={[0, -0.27, -0.04]}>
          <mesh>
            <boxGeometry args={[0.48, 0.36, 0.11]} />
            <meshStandardMaterial color="#273b3d" roughness={0.86} metalness={0.16} />
          </mesh>
          <mesh position={[-0.195, 0, 0.062]}>
            <boxGeometry args={[0.03, 0.33, 0.018]} />
            <meshStandardMaterial color="#a08054" roughness={0.7} metalness={0.34} />
          </mesh>
          {[0, 1, 2].map((index) => (
            <mesh key={index} position={[0.015 + index * 0.012, 0.105 - index * 0.095, 0.067]}>
              <boxGeometry args={[0.24 + (index % 2) * 0.05, 0.025, 0.016]} />
              <meshStandardMaterial color={index === 1 ? SIGNATURE_TEAL : '#b08852'}
                roughness={0.7} metalness={0.28} />
            </mesh>
          ))}
        </group>

        <group ref={sealRef} position={[0, 1.73, 0.78]}>
          <ArchiveSeal size={1.08} />
        </group>

        {Array.from({ length: ghostMarks }, (_, index) => {
          const angle = (index / Math.max(1, ghostMarks)) * Math.PI * 2;
          const radius = 2.15 + (index % 2) * 0.24;
          return (
            <mesh key={index} position={[Math.cos(angle) * radius, 1.5 + (index % 3) * 0.42, Math.sin(angle) * radius]}>
              <octahedronGeometry args={[0.095, 0]} />
              <meshBasicMaterial color={index % 2 === 0 ? '#dfad69' : SIGNATURE_TEAL}
                transparent opacity={0.62} blending={THREE.AdditiveBlending} fog={false} />
            </mesh>
          );
        })}
      </group>

      <mesh ref={pulseDiscRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.48, 0]}>
        <circleGeometry args={[1.35, 32]} />
        <meshBasicMaterial color={SIGNATURE_TEAL} transparent opacity={0.08}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh ref={pulseRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
        <ringGeometry args={[0.68, 0.8, 48]} />
        <meshBasicMaterial color={SIGNATURE_TEAL} transparent opacity={0}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} fog={false} />
      </mesh>

      <Html center position={[0, 4.15, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontFamily: 'monospace', color: SIGNATURE_TEAL, background: 'rgba(8,18,23,0.9)',
          border: '1px solid #64e5c266', borderRadius: 3, padding: '4px 9px 5px',
          fontSize: 9, letterSpacing: 1, whiteSpace: 'nowrap', textAlign: 'center',
          textShadow: '0 0 4px #64e5c266', userSelect: 'none',
          boxShadow: '0 0 12px rgba(100,229,194,0.16)',
        }}>
          <div style={{ fontFamily: '"Cinzel", serif', fontSize: 9, fontWeight: 700, letterSpacing: 2, marginBottom: 3 }}>
            ARCHIVE WARDEN
          </div>
          <div style={{ fontWeight: 'bold' }}>{spendLabel} estimated</div>
          <div style={{ fontSize: 8, opacity: 0.85, marginTop: 1 }}>
            {eternal.ghostCount} incomplete · {eternal.totalSessions} sessions
          </div>
          <div style={{ fontSize: 8, opacity: 0.85 }} title={eternal.importedAt ? `Imported ${eternal.importedAt}` : undefined}>
            {eternal.scope === 'archive' ? 'Imported archive snapshot' : 'Loaded preview · archive unavailable'}
          </div>
        </div>
      </Html>
    </group>
  );
}
