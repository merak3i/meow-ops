import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, BoxGeometry, MeshBasicMaterial, Scene, Skeleton, SkinnedMesh, Texture } from 'three';
import { createGltfSourceCache } from '../roster-source-cache.mjs';

function createGltfFixture() {
  const counts = { geometry: 0, material: 0, texture: 0, image: 0 };
  const image = { close: () => { counts.image += 1; } };
  const texture = new Texture(image);
  const geometry = new BoxGeometry();
  const material = new MeshBasicMaterial({ map: texture });
  const bone = new Bone();
  const skeleton = new Skeleton([bone]);
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bone);
  mesh.bind(skeleton);
  skeleton.computeBoneTexture();
  const scene = new Scene();
  scene.add(mesh);
  geometry.addEventListener('dispose', () => { counts.geometry += 1; });
  material.addEventListener('dispose', () => { counts.material += 1; });
  texture.addEventListener('dispose', () => { counts.texture += 1; });
  return { gltf: { scene, scenes: [scene] }, counts, skeleton };
}

test('shared roster GLTF stays live until the last instance releases it', async () => {
  const fixture = createGltfFixture();
  let loads = 0;
  const cache = createGltfSourceCache(async () => {
    loads += 1;
    return fixture.gltf;
  });

  const first = cache.acquire('/design/first.glb');
  const second = cache.acquire('/design/first.glb');
  assert.equal(await first.promise, fixture.gltf);
  assert.equal(await second.promise, fixture.gltf);
  assert.equal(loads, 1);

  first.release();
  assert.deepEqual(fixture.counts, { geometry: 0, material: 0, texture: 0, image: 0 });
  assert.ok(fixture.skeleton.boneTexture);
  second.release();
  second.release();
  assert.deepEqual(fixture.counts, { geometry: 1, material: 1, texture: 1, image: 1 });
  assert.equal(fixture.skeleton.boneTexture, null);
});

test('a source released before loading finishes is disposed when it arrives', async () => {
  const fixture = createGltfFixture();
  let resolveSource;
  const cache = createGltfSourceCache(
    () => new Promise(resolve => { resolveSource = resolve; }),
  );

  const lease = cache.acquire('/design/late.glb');
  lease.release();
  await Promise.resolve();
  resolveSource(fixture.gltf);

  assert.equal(await lease.promise, fixture.gltf);
  assert.deepEqual(fixture.counts, { geometry: 1, material: 1, texture: 1, image: 1 });
});

test('a failed source load can be retried', async () => {
  const fixture = createGltfFixture();
  let attempts = 0;
  const cache = createGltfSourceCache(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary load failure');
    return fixture.gltf;
  });

  const failed = cache.acquire('/design/retry.glb');
  await assert.rejects(failed.promise, /temporary load failure/);
  failed.release();

  const retry = cache.acquire('/design/retry.glb');
  assert.equal(await retry.promise, fixture.gltf);
  retry.release();
  assert.equal(attempts, 2);
  assert.deepEqual(fixture.counts, { geometry: 1, material: 1, texture: 1, image: 1 });
});
