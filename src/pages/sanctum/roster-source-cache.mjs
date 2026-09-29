import * as THREE from 'three';

function disposeGltfSource(gltf) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();
  const images = new Set();
  const visited = new Set();

  const collectTextures = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (value.isTexture) {
      textures.add(value);
      if (typeof value.image?.close === 'function') images.add(value.image);
      return;
    }
    for (const nested of Object.values(value)) collectTextures(nested);
  };

  const scenes = gltf.scenes?.length ? gltf.scenes : [gltf.scene];
  for (const scene of scenes) {
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        materials.add(material);
        collectTextures(material);
      }
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    });
  }

  textures.forEach(texture => texture.dispose());
  geometries.forEach(geometry => geometry.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
  materials.forEach(material => material.dispose());
  images.forEach(image => image.close());
}

/** Share a GLTF source among live instances, then free its shared resources. */
export function createGltfSourceCache(loadSource) {
  const entries = new Map();

  function disposeEntry(key, entry) {
    if (entries.get(key) === entry) entries.delete(key);
    if (!entry.hasValue) return;
    const source = entry.value;
    entry.value = undefined;
    entry.hasValue = false;
    disposeGltfSource(source);
  }

  return {
    acquire(key) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { leases: 0, value: undefined, hasValue: false, promise: undefined };
        const createdEntry = entry;
        createdEntry.promise = Promise.resolve()
          .then(() => loadSource(key))
          .then(source => {
            createdEntry.value = source;
            createdEntry.hasValue = true;
            if (createdEntry.leases === 0) disposeEntry(key, createdEntry);
            return source;
          }, error => {
            if (entries.get(key) === createdEntry) entries.delete(key);
            throw error;
          });
        entries.set(key, createdEntry);
      }

      entry.leases += 1;
      let released = false;
      return {
        promise: entry.promise,
        release() {
          if (released) return;
          released = true;
          entry.leases -= 1;
          if (entry.leases === 0 && entry.hasValue) disposeEntry(key, entry);
        },
      };
    },
  };
}
