import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import ts from 'typescript';

const source = readFileSync(new URL('../guide-resources.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'three'", JSON.stringify(import.meta.resolve('three')));
const { disposeGuideResources } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('private guide cleanup releases shared GPU resources and shared image bitmaps once', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
  let bitmapCloses = 0;
  globalThis.ImageBitmap = class { close() { bitmapCloses++; } };
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'ImageBitmap', previous); else delete globalThis.ImageBitmap; });
  const image = new ImageBitmap();
  const firstTexture = new THREE.Texture(image);
  const secondTexture = new THREE.Texture(image);
  const firstMaterial = new THREE.MeshStandardMaterial({ map: firstTexture, normalMap: secondTexture });
  const secondMaterial = new THREE.MeshStandardMaterial({ map: firstTexture });
  const geometry = new THREE.BoxGeometry();
  const skeleton = new THREE.Skeleton([new THREE.Bone()]);
  skeleton.computeBoneTexture();
  const counts = { geometry: 0, material: 0, texture: 0, boneTexture: 0 };
  geometry.addEventListener('dispose', () => counts.geometry++);
  for (const material of [firstMaterial, secondMaterial]) material.addEventListener('dispose', () => counts.material++);
  for (const texture of [firstTexture, secondTexture]) texture.addEventListener('dispose', () => counts.texture++);
  skeleton.boneTexture.addEventListener('dispose', () => counts.boneTexture++);
  const root = new THREE.Group();
  for (const materials of [[firstMaterial, secondMaterial], [firstMaterial]]) {
    const mesh = new THREE.SkinnedMesh(geometry, materials);
    mesh.bind(skeleton);
    root.add(mesh);
  }
  disposeGuideResources(root);
  assert.deepEqual(counts, { geometry: 1, material: 2, texture: 2, boneTexture: 1 });
  assert.equal(bitmapCloses, 1);
});
