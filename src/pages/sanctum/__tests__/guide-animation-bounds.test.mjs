import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { measureGuideAnimationBounds } from '../guide-animation-bounds.mjs';

test('animation bounds include interpolated skinned poses beyond the model bind pose', () => {
  const model = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'GuideBone';
  model.add(bone);
  const geometry = new THREE.BoxGeometry(2, 0.1, 0.1);
  const vertexCount = geometry.attributes.position.count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index++) skinWeights[index * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const guide = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  guide.name = 'Guide';
  model.add(guide);
  model.updateMatrixWorld(true);
  guide.bind(new THREE.Skeleton([bone]));
  const clip = new THREE.AnimationClip('reach', 1, [new THREE.VectorKeyframeTrack(
    'GuideBone.rotation[z]', [0, 1], [Math.PI / 4, -Math.PI / 4],
  )]);

  const bounds = measureGuideAnimationBounds(model, [clip]);

  assert.ok(bounds.min.x < -0.98);
  assert.ok(bounds.max.x > 0.98);
  guide.geometry.dispose();
  guide.material.dispose();
});
