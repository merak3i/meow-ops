import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendRecord, assertRedacted, readLedger,
} from '../loop-ledger.mjs';
import { validateProposal } from '../loop-schema.mjs';
import {
  appendComparisonSkeletons,
  collectCandidates,
  hasOpenProposalForLoop,
  runProposer,
  scanDanglingAutomationPaths,
} from '../loop-propose.mjs';

const NOW = new Date('2026-07-06T00:00:00.000Z');

function withTempLedger(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-loop-propose-ledger-'));
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeGoodGitignore(repoRoot) {
  writeFileSync(join(repoRoot, '.gitignore'), [
    'public/data/*',
    '!public/data/demo-cost-summary.json',
    '!public/data/demo-sessions.json',
    '!public/data/demo-superadmin-usage.json',
    '',
  ].join('\n'));
}

function writeRateLimits(repoRoot, updated) {
  mkdirSync(join(repoRoot, 'public', 'data'), { recursive: true });
  writeFileSync(join(repoRoot, 'public', 'data', 'rate-limits.json'), JSON.stringify({ _updated: updated }, null, 2));
}

function writeAutomationFiles(repoRoot, { missingScript = false } = {}) {
  mkdirSync(join(repoRoot, 'sync'), { recursive: true });
  if (missingScript) rmSync(join(repoRoot, 'sync', 'export-local.mjs'), { force: true });
  else writeFileSync(join(repoRoot, 'sync', 'export-local.mjs'), '');
  writeFileSync(join(repoRoot, 'sync', 'local-api.mjs'), "spawn(NODE, [join(ROOT, 'sync', 'export-local.mjs')])\n");
  writeFileSync(join(repoRoot, 'sync', 'com.meowops.localapi.plist'), [
    '<plist><dict>',
    '<key>ProgramArguments</key><array>',
    '<string>/bin/sh</string>',
    '<string>sync/local-api.mjs</string>',
    '</array>',
    '<key>WorkingDirectory</key><string>YOUR_REPO_PATH</string>',
    '<key>StandardOutPath</key><string>YOUR_REPO_PATH/sync/local-api.log</string>',
    '</dict></plist>',
  ].join('\n'));
  writeFileSync(join(repoRoot, 'sync', 'launchd-example.plist'), [
    '<plist><dict>',
    '<key>ProgramArguments</key><array>',
    '<string>/bin/sh</string>',
    '<string>sync/export-local.mjs</string>',
    '</array>',
    '<key>WorkingDirectory</key><string>YOUR_REPO_PATH</string>',
    '<key>StandardErrorPath</key><string>YOUR_REPO_PATH/sync/auto-sync.log</string>',
    '</dict></plist>',
  ].join('\n'));
}

function withRepoFixture(setup, fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'meow-loop-propose-repo-'));
  writeGoodGitignore(repoRoot);
  writeRateLimits(repoRoot, '2026-07-05T00:00:00.000Z');
  writeAutomationFiles(repoRoot);
  setup(repoRoot);
  try {
    return fn(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function candidateByRule(candidates, ruleId) {
  return candidates.find((candidate) => candidate.ruleId === ruleId).proposal;
}

function validComparison(overrides = {}) {
  return {
    comparison_id: overrides.comparison_id || `cmp-${Math.random().toString(36).slice(2)}`,
    run_id: 'run-after',
    baseline_run_id: 'run-before',
    loop_id: 'demo-loop',
    computed_at: NOW.toISOString(),
    deltas: {
      duration_seconds: { before: 100, after: 150, delta_pct: 50 },
      cost_usd_real: { before: 2, after: 2.2, delta_pct: 10 },
    },
    flags: ['slower'],
    ...overrides,
  };
}

test('proposer rule matrix: each rule fires and stays redaction-clean', () => {
  withRepoFixture((repoRoot) => {
    writeRateLimits(repoRoot, '2026-05-01T00:00:00.000Z');
    writeFileSync(join(repoRoot, '.gitignore'), 'public/data/*\n!public/data/sessions.json\n');
    writeAutomationFiles(repoRoot, { missingScript: true });
  }, (repoRoot) => {
    const candidates = collectCandidates({ repoRoot, now: NOW });
    for (const ruleId of ['stale-rate-limits', 'tracked-data-regression', 'dangling-automation-paths']) {
      const proposal = candidateByRule(candidates, ruleId);
      assert.ok(proposal, `${ruleId} should fire`);
      assert.equal(validateProposal(proposal), proposal);
      assert.doesNotThrow(() => assertRedacted(JSON.parse(JSON.stringify(proposal))));
    }
  });
});

test('proposer rule matrix: each rule stays clear when inputs are healthy', () => {
  withRepoFixture(() => {}, (repoRoot) => {
    const candidates = collectCandidates({ repoRoot, now: NOW });
    assert.deepEqual(candidates.map((candidate) => [candidate.ruleId, Boolean(candidate.proposal)]), [
      ['stale-rate-limits', false],
      ['tracked-data-regression', false],
      ['dangling-automation-paths', false],
    ]);
    assert.deepEqual(scanDanglingAutomationPaths({ repoRoot }), []);
  });
});

test('loop:propose appends draft, simulated, pending_approval then throttles open rules', () => {
  withTempLedger(() => {
    withRepoFixture((repoRoot) => {
      writeRateLimits(repoRoot, '2026-05-01T00:00:00.000Z');
    }, (repoRoot) => {
      const first = runProposer({ repoRoot, now: NOW });
      assert.equal(first.find((r) => r.ruleId === 'stale-rate-limits').status, 'fired');
      const afterFirst = readLedger('proposal');
      assert.equal(afterFirst.length, 3);
      assert.deepEqual(afterFirst.map((record) => record.status), ['draft', 'simulated', 'pending_approval']);
      assert.deepEqual(afterFirst.map((record) => record.created_by), ['assistant:risk', 'system:propose', 'system:propose']);

      const second = runProposer({ repoRoot, now: NOW });
      assert.equal(second.find((r) => r.ruleId === 'stale-rate-limits').status, 'skipped-open');
      assert.equal(readLedger('proposal').length, 3);
    });
  });
});

test('comparison skeletons are draft-only, validate, and throttle to one open proposal per loop', () => {
  withTempLedger(() => {
    appendRecord('comparison', validComparison({ comparison_id: 'cmp-one' }));
    appendRecord('comparison', validComparison({ comparison_id: 'cmp-two' }));

    const first = appendComparisonSkeletons({ now: NOW });
    assert.equal(first.filter((result) => result.status === 'skeleton').length, 1);
    assert.equal(first.find((result) => result.comparison_id === 'cmp-two').status, 'skipped-open');

    const proposals = readLedger('proposal');
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].created_by, 'assistant:loop');
    assert.equal(proposals[0].status, 'draft');
    assert.equal(proposals[0].comparison_id, 'cmp-one');
    assert.equal(validateProposal(proposals[0]), proposals[0]);
    assert.equal(hasOpenProposalForLoop('demo-loop'), true);

    const second = appendComparisonSkeletons({ now: NOW });
    assert.equal(second.filter((result) => result.status === 'skeleton').length, 0);
    assert.equal(readLedger('proposal').length, 1);
  });
});

