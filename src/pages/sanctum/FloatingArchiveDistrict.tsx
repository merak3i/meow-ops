import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ArchiveSeal } from './ArchiveSeal';
import { usePerfLevel } from './perf';

const ARCHIVE_TERRACES = [
  { screenX: -7.8, screenY: -0.65, depth: 1.1, scale: 0.95, yaw: -0.12, facets: 9 },
  { screenX: -3.9, screenY: 1.1, depth: -0.8, scale: 1.1, yaw: 0.18, facets: 10 },
  { screenX: 0, screenY: -0.15, depth: 0.4, scale: 1.48, yaw: 0.04, facets: 8 },
  { screenX: 3.8, screenY: 1.3, depth: -1.3, scale: 1.08, yaw: -0.2, facets: 11 },
  { screenX: 7.6, screenY: -0.35, depth: 0.95, scale: 0.96, yaw: 0.14, facets: 9 },
] as const;
const CLOUD_MOUNDS = [
  { x: -10, y: -0.35, width: 3.4, height: 0.56, depth: 1.8 },
  { x: -6.8, y: 0.05, width: 2.8, height: 0.62, depth: 1.5 },
  { x: -3.8, y: -0.5, width: 3.2, height: 0.54, depth: 1.7 },
  { x: -0.7, y: 0.12, width: 3.5, height: 0.64, depth: 1.6 },
  { x: 2.7, y: -0.45, width: 3.1, height: 0.54, depth: 1.8 },
  { x: 6, y: 0.08, width: 3.2, height: 0.6, depth: 1.6 },
  { x: 9.1, y: -0.35, width: 3.4, height: 0.56, depth: 1.7 },
] as const;
const SKYLINE_CENTER_X = 0;
const SKYLINE_SCREEN_Y = 3.2;
const SKYLINE_DEPTH = 4;
const ARCHITECTURE_HEIGHT_FACTOR = 0.9;

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

