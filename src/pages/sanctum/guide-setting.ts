import * as THREE from 'three';

/** A quiet architectural alcove; independent of the combat scene and session data. */
export function createGuideSetting(): THREE.Group {
  const setting = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#294441', roughness: .92 });
  const recess = new THREE.MeshStandardMaterial({ color: '#172e31', roughness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b49a63', metalness: .65, roughness: .48 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), stone);
  wall.position.set(0, 1.5, -.65);
  setting.add(wall);

  const niche = new THREE.Shape();
  niche.moveTo(-.56, .85);
  niche.lineTo(-.56, 1.5);
  niche.absarc(0, 1.5, .56, Math.PI, 0, true);
  niche.lineTo(.56, .85);
  niche.closePath();
  const inset = new THREE.Mesh(new THREE.ShapeGeometry(niche, 32), recess);
  inset.position.z = -.62;
  setting.add(inset);

  for (const radius of [.57, .61]) {
    const points = [new THREE.Vector3(-radius, .85, -.59)];
    for (let step = 0; step <= 48; step++) {
      const angle = Math.PI - step / 48 * Math.PI;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 1.5 + Math.sin(angle) * radius, -.59));
    }
    points.push(new THREE.Vector3(radius, .85, -.59));
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let index = 1; index < points.length; index++) path.add(new THREE.LineCurve3(points[index - 1], points[index]));
    setting.add(new THREE.Mesh(new THREE.TubeGeometry(path, 96, .006, 5, false), brass));
  }
  for (const x of [-.74, .74]) {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, .025, 16), brass);
    pedestal.position.set(x, 1.23, -.4);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.023, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffe0a1' }));
    lamp.scale.y = 1.6;
    lamp.position.set(x, 1.27, -.4);
    setting.add(pedestal, lamp);
  }
  return setting;
}
