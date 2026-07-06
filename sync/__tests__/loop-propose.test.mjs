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
  appendComparisonSkeletonsWithAi,
  collectCandidates,
  hasOpenProposalForLoop,
  runProposer,
  scanDanglingAutomationPaths,
} from '../loop-propose.mjs';
import { resetLlmBudgetForTests } from '../llm-gateway.mjs';

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

async function withTempLedgerAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-loop-propose-ledger-'));
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = dir;
  resetLlmBudgetForTests();
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
    resetLlmBudgetForTests();
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

function dateDaysBefore(days) {
  const date = new Date(NOW.getTime() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function writeCostSummary(repoRoot, {
  latestCost = 11,
  latestGhost = 1,
  trailingCosts = [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10],
  trailingGhosts = Array(14).fill(1),
} = {}) {
  mkdirSync(join(repoRoot, 'public', 'data'), { recursive: true });
  const daily_summary = trailingCosts.map((cost, index) => ({
    date: dateDaysBefore(14 - index),
    session_count: 10,
    estimated_cost_usd: cost,
    total_duration_seconds: 1000,
    ghost_count: trailingGhosts[index] ?? 0,
  }));
  daily_summary.push({
    date: dateDaysBefore(0),
    session_count: 10,
    estimated_cost_usd: latestCost,
    total_duration_seconds: 1000,
    ghost_count: latestGhost,
  });
  writeFileSync(join(repoRoot, 'public', 'data', 'cost-summary.json'), JSON.stringify({ daily_summary }, null, 2));
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
  writeCostSummary(repoRoot);
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

function fakeKey() {
  return ['sk', 'b'.repeat(24)].join('-');
}

function llmResponse(content, usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }) {
  return {
    ok: true,
    async json() {
      return {
        choices: [{ message: { content } }],
        usage,
      };
    },
  };
}

function validRun(overrides = {}) {
  return {
    run_id: overrides.run_id || `run-${Math.random().toString(36).slice(2)}`,
    loop_id: overrides.loop_id || 'demo-loop',
    captured_at: overrides.captured_at || NOW.toISOString(),
    sources: ['test'],
    session_ids: ['demo-session'],
    metrics: {
      sessions: 1,
      duration_seconds: 10,
      total_tokens: 100,
      message_count: 2,
    },
    ...overrides,
  };
}

function validDraftProposal(overrides = {}) {
  return {
    proposal_id: overrides.proposal_id || `prop-${Math.random().toString(36).slice(2)}`,
    loop_id: 'demo-loop',
    created_at: NOW.toISOString(),
    created_by: 'assistant:risk',
    category: 'workflow',
    title: 'Synthetic draft',
    one_percent_target: 'Exercise stale draft expiry',
    diff: { summary: 'synthetic' },
    rationale: 'synthetic test fixture',
    evidence: [{ kind: 'rule', ref: 'synthetic' }],
    confidence: 0.5,
    risk: 'low',
    risk_notes: 'synthetic only',
    expected_benefit: 'keeps tests focused',
    rollback: { plan: 'remove the synthetic fixture' },
    review_only: false,
    status: 'draft',
    ...overrides,
  };
}

test('proposer rule matrix: each rule fires and stays redaction-clean', () => {
  withTempLedger(() => {
    appendRecord('run', validRun({
      run_id: 'run-duration-warn',
      notes: 'WARN: duration_seconds (100) exceeds 5x the selection window (10s) - synthetic',
    }));
    withRepoFixture((repoRoot) => {
      writeRateLimits(repoRoot, '2026-05-01T00:00:00.000Z');
      writeFileSync(join(repoRoot, '.gitignore'), 'public/data/*\n!public/data/sessions.json\n');
      writeAutomationFiles(repoRoot, { missingScript: true });
      writeCostSummary(repoRoot, { latestCost: 14, latestGhost: 6 });
    }, (repoRoot) => {
      const candidates = collectCandidates({ repoRoot, now: NOW });
      for (const ruleId of [
        'stale-rate-limits',
        'tracked-data-regression',
        'dangling-automation-paths',
        'spend-velocity',
        'ghost-spike',
        'duration-anomaly',
      ]) {
        const proposal = candidateByRule(candidates, ruleId);
        assert.ok(proposal, `${ruleId} should fire`);
        assert.ok(proposal.evidence.some((item) => item.kind === 'rule' && item.ref === ruleId));
        assert.equal(validateProposal(proposal), proposal);
        assert.doesNotThrow(() => assertRedacted(JSON.parse(JSON.stringify(proposal))));
      }
    });
  });
});

test('proposer rule matrix: each rule stays clear when inputs are healthy', () => {
  withTempLedger(() => {
    withRepoFixture(() => {}, (repoRoot) => {
      const candidates = collectCandidates({ repoRoot, now: NOW });
      assert.deepEqual(candidates.map((candidate) => [candidate.ruleId, Boolean(candidate.proposal)]), [
        ['stale-rate-limits', false],
        ['tracked-data-regression', false],
        ['dangling-automation-paths', false],
        ['spend-velocity', false],
        ['ghost-spike', false],
        ['duration-anomaly', false],
      ]);
      assert.deepEqual(scanDanglingAutomationPaths({ repoRoot }), []);
    });
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

test('comparison skeletons can be enriched by a stubbed LLM and meter the call', async () => {
  await withTempLedgerAsync(async () => {
    appendRecord('comparison', validComparison({ comparison_id: 'cmp-ai' }));
    const results = await appendComparisonSkeletonsWithAi({
      now: NOW,
      ai: true,
      env: {
        DEEPSEEK_API_KEY: fakeKey(),
        MEOW_LLM_WEEKLY_USD: '1.00',
        MEOW_LLM_CALLS_PER_CYCLE: '25',
      },
      transport: async () => llmResponse(JSON.stringify({
        one_percent_target: 'Reduce duration anomaly review time by one percent',
        rationale: 'Local deltas show duration_seconds moved sharply versus baseline.',
        expected_benefit: 'Turns the flagged run into a focused owner review.',
      })),
    });

    assert.equal(results[0].status, 'skeleton-enriched');
    const proposal = readLedger('proposal')[0];
    assert.equal(proposal.created_by, 'assistant:loop');
    assert.equal(proposal.status, 'draft');
    assert.equal(proposal.one_percent_target, 'Reduce duration anomaly review time by one percent');
    assert.ok(proposal.evidence.some((item) => item.kind === 'llm' && item.ref === 'deepseek:deepseek-chat'));
    assert.equal(validateProposal(proposal), proposal);

    const meterRuns = readLedger('run').filter((run) => run.loop_id === 'meow-ops-assistant');
    assert.equal(meterRuns.length, 1);
    assert.equal(meterRuns[0].metrics.cost_usd_real, 0.00049);
  });
});

test('malicious LLM output is rejected by appendRecord and deterministic skeleton ships', async () => {
  await withTempLedgerAsync(async () => {
    const runtimeSecret = fakeKey();
    appendRecord('comparison', validComparison({ comparison_id: 'cmp-malicious' }));
    const results = await appendComparisonSkeletonsWithAi({
      now: NOW,
      ai: true,
      env: {
        DEEPSEEK_API_KEY: fakeKey(),
        MEOW_LLM_WEEKLY_USD: '1.00',
        MEOW_LLM_CALLS_PER_CYCLE: '25',
      },
      transport: async () => llmResponse(JSON.stringify({
        one_percent_target: `Leaked ${runtimeSecret}`,
        rationale: 'This should never persist.',
        expected_benefit: 'This should never persist.',
      })),
    });

    assert.equal(results[0].status, 'skeleton');
    assert.equal(results[0].llm_status, 'rejected');
    const proposals = readLedger('proposal');
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].comparison_id, 'cmp-malicious');
    assert.equal(proposals[0].created_by, 'assistant:loop');
    assert.equal(proposals[0].status, 'draft');
    assert.equal(proposals[0].evidence.some((item) => item.kind === 'llm'), false);
    assert.equal(JSON.stringify(proposals).includes(runtimeSecret), false);
    assert.equal(validateProposal(proposals[0]), proposals[0]);
  });
});

test('malformed LLM output retries once then keeps deterministic skeleton', async () => {
  await withTempLedgerAsync(async () => {
    let calls = 0;
    appendRecord('comparison', validComparison({ comparison_id: 'cmp-malformed' }));
    const results = await appendComparisonSkeletonsWithAi({
      now: NOW,
      ai: true,
      env: {
        DEEPSEEK_API_KEY: fakeKey(),
        MEOW_LLM_WEEKLY_USD: '1.00',
        MEOW_LLM_CALLS_PER_CYCLE: '25',
      },
      transport: async () => {
        calls += 1;
        return llmResponse('not-json');
      },
    });

    assert.equal(calls, 2);
    assert.equal(results[0].status, 'skeleton');
    assert.equal(readLedger('run').length, 0);
    const proposal = readLedger('proposal')[0];
    assert.equal(proposal.comparison_id, 'cmp-malformed');
    assert.equal(proposal.evidence.some((item) => item.kind === 'llm'), false);
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

test('loop:propose expires stale drafts at 14 days with a system expiry decision', () => {
  withTempLedger(() => {
    const draft = appendRecord('proposal', validDraftProposal({
      proposal_id: 'prop-stale-draft',
      created_at: '2026-06-22T00:00:00.000Z',
    }));
    withRepoFixture(() => {}, (repoRoot) => {
      const results = runProposer({ repoRoot, now: NOW });
      assert.equal(results.find((result) => result.ruleId === `expire:${draft.proposal_id}`).status, 'expired');
      const decision = readLedger('decision').find((record) => record.proposal_id === draft.proposal_id);
      assert.equal(decision.decision, 'rejected');
      assert.equal(decision.created_by, 'system:expire');
      assert.equal(decision.decided_by, 'system:expire');
      assert.equal(decision.reason, 'expired stale draft');
      const latest = readLedger('proposal').at(-1);
      assert.equal(latest.proposal_id, draft.proposal_id);
      assert.equal(latest.status, 'rejected');
      assert.equal(latest.created_by, 'system:expire');
    });
  });
});

test('loop:propose does not expire a 13-day draft', () => {
  withTempLedger(() => {
    const draft = appendRecord('proposal', validDraftProposal({
      proposal_id: 'prop-fresh-draft',
      created_at: '2026-06-23T00:00:01.000Z',
    }));
    withRepoFixture(() => {}, (repoRoot) => {
      const results = runProposer({ repoRoot, now: NOW });
      assert.equal(results.some((result) => result.ruleId === `expire:${draft.proposal_id}`), false);
      assert.equal(readLedger('decision').length, 0);
      assert.equal(readLedger('proposal').at(-1).status, 'draft');
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
