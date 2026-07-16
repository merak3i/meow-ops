import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPANION_POSES,
  buildPoseSprite,
  buildTailSprite,
  poseForState,
} from '../pose-renderer.js';

const SOURCE = Array.from({ length: 32 }, (_, y) => (
  Array.from({ length: 32 }, (_, x) => (
    x > 7 && x < 24 && y > 3 && y < 30 ? 'F' : '.'
  )).join('')
));

test('every companion pose produces distinct 48-grid body art', () => {
  const sprites = COMPANION_POSES.map((pose) => buildPoseSprite(SOURCE, pose, 0));
  assert.equal(COMPANION_POSES.length, 9);
  assert.ok(sprites.every((sprite) => sprite.length === 48));
  assert.ok(sprites.every((sprite) => sprite.every((row) => row.length === 48)));
  assert.equal(new Set(sprites.map((sprite) => sprite.join('\n'))).size, 9);
});

test('tail is an independent eight-frame 48-grid layer', () => {
  const tails = Array.from({ length: 8 }, (_, frame) => buildTailSprite('sway', frame));
  assert.ok(tails.every((sprite) => sprite.length === 48));
  assert.ok(tails.every((sprite) => sprite.every((row) => row.length === 48)));
  assert.equal(new Set(tails.map((sprite) => sprite.join('\n'))).size, 8);
});

test('emotional states select meaningful default poses', () => {
  assert.equal(poseForState('focus'), 'desk');
  assert.equal(poseForState('fatigue'), 'loaf');
  assert.equal(poseForState('neglected'), 'curl');
  assert.equal(poseForState('active'), 'pounce');
});
