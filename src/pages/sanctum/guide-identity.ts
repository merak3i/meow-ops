import * as THREE from 'three';

const ARCHIVE_SEAL_OBJECT_NAME = 'guidearchivesealv33';
const ARCHIVE_SEAL_MESH_NAME = 'archivesealexactgeometryv33';
const ARCHIVE_SEAL_SCALE = 1.65;
const YOKE_OBJECT_NAME = 'guideasymmetricarchiveshoulderyokev102';
const PAGE_TABS_OBJECT_NAME = 'guidethreearchivepagecornertabsv102';

function normalizeMeshName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function applyOriginalizedGuideIdentity(model: THREE.Object3D): void {
  let charcoalCoat = false;
  let charcoalTrousers = false;
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
      if (material.name === 'Guide | original archive coat charcoal v50') charcoalCoat = true;
      if (material.name === 'Guide | original archive trousers charcoal v50') charcoalTrousers = true;
    }
  });

  if (!charcoalCoat || !charcoalTrousers || !yokeMeshes.length || !pageTabMeshes.length || !archiveSealMeshes.length) {
    throw new Error('Guide originalized archive elements missing');
  }

  for (const mesh of yokeMeshes) mesh.material = recolorIndependent(mesh.material, '#9a744d');
  for (const mesh of pageTabMeshes) mesh.material = recolorIndependent(mesh.material, '#bd8750');
  for (const mesh of archiveSealMeshes) emphasizeArchiveSeal(mesh);
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

function recolorIndependent(material: THREE.Material | THREE.Material[], color: string): THREE.Material | THREE.Material[] {
  const recolor = (source: THREE.Material) => {
    const copy = source.clone();
    const colorMaterial = copy as THREE.Material & { color?: THREE.Color };
    colorMaterial.color?.set(color);
    return copy;
  };
  return Array.isArray(material) ? material.map(recolor) : recolor(material);
}
