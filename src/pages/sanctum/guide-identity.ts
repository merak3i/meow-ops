import * as THREE from 'three';

const SKIN_TINT = '#6b99c4';
const ARCHIVE_SEAL_OBJECT_NAME = 'guidearchivesealv33';
const ARCHIVE_SEAL_MESH_NAME = 'archivesealexactgeometryv33';
const ARCHIVE_SEAL_SCALE = 1.65;
const YOKE_OBJECT_NAME = 'guideasymmetricarchiveshoulderyokev102';
const PAGE_TABS_OBJECT_NAME = 'guidethreearchivepagecornertabsv102';

function normalizeMeshName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function applyKrishnaGuideIdentity(model: THREE.Object3D): void {
  const head = model.getObjectByName('head');
  const fluteHand = model.getObjectByName('hand_r');
  const pelvis = model.getObjectByName('pelvis');
  if (!head || !fluteHand || !pelvis) throw new Error('Guide identity bones missing');

  let tintedSkin = false;
  let indigoCoat = false;
  let indigoTrousers = false;
  const yokeMeshes: THREE.Mesh[] = [];
  const pageTabMeshes: THREE.Mesh[] = [];
  const archiveSealMeshes: THREE.Mesh[] = [];
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const normalizedName = normalizeMeshName(object.name);
    if (normalizedName.startsWith(ARCHIVE_SEAL_OBJECT_NAME)
      || normalizedName.startsWith(ARCHIVE_SEAL_MESH_NAME)) archiveSealMeshes.push(object);
    if (normalizedName === YOKE_OBJECT_NAME) yokeMeshes.push(object);
    if (normalizedName === PAGE_TABS_OBJECT_NAME) pageTabMeshes.push(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!('color' in material)) continue;
      if (material.name === 'Guide.Body.body.001') {
        tintSkinMaterial(material);
        tintedSkin = true;
      } else if (material.name === 'Guide | original archive coat charcoal v50') {
        material.color.set('#4e6898');
        indigoCoat = true;
      } else if (material.name === 'Guide | original archive trousers charcoal v50') {
        material.color.set('#344b70');
        indigoTrousers = true;
      }
    }
  });
  for (const mesh of yokeMeshes) mesh.material = recolorIndependent(mesh.material, '#9a744d');
  for (const mesh of pageTabMeshes) mesh.material = recolorIndependent(mesh.material, '#bd8750');
  for (const mesh of archiveSealMeshes) emphasizeArchiveSeal(mesh);
  const wovenYoke = yokeMeshes.length > 0;
  const copperPageTabs = pageTabMeshes.length > 0;
  if (!tintedSkin || !indigoCoat || !indigoTrousers || !wovenYoke || !copperPageTabs || !archiveSealMeshes.length) {
    throw new Error('Guide identity materials missing');
  }

  const coatTails = createAsymmetricCoatTails();
  coatTails.name = 'Guide.Krishna-inspired asymmetric archive coat tails';
  pelvis.add(coatTails);

  const feather = createPeacockFeather();
  feather.name = 'Guide.Krishna-inspired peacock feather';
  feather.position.set(0.11, 0.16, 0.035);
  feather.scale.setScalar(0.78);
  feather.rotation.z = -0.22;
  head.add(feather);

  const flute = createBambooFlute();
  flute.name = 'Guide.Krishna-inspired bamboo page pointer';
  flute.position.set(0, 0.025, 0.105);
  flute.scale.setScalar(1.18);
  model.updateMatrixWorld(true);
  const handWorldRotation = fluteHand.getWorldQuaternion(new THREE.Quaternion());
  const horizontalFrontRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  flute.quaternion.copy(handWorldRotation.invert().multiply(horizontalFrontRotation));
  fluteHand.add(flute);
}

function emphasizeArchiveSeal(mesh: THREE.Mesh): void {
  // Enlarge the existing two-part chest mark in its own plane for legibility;
  // the source GLB stays unchanged and the Seal keeps its exact silhouette.
  const geometry = mesh.geometry.clone();
  const position = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const center = geometry.boundingBox?.getCenter(new THREE.Vector3());
  if (!center || position.count === 0) throw new Error('Guide Archive Seal geometry missing');

  for (let index = 0; index < position.count; index += 1) {
    position.setXY(
      index,
      center.x + (position.getX(index) - center.x) * ARCHIVE_SEAL_SCALE,
      center.y + (position.getY(index) - center.y) * ARCHIVE_SEAL_SCALE,
    );
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.geometry = geometry;
}

function tintSkinMaterial(material: THREE.Material & { color: THREE.Color; map?: THREE.Texture | null }): void {
  const texture = material.map;
  const image = texture?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (texture && image && image.width && image.height && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(image, 0, 0);
      context.globalCompositeOperation = 'color';
      context.fillStyle = SKIN_TINT;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-atop';
      context.fillStyle = 'rgba(137, 165, 196, 0.46)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      texture.image = canvas;
      texture.needsUpdate = true;
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
      material.color.set('#ffffff');
      return;
    }
  }
  material.color.set(SKIN_TINT);
}