test('loop:propose runs comparison skeleton generation when guardrail rules are clear', () => {
  withTempLedger(() => {
    appendRecord('comparison', validComparison({ comparison_id: 'cmp-loop-propose' }));
    withRepoFixture(() => {}, (repoRoot) => {
      const results = runProposer({ repoRoot, now: NOW });
      const skeleton = results.find((result) => result.ruleId === 'comparison:cmp-loop-propose');
      assert.equal(skeleton.status, 'skeleton');
      assert.equal(readLedger('proposal').length, 1);
    });
  });
});

test('tracked-data-regression includes an exact .gitignore correction', () => {
  withRepoFixture((repoRoot) => {
    writeFileSync(join(repoRoot, '.gitignore'), 'public/data/*\n!public/data/rate-limits.json\n');
  }, (repoRoot) => {
    const proposal = candidateByRule(collectCandidates({ repoRoot, now: NOW }), 'tracked-data-regression');
    assert.ok(proposal.diff.before.includes('!public/data/rate-limits.json'));
    assert.ok(!proposal.diff.after.includes('!public/data/rate-limits.json'));
    assert.ok(proposal.diff.after.includes('public/data/*'));
    assert.equal(proposal.review_only, true);
  });
});

test('dangling-automation-paths names missing script references without absolute repo paths', () => {
  withRepoFixture((repoRoot) => {
    writeAutomationFiles(repoRoot, { missingScript: true });
  }, (repoRoot) => {
    const proposal = candidateByRule(collectCandidates({ repoRoot, now: NOW }), 'dangling-automation-paths');
    assert.match(proposal.rationale, /reference/);
    assert.match(proposal.diff.before, /sync\/export-local\.mjs/);
    assert.ok(!proposal.diff.before.includes(repoRoot), 'proposal must not leak temp repo root');
  });
});
