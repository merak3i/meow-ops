import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSeparationNudge } from '../agent-separation.mjs';

function screenRightPosition(distance) {
  return [distance * Math.SQRT1_2, -distance * Math.SQRT1_2];
}

function screenDepthPosition(distance) {
  return [distance * Math.SQRT1_2, distance * Math.SQRT1_2];
}

test('screen-clear same-row and separate-row positions do not get nudged', () => {
  const horizontal = screenRightPosition(5.25);
  const depth = screenDepthPosition(7.5);

  assert.deepEqual(agentSeparationNudge(...horizontal, 0, 0, 'a', 'b', 1 / 60), [0, 0]);
  assert.deepEqual(agentSeparationNudge(...depth, 0, 0, 'a', 'b', 1 / 60), [0, 0]);
});

test('screen-near hierarchy rows get a separating nudge', () => {
  const depth = screenDepthPosition(5.8);
  assert.notDeepEqual(agentSeparationNudge(...depth, 0, 0, 'a', 'b', 1 / 60), [0, 0]);
});

test('screen-near same-row positions get a separating nudge', () => {
  const near = screenRightPosition(5.24);
  assert.notDeepEqual(agentSeparationNudge(...near, 0, 0, 'a', 'b', 1 / 60), [0, 0]);
});

test('screen-overlapping pairs receive bounded opposite nudges', () => {
  const close = screenRightPosition(1.5);
  const forward = agentSeparationNudge(...close, 0, 0, 'a', 'b', 1 / 60);
  const reverse = agentSeparationNudge(0, 0, ...close, 'b', 'a', 1 / 60);

  assert.ok(Math.hypot(...forward) >= 0.03);
  assert.ok(Math.max(...forward.map(Math.abs)) <= 0.16);
  assert.deepEqual(reverse, forward.map(value => -value));
});

test('exact overlaps separate deterministically and invalid frame inputs are ignored', () => {
  const forward = agentSeparationNudge(0, 0, 0, 0, 'a', 'b', 1 / 60);
  const reverse = agentSeparationNudge(0, 0, 0, 0, 'b', 'a', 1 / 60);

  assert.ok(forward.some(value => value !== 0));
  assert.deepEqual(reverse, forward.map(value => -value));
  assert.deepEqual(agentSeparationNudge(0, 0, 1, 0, 'a', 'b', Number.NaN), [0, 0]);
});
