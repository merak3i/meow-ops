import test from 'node:test';
import assert from 'node:assert/strict';

import { learningQuestMutationMessage } from '../../src/lib/learning-quest-client.js';

test('workshop 404 explains that the running helper must be refreshed', () => {
  assert.equal(
    learningQuestMutationMessage({ ok: false, status: 404, error: 'Not found' }),
    'Your local helper is out of date. Restart it with `npm run agents:install`, then retry.',
  );
});

test('learning helper rule failures retain their actionable reason', () => {
  assert.equal(
    learningQuestMutationMessage({
      ok: false,
      status: 400,
      error: '[learning-quest] complete one learning action before closing the workshop',
    }),
    'Complete one learning action before closing the workshop.',
  );
});

test('offline mutations distinguish an unavailable helper from a rejected action', () => {
  assert.equal(
    learningQuestMutationMessage(null),
    'The local learning helper is offline. Start it with `npm run agents:install`, then retry.',
  );
});
