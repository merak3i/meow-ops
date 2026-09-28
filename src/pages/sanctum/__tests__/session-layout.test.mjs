import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionLanePosition, sessionLaneRowCount } from '../session-layout.mjs';

test('same-depth sessions keep stable, separate initial positions as the roster grows', () => {
  for (let count = 1; count <= 16; count++) {
    const totalRows = sessionLaneRowCount(count);
    const positions = Array.from({ length: count }, (_, index) => (
      sessionLanePosition(index, count, 0, totalRows)
    ));
    const keys = positions.map(([x, z]) => `${x}:${z}`);
    assert.equal(new Set(keys).size, count, `${count} sessions must have unique positions`);

    for (let left = 0; left < positions.length; left++) {
      for (let right = left + 1; right < positions.length; right++) {
        const [leftX, leftZ] = positions[left];
        const [rightX, rightZ] = positions[right];
        assert.ok(Math.hypot(leftX - rightX, leftZ - rightZ) >= 1.9,
          `${count} sessions overlap at indexes ${left} and ${right}`);
      }
    }
  }
});

test('session lane position rejects invalid slot inputs', () => {
  assert.throws(() => sessionLanePosition(-1, 2, 0, 1), RangeError);
  assert.throws(() => sessionLanePosition(2, 2, 0, 1), RangeError);
  assert.throws(() => sessionLanePosition(0, 0, 0, 1), RangeError);
  assert.throws(() => sessionLanePosition(0, 1, 1, 1), RangeError);
});

test('hierarchy rows remain ordered and separated in the camera plane', () => {
  const rootPosition = sessionLanePosition(0, 1, 0, 2);
  const firstChildPosition = sessionLanePosition(0, 1, 1, 2);

  const [rootX, rootZ] = rootPosition;
  const [childX, childZ] = firstChildPosition;
  const rootDepth = (rootX + rootZ) / Math.SQRT2;
  const childDepth = (childX + childZ) / Math.SQRT2;
  assert.ok(rootDepth > childDepth);
  assert.ok(Math.abs(rootDepth - childDepth - 5.8) < 0.0001);
});