function toUnindexed(geometry: THREE.BufferGeometry) {
  const unindexed = geometry.toNonIndexed();
  geometry.dispose();
  return unindexed;
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

export function FloatingArchiveDistrict({ cameraTarget }: { cameraTarget: THREE.Vector3 }) {
  const perf = usePerfLevel();
  const camera = useThree(state => state.camera);
  const cameraBasis = useMemo(() => {
    const forward = cameraTarget.clone().sub(camera.position).normalize();
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(forward).normalize();
    return { right, up, forward };
  }, [camera, cameraTarget]);
  const skylineBase = useMemo(() => cameraBasis.right.clone().multiplyScalar(SKYLINE_CENTER_X)
    .addScaledVector(cameraBasis.up, SKYLINE_SCREEN_Y)
    .addScaledVector(cameraBasis.forward, SKYLINE_DEPTH), [cameraBasis]);
  const pavilionYaw = Math.atan2(-cameraBasis.forward.x, -cameraBasis.forward.z);
  const sealPosition = useMemo(() => {
    const centerScale = ARCHIVE_TERRACES[2].scale;
    const forumSurfaceHeight = 0.31 * centerScale * ARCHITECTURE_HEIGHT_FACTOR + 0.035 * centerScale;
    return skylineBase.clone().add(new THREE.Vector3(0, forumSurfaceHeight + 0.003, 0));
  }, [skylineBase]);
  const geometries = useMemo(() => {
    const stone: THREE.BufferGeometry[] = [];
    const copper: THREE.BufferGeometry[] = [];
    const light: THREE.BufferGeometry[] = [];
    const garden: THREE.BufferGeometry[] = [];
    const clouds: THREE.BufferGeometry[] = [];
    const visibleIslands = perf === 'low' ? [0, 2, 4] : ARCHIVE_TERRACES.map((_, index) => index);
    const { right: cameraRight, up: cameraUp, forward: cameraForward } = cameraBasis;
    const towardViewer = cameraForward.clone().negate();
    const cloudRotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(cameraRight, cameraUp, towardViewer),
    );
    const islandCenters = visibleIslands.map(index => {
      const island = ARCHIVE_TERRACES[index]!;
      return skylineBase.clone()
        .addScaledVector(cameraRight, island.screenX)
        .addScaledVector(cameraUp, island.screenY)
        .addScaledVector(cameraForward, island.depth);
    });

    for (let visibleIndex = 0; visibleIndex < visibleIslands.length; visibleIndex += 1) {
      const index = visibleIslands[visibleIndex]!;
      const island = ARCHIVE_TERRACES[index]!;
      const scale = island.scale;
      const center = islandCenters[visibleIndex]!;
      const radialSegments = perf === 'low' ? 8 : island.facets;
      const position = (height: number) => center.clone()
        .add(new THREE.Vector3(0, height * scale * ARCHITECTURE_HEIGHT_FACTOR, 0));
      const point = (x: number, height: number, z: number) => center.clone()
        .addScaledVector(cameraRight, x * scale)
        .addScaledVector(towardViewer, z * scale)
        .add(new THREE.Vector3(0, height * scale * ARCHITECTURE_HEIGHT_FACTOR, 0));

      // Broad, faceted terraces and shallow undersides keep the district
      // floating while moving its silhouette away from a pointed skyline.
      place(stone, new THREE.CylinderGeometry(1.35 * scale, 1.48 * scale, 0.42 * scale, radialSegments), position(0), island.yaw);
      place(stone, new THREE.ConeGeometry(1.3 * scale, 1.85 * scale, radialSegments), position(-1.05), island.yaw, Math.PI);
      place(copper, new THREE.CylinderGeometry(1.38 * scale, 1.38 * scale, 0.1 * scale, radialSegments), position(0.23), island.yaw);

      if (index === 2) {
        // An open octagonal forum anchors the skyline. Its blank center takes
        // the authored Archive Seal below; generated concepts never redraw it.
        place(stone, new THREE.CylinderGeometry(1.22 * scale, 1.28 * scale, 0.07 * scale, 8), position(0.31), island.yaw);
        place(copper, new THREE.TorusGeometry(1.12 * scale, 0.035 * scale, 6, 24), position(0.36), island.yaw, Math.PI / 2);
      }

      const isCenter = index === 2;
      const width = isCenter ? 2.85 : 2.05;
      const depth = isCenter ? 1.7 : 1.3;
      const pavilionHeight = isCenter ? 3 : 1.8;
      const pavilionX = isCenter ? -0.18 : (index < 2 ? 0.16 : -0.16);
      const pavilionZ = isCenter ? -0.72 : -0.12;
      const floorHeight = 0.36;
      const roofHeight = floorHeight + pavilionHeight;

      place(stone, new THREE.BoxGeometry(width * scale, 0.1 * scale, depth * scale),
        point(pavilionX, floorHeight, pavilionZ), pavilionYaw);

      for (const xSide of [-1, 1]) {
        for (const zSide of [-1, 1]) {
          place(stone, new THREE.CylinderGeometry(0.055 * scale, 0.075 * scale, pavilionHeight * 0.82 * scale, 6),
            point(pavilionX + xSide * width * 0.34, floorHeight + pavilionHeight * 0.46, pavilionZ + zSide * depth * 0.32));
        }
      }

      // Shallow roof caps and open arcades read as public reading pavilions,
      // rather than towers or a walled fortress.
      place(stone, new THREE.TorusGeometry(width * 0.34 * scale, 0.04 * scale, 5, 16, Math.PI),
        point(pavilionX, floorHeight + pavilionHeight * 0.74, pavilionZ + depth * 0.34), pavilionYaw);
      place(stone, new THREE.BoxGeometry(width * 1.15 * scale, 0.14 * scale, depth * 1.16 * scale),
        point(pavilionX, roofHeight, pavilionZ), pavilionYaw);
      place(copper, new THREE.CylinderGeometry(width * 0.42 * scale, width * 0.5 * scale, 0.12 * scale, 8),
        point(pavilionX, roofHeight + 0.11, pavilionZ), island.yaw);

      // Stepped observatory spires give the floating archive a clear skyline.
      // Their open copper crowns and teal cores keep the silhouette distinct
      // from a conventional pointed-tower fantasy city.
      const spires = index === 2
        ? [
            { x: -0.76, z: -0.46, height: 2.05, radius: 0.34 },
            { x: 0.78, z: -0.56, height: 1.7, radius: 0.29 },
          ]
        : [{ x: index % 2 === 0 ? 0.28 : -0.28, z: -0.32, height: index === 1 || index === 3 ? 1.55 : 1.35, radius: 0.25 }];

      for (const spire of spires) {
        const spireBase = roofHeight - 0.04;
        const spirePoint = (height: number) => point(spire.x, spireBase + height, spire.z);
        place(stone, new THREE.CylinderGeometry(spire.radius * 0.7 * scale, spire.radius * scale, spire.height * 0.2 * scale, 8),
          spirePoint(spire.height * 0.1), island.yaw);
        place(stone, new THREE.CylinderGeometry(spire.radius * 0.48 * scale, spire.radius * 0.7 * scale, spire.height * 0.54 * scale, 8),
          spirePoint(spire.height * 0.47), island.yaw);
        place(copper, new THREE.CylinderGeometry(spire.radius * 0.82 * scale, spire.radius * 0.82 * scale, 0.09 * scale, 8),
          spirePoint(spire.height * 0.76), island.yaw);
        place(stone, new THREE.CylinderGeometry(spire.radius * 0.48 * scale, spire.radius * 0.54 * scale, spire.height * 0.18 * scale, 8),
          spirePoint(spire.height * 0.88), island.yaw);
        place(copper, new THREE.TorusGeometry(spire.radius * 0.78 * scale, 0.026 * scale, 5, 16),
          spirePoint(spire.height * 0.96), island.yaw, Math.PI / 2);

        for (let fin = 0; fin < 4; fin += 1) {
          const angle = Math.PI / 4 + fin * Math.PI / 2;
          place(stone, new THREE.BoxGeometry(0.055 * scale, 0.24 * scale, 0.055 * scale),
            point(
              spire.x + Math.cos(angle) * spire.radius * 0.58,
              spireBase + spire.height * 0.91,
              spire.z + Math.sin(angle) * spire.radius * 0.58,
            ));
        }

        const spireWindow = toUnindexed(new THREE.BoxGeometry(
          0.09 * scale, spire.height * 0.3 * scale, 0.035 * scale,
        ));
        spireWindow.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), towardViewer,
        ));
        spireWindow.translate(...spirePoint(spire.height * 0.48).addScaledVector(towardViewer, spire.radius * 0.52 * scale).toArray());
        light.push(spireWindow);
        place(light, new THREE.IcosahedronGeometry(0.16 * scale, 0), spirePoint(spire.height * 1.08));
      }

      const gardenSide = index % 2 === 0 ? 1 : -1;
      const gardenX = gardenSide * width * 0.37;
      const gardenZ = depth * 0.37;
      place(stone, new THREE.BoxGeometry(0.58 * scale, 0.12 * scale, 0.48 * scale),
        point(gardenX, 0.32, gardenZ), island.yaw);
      place(garden, toUnindexed(new THREE.CylinderGeometry(0.035 * scale, 0.045 * scale, 0.36 * scale, 5)),
        point(gardenX, 0.55, gardenZ));
      place(garden, new THREE.IcosahedronGeometry(0.23 * scale, 0),
        point(gardenX, 0.77, gardenZ));

      const frontWindow = toUnindexed(new THREE.BoxGeometry(0.38 * scale, 0.32 * scale, 0.04 * scale));
      frontWindow.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), towardViewer,
      ));
      frontWindow.translate(...point(pavilionX, floorHeight + pavilionHeight * 0.48, pavilionZ + depth * 0.43).toArray());
      light.push(frontWindow);
    }

    for (let index = 0; index < islandCenters.length - 1; index += 1) {
      const left = islandCenters[index]!;
      const right = islandCenters[index + 1]!;
      const midpoint = left.clone().lerp(right, 0.5).addScaledVector(cameraUp, 0.22);
      const bridgeDirection = right.clone().sub(left).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const bridgeUp = worldUp.clone().addScaledVector(bridgeDirection, -worldUp.dot(bridgeDirection)).normalize();
      const bridgeSide = bridgeDirection.clone().cross(bridgeUp).normalize();
      const bridgeBasis = new THREE.Matrix4().makeBasis(bridgeDirection, bridgeUp, bridgeSide);
      const bridgeRotation = new THREE.Quaternion().setFromRotationMatrix(bridgeBasis);
      const bridgeLength = left.distanceTo(right);
      const bridge = new THREE.BoxGeometry(bridgeLength + 0.5, 0.1, 0.34);
      bridge.applyQuaternion(bridgeRotation);
      bridge.translate(...midpoint.toArray());
      stone.push(bridge);

      for (const side of [-1, 1]) {
        const rail = new THREE.BoxGeometry(bridgeLength + 0.45, 0.055, 0.045);
        rail.applyQuaternion(bridgeRotation);
        rail.translate(...midpoint.clone().addScaledVector(bridgeSide, side * 0.19).addScaledVector(bridgeUp, 0.08).toArray());
        copper.push(rail);
      }
    }

    for (const mound of CLOUD_MOUNDS) {
      const cloud = new THREE.SphereGeometry(1, 10, 7);
      cloud.scale(mound.width, mound.height, mound.depth);
      cloud.applyQuaternion(cloudRotation);
      const cloudCenter = skylineBase.clone()
        .addScaledVector(cameraRight, mound.x)
        .addScaledVector(cameraUp, mound.y)
        .addScaledVector(cameraForward, 3.6);
      cloud.translate(...cloudCenter.toArray());
      clouds.push(cloud);
    }

    return [merge(stone), merge(copper), merge(light), merge(garden), merge(clouds)] as const;
  }, [cameraBasis, perf, skylineBase]);

  useEffect(() => () => geometries.forEach(geometry => geometry.dispose()), [geometries]);

  return (
    <group>
      <mesh geometry={geometries[0]}>
        <meshStandardMaterial color="#e2d9c8" emissive="#342d20" emissiveIntensity={0.18}
          roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh geometry={geometries[1]}>
        <meshStandardMaterial color="#ad8052" roughness={0.68} metalness={0.3} />
      </mesh>
      <mesh geometry={geometries[2]}>
        <meshBasicMaterial color="#68d8be" transparent opacity={0.48}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh geometry={geometries[3]}>
        <meshStandardMaterial color="#71866a" roughness={0.92} metalness={0.02} />
      </mesh>
      <mesh geometry={geometries[4]} renderOrder={-1}>
        <meshBasicMaterial color="#a7c9c1" transparent opacity={0.28}
          depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group position={sealPosition.toArray()} rotation={[-Math.PI / 2, 0, 0]}>
        <ArchiveSeal size={1.12} />
      </group>
    </group>
  );
}
