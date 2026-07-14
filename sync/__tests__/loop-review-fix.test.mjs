import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runReviewFix } from '../loop-review-fix.mjs';

test('review-fix stores only verification metadata outside the worktree', async () => {
  const intakeDir = mkdtempSync(join(tmpdir(), 'meow-review-fix-'));
  try {
    const snapshot = await runReviewFix({
      intakeDir,
      now: new Date('2026-07-14T00:00:00.000Z'),
      runner: async (check) => (check.id === 'lint' ? 2 : 0),
    });
    assert.equal(snapshot.checks.length, 5);
    assert.deepEqual(snapshot.checks.find((check) => check.id === 'lint'), {
      id: 'lint', passed: false, exit_code: 2,
    });
    const stored = JSON.parse(readFileSync(join(intakeDir, 'review-fix.json'), 'utf8'));
    assert.deepEqual(stored, snapshot);
    assert.equal(JSON.stringify(stored).includes('command'), false);
  } finally {
    rmSync(intakeDir, { recursive: true, force: true });
  }
});

test('review-fix includes browser coverage only when requested', async () => {
  const intakeDir = mkdtempSync(join(tmpdir(), 'meow-review-fix-'));
  try {
    const seen = [];
    const snapshot = await runReviewFix({
      intakeDir,
      withE2E: true,
      runner: async (check) => { seen.push(check.id); return 0; },
    });
    assert.deepEqual(seen, ['sync-tests', 'eval', 'lint', 'typecheck', 'build', 'e2e']);
    assert.equal(snapshot.checks.at(-1).id, 'e2e');
  } finally {
    rmSync(intakeDir, { recursive: true, force: true });
  }
});
