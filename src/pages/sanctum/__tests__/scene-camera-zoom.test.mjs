import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applySceneCameraZoom, getSceneMinZoom, getSceneZoom } from '../scene-camera-zoom.mjs';

test('scene camera preserves compact framing and caps desktop zoom', () => {
  assert.equal(getSceneZoom(390), 14);
  assert.equal(getSceneMinZoom(390), 14);
  assert.equal(getSceneZoom(1200), 38);
  assert.equal(getSceneMinZoom(1200), 30);
});

test('scene camera zoom changes smoothly across the compact layout breakpoint', () => {
  const zoomBefore = getSceneZoom(720);
  const zoomAfter = getSceneZoom(721);
  const minBefore = getSceneMinZoom(720);
  const minAfter = getSceneMinZoom(721);

  assert.ok(zoomBefore > 12 && zoomBefore < 38);
  assert.ok(Math.abs(zoomAfter - zoomBefore) < 0.1);
  assert.ok(Math.abs(minAfter - minBefore) < 0.1);
});

test('scene resize applies the calculated zoom to the active orthographic camera', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.zoom = 12;
  camera.updateProjectionMatrix();
  const previousProjection = camera.projectionMatrix.elements.slice();

  applySceneCameraZoom(camera, 30);

  assert.equal(camera.zoom, 30);
  assert.notDeepEqual(camera.projectionMatrix.elements, previousProjection);
});