function createPeacockFeather(): THREE.Group {
  const feather = new THREE.Group();
  const blade = new THREE.Shape();
  blade.moveTo(0, 0);
  blade.quadraticCurveTo(-0.035, 0.105, -0.052, 0.205);
  blade.quadraticCurveTo(-0.01, 0.285, 0.035, 0.29);
  blade.quadraticCurveTo(0.075, 0.22, 0.044, 0.12);
  blade.quadraticCurveTo(0.018, 0.045, 0, 0);
  const bladeMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(blade, 12),
    new THREE.MeshStandardMaterial({ color: '#176b58', roughness: 0.8, side: THREE.DoubleSide }),
  );
  bladeMesh.name = 'Guide.Peacock feather blade';
  bladeMesh.position.z = 0.002;
  feather.add(bladeMesh);

  const shaft = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.008),
      new THREE.Vector3(0.009, 0.12, 0.008),
      new THREE.Vector3(0.012, 0.265, 0.008),
    ]), 12, 0.003, 5, false),
    new THREE.MeshStandardMaterial({ color: '#cf9d48', roughness: 0.75 }),
  );
  shaft.name = 'Guide.Peacock feather shaft';
  feather.add(shaft);

  const eyeLayers = [
    { color: '#14564f', scale: [0.027, 0.046] as const, z: 0.012 },
    { color: '#c28c3c', scale: [0.020, 0.036] as const, z: 0.014 },
    { color: '#153a62', scale: [0.014, 0.027] as const, z: 0.016 },
    { color: '#38a6ae', scale: [0.007, 0.016] as const, z: 0.018 },
  ];
  eyeLayers.forEach(({ color, scale, z }, index) => {
    const eye = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    );
    eye.name = index === eyeLayers.length - 1 ? 'Guide.Peacock feather eye' : 'Guide.Peacock feather eye layer';
    eye.scale.set(scale[0], scale[1], 1);
    eye.position.set(0.012, 0.225, z);
    feather.add(eye);
  });
  return feather;
}

function createBambooFlute(): THREE.Group {
  const flute = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: '#c5a36a', roughness: 0.78 }),
  );
  body.name = 'Guide.Bamboo flute body';
  flute.add(body);

  for (const y of [-0.2, 0.2]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.017, 0.012, 12),
      new THREE.MeshStandardMaterial({ color: '#9c643b', roughness: 0.58, metalness: 0.18 }),
    );
    band.name = 'Guide.Bamboo flute copper binding';
    band.position.y = y;
    flute.add(band);
  }
  for (const y of [-0.15, -0.09, -0.03, 0.03, 0.09, 0.15]) {
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.007, 10),
      new THREE.MeshBasicMaterial({ color: '#47382a', side: THREE.DoubleSide }),
    );
    hole.name = 'Guide.Bamboo flute finger hole';
    hole.position.set(0, y, 0.017);
    flute.add(hole);
  }
  return flute;
}

function createAsymmetricCoatTails(): THREE.Group {
  const tails = new THREE.Group();
  const makePanel = (points: readonly [number, number][], color: string, z: number, name: string) => {
    const shape = new THREE.Shape();
    shape.moveTo(...points[0]!);
    for (const point of points.slice(1)) shape.lineTo(...point);
    shape.closePath();
    const panel = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.025,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelSize: 0.008,
        bevelThickness: 0.008,
        steps: 1,
      }),
      new THREE.MeshStandardMaterial({ color, roughness: 0.96, side: THREE.DoubleSide }),
    );
    panel.name = name;
    panel.position.z = z;
    tails.add(panel);
  };

  makePanel(
    [[-0.32, 0.08], [0.16, 0.08], [0.11, -0.38], [-0.03, -0.8], [-0.4, -0.67], [-0.35, -0.16]],
    '#344b78', 0.13, 'Guide.Asymmetric indigo coat panel',
  );
  makePanel(
    [[0.08, 0.06], [0.34, 0.05], [0.42, -0.46], [0.2, -0.55], [0.12, -0.3]],
    '#293c68', 0.16, 'Guide.Short archive coat panel',
  );
  makePanel(
    [[-0.385, 0.02], [-0.345, 0.02], [-0.36, -0.64], [-0.405, -0.66]],
    '#b9854f', 0.166, 'Guide.Restrained saffron coat lining',
  );
  return tails;
}

function recolorIndependent(material: THREE.Material | THREE.Material[], color: string): THREE.Material | THREE.Material[] {
  const recolor = (source: THREE.Material) => {
    const copy = source.clone();
    const colorMaterial = copy as THREE.Material & { color?: THREE.Color };
    colorMaterial.color?.set(color);
    return copy;
  };
  return Array.isArray(material) ? material.map(recolor) : recolor(material);
}
