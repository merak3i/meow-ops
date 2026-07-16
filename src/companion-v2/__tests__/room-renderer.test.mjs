import assert from 'node:assert/strict';
import test from 'node:test';

import { ROOM_LIST } from '../../lib/companion-rooms.js';
import { buildRoomVisual, getTimePhase } from '../room-renderer.js';

test('every saved room tier produces a distinct visual identity', () => {
  const visuals = ROOM_LIST.map((room) => buildRoomVisual(room.key, 12));
  assert.equal(visuals.length, ROOM_LIST.length);
  assert.equal(new Set(visuals.map((visual) => [
    visual.palette.base,
    visual.palette.accent,
    visual.palette.highlight,
    visual.props.join(','),
  ].join('|'))).size, ROOM_LIST.length);
});

test('time phases cover the full day at their boundaries', () => {
  assert.equal(getTimePhase(5).key, 'dawn');
  assert.equal(getTimePhase(8).key, 'day');
  assert.equal(getTimePhase(17).key, 'dusk');
  assert.equal(getTimePhase(21).key, 'night');
  assert.equal(getTimePhase(0).key, 'night');
});

test('unknown rooms fall back to the starter room', () => {
  assert.equal(buildRoomVisual('missing-room', 12).key, 'corner_mat');
});
