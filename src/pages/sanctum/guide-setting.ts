import * as THREE from 'three';

export type GuideSetting = THREE.Group & { frameBounds: THREE.Box3 };

/** A quiet architectural alcove sized around the current guide model. */
export function createGuideSetting(floorY = 0, characterHeight = 2.45): GuideSetting {
  const setting = new THREE.Group() as GuideSetting;
  const height = Number.isFinite(characterHeight) && characterHeight > 0 ? characterHeight : 2.45;
  const radius = Math.max(.72, height * .36);
  const archCenterY = floorY + height * .62;
  const archTop = archCenterY + radius;
  const wallBottom = floorY - .18;
  const wallTop = archTop + .24;
  const stone = new THREE.MeshStandardMaterial({ color: '#294441', roughness: .92 });
  const recess = new THREE.MeshStandardMaterial({ color: '#172e31', roughness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b49a63', metalness: .65, roughness: .48 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(radius * 4, wallTop - wallBottom), stone);
  wall.position.set(0, (wallBottom + wallTop) / 2, -.65);
  setting.add(wall);

  const niche = new THREE.Shape();
  niche.moveTo(-radius, floorY - .04);
  niche.lineTo(-radius, archCenterY);
  niche.absarc(0, archCenterY, radius, Math.PI, 0, true);
  niche.lineTo(radius, floorY - .04);
  niche.closePath();
  const inset = new THREE.Mesh(new THREE.ShapeGeometry(niche, 32), recess);
  inset.position.z = -.62;
  setting.add(inset);

  for (const ringRadius of [radius + .025, radius + .065]) {
    const points = [new THREE.Vector3(-ringRadius, floorY - .04, -.59)];
    for (let step = 0; step <= 48; step++) {
      const angle = Math.PI - step / 48 * Math.PI;
      points.push(new THREE.Vector3(Math.cos(angle) * ringRadius, archCenterY + Math.sin(angle) * ringRadius, -.59));
    }
    points.push(new THREE.Vector3(ringRadius, floorY - .04, -.59));
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let index = 1; index < points.length; index++) path.add(new THREE.LineCurve3(points[index - 1], points[index]));
    setting.add(new THREE.Mesh(new THREE.TubeGeometry(path, 96, .006, 5, false), brass));
  }
  for (const x of [-radius * 1.28, radius * 1.28]) {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, .025, 16), brass);
    pedestal.position.set(x, floorY + height * .49, -.4);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.023, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffe0a1' }));
    lamp.scale.y = 1.6;
    lamp.position.set(x, floorY + height * .53, -.4);
    setting.add(pedestal, lamp);
  }
  const lightExtentX = radius * 1.28 + .09;
  const frameTop = Math.max(wallTop, archCenterY + radius + .071);
  setting.frameBounds = new THREE.Box3(
    new THREE.Vector3(-radius * 2, wallBottom, -.656),
    new THREE.Vector3(radius * 2, frameTop, -.377),
  );
  setting.frameBounds.min.x = Math.min(setting.frameBounds.min.x, -lightExtentX);
  setting.frameBounds.max.x = Math.max(setting.frameBounds.max.x, lightExtentX);
  return setting;
}
