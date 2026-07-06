import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mineDominantToolTrios,
  mineEditBeforeReadImbalance,
  minePromptPatterns,
} from '../loop-prompt-miner.mjs';

const NOW = new Date('2026-07-06T00:00:00.000Z');
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(
  HERE,
  '..',
  '__fixtures__',
  'loop',
  'sessions-prompt-miner.json',
), 'utf8'));

test('prompt miners fire on recurring metadata patterns', () => {
  const editPattern = mineEditBeforeReadImbalance(FIXTURE, { now: NOW });
  assert.equal(editPattern.pattern_id, 'read-before-edit-discipline');
  assert.equal(editPattern.session_count, 8);
  assert.deepEqual(editPattern.evidence.map((item) => [item.ref, item.value]), [
    ['sessions-with-edit-before-read-imbalance', 8],
    ['edit-write-tool-count', 24],
    ['read-tool-count', 8],
    ['edit-write-to-read-ratio', 3],
  ]);

  const trioPatterns = mineDominantToolTrios(FIXTURE, { now: NOW });
  assert.equal(trioPatterns.length, 1);
  assert.equal(trioPatterns[0].pattern_id, 'recurring-demo-prompt-app-edit-read-write-workflow');
  assert.equal(trioPatterns[0].title, 'recurring demo-prompt-app workflow');
  assert.equal(trioPatterns[0].session_count, 8);

  assert.deepEqual(
    minePromptPatterns(FIXTURE, { now: NOW }).map((pattern) => pattern.pattern_id),
    [
      'read-before-edit-discipline',
      'recurring-demo-prompt-app-edit-read-write-workflow',
    ],
  );
});

test('prompt miners stay clear below thresholds and outside the recent window', () => {
  const tooFew = FIXTURE.slice(0, 4);
  assert.equal(mineEditBeforeReadImbalance(tooFew, { now: NOW }), null);
  assert.deepEqual(mineDominantToolTrios(tooFew, { now: NOW }), []);
  assert.deepEqual(minePromptPatterns(FIXTURE, { now: new Date('2026-08-01T00:00:00.000Z') }), []);
});
