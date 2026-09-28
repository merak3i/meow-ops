import assert from 'node:assert/strict';
import test from 'node:test';
import { guideCameraDistance, guideProjectedBoundsFit } from '../guide-camera.mjs';

test('full guide bounds fit inside landscape and portrait camera frusta', () => {
  const bounds = { width: 1.6, height: 2.6, depth: 0.7 };
  const fovDegrees = 30;
  const padding = 1.12;
  const verticalTangent = Math.tan((fovDegrees * Math.PI) / 360);

  for (const aspect of [1.8, 0.68]) {
    const distance = guideCameraDistance(bounds, { fovDegrees, aspect, padding });
    const nearestPlaneDistance = distance - bounds.depth / 2;
    const horizontalTangent = verticalTangent * aspect;

    assert.ok(nearestPlaneDistance * verticalTangent >= bounds.height / 2 * padding);
    assert.ok(nearestPlaneDistance * horizontalTangent >= bounds.width / 2 * padding);
  }
});

test('camera fit rejects invalid dimensions and viewport geometry', () => {
  assert.throws(() => guideCameraDistance({ width: 0, height: 2, depth: 0 }, { fovDegrees: 30, aspect: 1 }));
  assert.throws(() => guideCameraDistance({ width: 1, height: 2, depth: 0 }, { fovDegrees: 180, aspect: 1 }));
  assert.throws(() => guideCameraDistance({ width: 1, height: 2, depth: 0 }, { fovDegrees: 30, aspect: 0 }));
});

test('projected guide and alcove corners stay inside the padded camera frustum', () => {
  const inside = [
    { x: -0.8, y: -0.7, z: -0.9 },
    { x: 0.8, y: -0.7, z: -0.9 },
    { x: -0.8, y: 0.7, z: 0.9 },
    { x: 0.8, y: 0.7, z: 0.9 },
  ];
  assert.equal(guideProjectedBoundsFit(inside, 1.2), true);
  assert.equal(guideProjectedBoundsFit([{ x: 1 / 1.2 + 1e-8, y: 0, z: 0 }], 1.2), true);
  assert.equal(guideProjectedBoundsFit([...inside, { x: 0.84, y: 0, z: 0 }], 1.2), false);
  assert.equal(guideProjectedBoundsFit([...inside, { x: 0, y: 0, z: 1.01 }], 1.2), false);
});
