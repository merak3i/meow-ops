import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface GltfSourceLease {
  readonly promise: Promise<GLTF>;
  release(): void;
}

export interface GltfSourceCache {
  acquire(url: string): GltfSourceLease;
}

export function createGltfSourceCache(
  loadSource: (url: string) => Promise<GLTF>,
): GltfSourceCache;
