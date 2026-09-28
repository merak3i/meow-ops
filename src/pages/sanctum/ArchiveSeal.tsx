import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  ARCHIVE_SEAL_CENTER,
  ARCHIVE_SEAL_CENTER_RADIUS,
  ARCHIVE_SEAL_COLORS,
  ARCHIVE_SEAL_DIAMOND_PATH,
  ARCHIVE_SEAL_RAYS,
  ARCHIVE_SEAL_TRACK_PATH,
  ARCHIVE_SEAL_TRACK_ROTATIONS,
} from './archive-seal-mark';

type SealTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
};

type SealBatch = {
  name: string;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
};

/** Small, accessible version of the authored seal for dense 2D surfaces. */
export function ArchiveSealMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      aria-label="Archive Seal"
      role="img"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden={false}
      style={{ display: 'block', flex: 'none' }}
    >
      <g stroke={ARCHIVE_SEAL_COLORS.teal} strokeOpacity=".78" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ARCHIVE_SEAL_TRACK_ROTATIONS.map((rotation) => (
          <path
            key={rotation}
            d={ARCHIVE_SEAL_TRACK_PATH}
            transform={`rotate(${rotation} ${ARCHIVE_SEAL_CENTER.x} ${ARCHIVE_SEAL_CENTER.y})`}
          />
        ))}
      </g>
      <g strokeLinecap="round" strokeWidth="1.7">
        {ARCHIVE_SEAL_RAYS.map((ray, index) => (
          <line
            key={index}
            {...ray}
            stroke={ray.color}
          />
        ))}
      </g>
      <path d={ARCHIVE_SEAL_DIAMOND_PATH} fill={ARCHIVE_SEAL_COLORS.copper} />
      <circle cx="20" cy="20" r={ARCHIVE_SEAL_CENTER_RADIUS} fill={ARCHIVE_SEAL_COLORS.teal} />
    </svg>
  );
}

function makeBatch(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.MeshBasicMaterial,
  transforms: SealTransform[],
): SealBatch {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const transform = new THREE.Object3D();
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  transforms.forEach(({ position, rotation }, index) => {
    transform.position.set(...position);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;

  return { name, mesh, geometry, material };
}

/**
 * Authored Meow Ops mark used on the Archive Warden and Session Index Dial.
 * Four long teal rays alternate with four short copper rays inside a broken
 * octagonal track around a copper-and-teal center stone.
 */
export function ArchiveSeal({ size = 1 }: { size?: number }) {
  const batches = useMemo(() => {
    const tracks = Array.from({ length: 4 }, (_, segment) => ({
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, segment * Math.PI / 2 + Math.PI / 4] as [number, number, number],
    }));
    const rays = Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4;
      const longRay = index % 2 === 0;
      const radius = longRay ? 0.45 : 0.41;
      return {
        longRay,
        position: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0.018] as [number, number, number],
        rotation: [0, 0, angle + Math.PI / 2] as [number, number, number],
      };
    });
    const makeMaterial = (color: string, transparent = false, opacity = 1, depthWrite = true) =>
      new THREE.MeshBasicMaterial({ color, transparent, opacity, depthWrite, fog: false });

    return [
      makeBatch(
        'track',
        new THREE.RingGeometry(0.59, 0.65, 8, 1, 0.1, 1.18),
        makeMaterial('#64e5c2', true, 0.72, false),
        tracks,
      ),
      makeBatch(
        'teal-rays',
        new THREE.BoxGeometry(0.075, 0.46, 0.035),
        makeMaterial('#64e5c2', true, 0.86, false),
        rays.filter((ray) => ray.longRay),
      ),
      makeBatch(
        'copper-rays',
        new THREE.BoxGeometry(0.055, 0.31, 0.035),
        makeMaterial('#d7a463', true, 0.86, false),
        rays.filter((ray) => !ray.longRay),
      ),
      makeBatch(
        'copper-center',
        new THREE.PlaneGeometry(0.28, 0.28),
        makeMaterial('#d7a463'),
        [{ position: [0, 0, 0.04], rotation: [0, 0, Math.PI / 4] }],
      ),
      makeBatch(
        'teal-center',
        new THREE.CircleGeometry(0.075, 8),
        makeMaterial('#64e5c2'),
        [{ position: [0, 0, 0.055], rotation: [0, 0, 0] }],
      ),
    ];
  }, []);

  useEffect(() => () => {
    batches.forEach(({ geometry, material }) => {
      geometry.dispose();
      material.dispose();
    });
  }, [batches]);

  return (
    <group scale={size} dispose={null}>
      {batches.map(({ name, mesh }) => <primitive key={name} object={mesh} />)}
    </group>
  );
}
