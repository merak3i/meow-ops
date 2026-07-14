import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCloudDailyReview } from '../cloud-daily-review.mjs';

test('cloud daily report is explicit about deferred local sync', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'meow-cloud-daily-'));
  try {
    const report = await runCloudDailyReview({
      outputDir,
      now: new Date('2026-07-14T03:00:00.000Z'),
      env: {
        GITHUB_REPOSITORY: 'merak3i/meow-ops',
        GITHUB_SHA: 'abc123',
        GITHUB_RUN_ID: '42',
      },
      deps: {
        runReviewFix: async () => ({
          generated_at: '2026-07-14T03:00:00.000Z',
          checks: [
            { id: 'sync-tests', passed: true, exit_code: 0 },
            { id: 'build', passed: true, exit_code: 0 },
          ],
        }),
      },
    });
    assert.equal(report.status, 'clear');
    assert.equal(report.local_sync.status, 'deferred');
    assert.equal(report.source.sha, 'abc123');
    const saved = JSON.parse(readFileSync(join(outputDir, 'cloud-daily.json'), 'utf8'));
    assert.equal(saved.scope, 'repository-only');
    assert.match(readFileSync(join(outputDir, 'cloud-daily.md'), 'utf8'), /No private session data was available/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('cloud daily report ranks the first failing gate without raw output', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'meow-cloud-daily-'));
  try {
    const report = await runCloudDailyReview({
      outputDir,
      deps: {
        runReviewFix: async () => ({
          generated_at: new Date().toISOString(),
          checks: [
            { id: 'lint', passed: false, exit_code: 2 },
            { id: 'build', passed: false, exit_code: 1 },
          ],
        }),
      },
    });
    assert.equal(report.status, 'needs-attention');
    assert.equal(report.nudge.prompt, 'Review failing repository checks');
    assert.match(report.nudge.body, /Start with lint/);
    assert.doesNotMatch(JSON.stringify(report), /stdout|stderr|command/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
