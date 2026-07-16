import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAction, frameAt, scheduleBehavior } from '../action-scheduler.js';

test('feed actions walk to the bowl before eating', () => {
  const queue = enqueueAction([], 'feed', 1000);
  assert.deepEqual(queue.map((frame) => frame.pose), ['pounce', 'play', 'eat', 'sit']);
  assert.equal(frameAt(queue, 1750)?.pose, 'eat');
});

test('queued actions begin after the current sequence', () => {
  const feed = enqueueAction([], 'feed', 0);
  const play = enqueueAction(feed, 'play', 100);
  assert.ok(play[feed.length].start >= feed.at(-1).end);
});

test('live work wins over hunger and low hunger schedules bowl behavior', () => {
  assert.equal(scheduleBehavior({ hunger: 20, hasLiveSession: true }), 'session');
  assert.equal(scheduleBehavior({ hunger: 20, hasLiveSession: false }), 'hungry');
  assert.equal(scheduleBehavior({ hunger: 80, hasLiveSession: false }), null);
  assert.equal(enqueueAction([], 'hungry', 0)[1].tailState, 'flick');
});
