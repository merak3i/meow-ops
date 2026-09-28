import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ArchiveSeal } from './ArchiveSeal';
import { usePerfLevel } from './perf';

const SKY_ISLANDS = [
  { screenX: -5, scale: 0.34 },
  { screenX: -2.5, scale: 0.38 },
  { screenX: 0, scale: 0.4 },
  { screenX: 2.5, scale: 0.38 },
  { screenX: 5, scale: 0.34 },
] as const;
const SKYLINE_CENTER_X = 1.5;
const SKYLINE_SCREEN_Y = 3.7;
const SKYLINE_DEPTH = 3.5;
const TOWER_HEIGHT_FACTOR = 0.65;
const SEAL_HEIGHT = 8.9;

function place(
  parts: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry,
  position: THREE.Vector3,
  rotationY = 0,
  rotationX = 0,
  rotationZ = 0,
) {
  geometry.rotateX(rotationX);
  geometry.rotateY(rotationY);
  geometry.rotateZ(rotationZ);
  geometry.translate(position.x, position.y, position.z);
  parts.push(geometry);
}

function merge(parts: THREE.BufferGeometry[]) {
  if (!parts.length) return new THREE.BufferGeometry();
  try {
    const result = mergeGeometries(parts, false);
    if (!result) throw new Error('Floating archive geometry could not be merged');
    return result;
  } finally {
    parts.forEach(part => part.dispose());
  }
}

export function FloatingArchiveDistrict() {
  const perf = usePerfLevel();
  const camera = useThree(state => state.camera);
  const cameraBasis = useMemo(() => ({
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize(),
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize(),
  }), [camera]);
  const skylineBase = useMemo(() => cameraBasis.right.clone().multiplyScalar(SKYLINE_CENTER_X)
    .addScaledVector(cameraBasis.up, SKYLINE_SCREEN_Y)
    .addScaledVector(cameraBasis.forward, -SKYLINE_DEPTH), [cameraBasis]);
  const beaconPosition = useMemo(() => skylineBase.clone()
    .add(new THREE.Vector3(0, SEAL_HEIGHT * SKY_ISLANDS[2].scale * TOWER_HEIGHT_FACTOR + 0.15, 0)), [skylineBase]);
  const beaconYaw = Math.atan2(-cameraBasis.forward.x, -cameraBasis.forward.z);
  const geometries = useMemo(() => {
    const stone: THREE.BufferGeometry[] = [];
    const copper: THREE.BufferGeometry[] = [];
    const light: THREE.BufferGeometry[] = [];
    const visibleIslands = perf === 'low' ? [0, 2, 4] : SKY_ISLANDS.map((_, index) => index);
    const radialSegments = perf === 'low' ? 6 : 8;
    const { right: cameraRight, up: cameraUp, forward: cameraForward } = cameraBasis;
    const towardViewer = cameraForward.clone().negate();
    const islandCenters = visibleIslands.map(index => {
      const island = SKY_ISLANDS[index]!;
      return skylineBase.clone().addScaledVector(cameraRight, island.screenX);
    });

    for (let visibleIndex = 0; visibleIndex < visibleIslands.length; visibleIndex += 1) {
      const index = visibleIslands[visibleIndex]!;
      const island = SKY_ISLANDS[index]!;
      const scale = island.scale;
      const center = islandCenters[visibleIndex]!;
      const position = (height: number) => center.clone()
        .add(new THREE.Vector3(0, height * scale * TOWER_HEIGHT_FACTOR, 0));

      place(stone, new THREE.CylinderGeometry(2.2 * scale, 2.55 * scale, 0.58 * scale, radialSegments), position(0));
      place(stone, new THREE.ConeGeometry(1.9 * scale, 3.2 * scale, radialSegments), position(-1.7), 0, Math.PI);
      place(stone, new THREE.CylinderGeometry(1.12 * scale, 1.38 * scale, 3.1 * scale, radialSegments), position(1.85));
      place(stone, new THREE.CylinderGeometry(0.76 * scale, 0.96 * scale, 2.45 * scale, radialSegments), position(4.55));
      place(stone, new THREE.ConeGeometry(1.48 * scale, 1.55 * scale, radialSegments), position(6.55));
      place(stone, new THREE.CylinderGeometry(0.1 * scale, 0.16 * scale, 1.8 * scale, 5), position(7.85));

      place(copper, new THREE.CylinderGeometry(2.28 * scale, 2.28 * scale, 0.12 * scale, radialSegments), position(0.3));
      place(copper, new THREE.CylinderGeometry(1.28 * scale, 1.4 * scale, 0.14 * scale, radialSegments), position(3.18));
      place(copper, new THREE.CylinderGeometry(0.98 * scale, 1.02 * scale, 0.12 * scale, radialSegments), position(5.82));

      for (const height of [1.92, 4.45]) {
        const window = new THREE.BoxGeometry(height === 1.92 ? 0.16 * scale : 0.11 * scale,
          height === 1.92 ? 0.8 * scale : 0.56 * scale, 0.05 * scale);
        window.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), towardViewer,
        ));
        window.translate(...position(height).addScaledVector(towardViewer, 1.26 * scale).toArray());
        light.push(window);
      }
    }

    for (let index = 0; index < islandCenters.length - 1; index += 1) {
      const left = islandCenters[index]!;
      const right = islandCenters[index + 1]!;
      const bridge = new THREE.BoxGeometry(left.distanceTo(right) + 0.35, 0.12, 0.28);
      bridge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(1, 0, 0), cameraRight,
      ));
      bridge.translate(...left.clone().lerp(right, 0.5).addScaledVector(cameraUp, 0.55).toArray());
      copper.push(bridge);
    }

    return [merge(stone), merge(copper), merge(light)] as const;
  }, [cameraBasis, perf, skylineBase]);

  useEffect(() => () => geometries.forEach(geometry => geometry.dispose()), [geometries]);

  return (
    <group>
      <mesh geometry={geometries[0]}>
        <meshStandardMaterial color="#62677a" roughness={0.88} metalness={0.08} />
      </mesh>
      <mesh geometry={geometries[1]}>
        <meshStandardMaterial color="#927450" roughness={0.66} metalness={0.34} />
      </mesh>
      <mesh geometry={geometries[2]}>
        <meshBasicMaterial color="#68d8be" transparent opacity={0.64}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <group position={beaconPosition.toArray()} rotation={[0, beaconYaw, 0]}>
        <ArchiveSeal size={0.9} />
      </group>
    </group>
  );
}
