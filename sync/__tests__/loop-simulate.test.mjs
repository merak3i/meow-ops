import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendRecord, foldLatestById, newId, readLedger,
} from '../loop-ledger.mjs';
import { simulateProposal } from '../loop-simulate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function withTempLedger(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-loop-simulate-'));
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

function withTempRepo(fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'meow-loop-simulate-repo-'));
  mkdirSync(join(repoRoot, 'prompts', 'library'), { recursive: true });
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  try {
    return fn(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function draftProposal(overrides = {}) {
  return {
    proposal_id: newId('prop'),
    loop_id: 'simulate-test-loop',
    run_id: 'run_sim_baseline',
    created_at: '2026-07-06T00:00:00.000Z',
    created_by: 'assistant:risk',
    category: 'test',
    title: 'Simulate a synthetic test proposal',
    one_percent_target: 'Prove simulation before approval',
    diff: {
      target_path: 'sync/__tests__/loop-ledger.test.mjs',
      before: '',
      after: 'synthetic test-only change',
    },
    rationale: 'synthetic simulator test',
    evidence: [{ kind: 'check', ref: 'simulator-test' }],
    confidence: 0.8,
    risk: 'low',
    risk_notes: 'synthetic only',
    expected_benefit: 'guards approval state',
    rollback: { plan: 'revert the synthetic test change' },
    review_only: false,
    status: 'draft',
    ...overrides,
  };
}

function promptProposal(overrides = {}) {
  return draftProposal({
    loop_id: 'meow-ops-prompts',
    created_by: 'assistant:prompt',
    category: 'prompt',
    title: 'Synthetic prompt template',
    one_percent_target: 'Prove new prompt template simulation',
    diff: {
      target_path: 'prompts/library/new-template.md',
      before: '',
      after: '# New template\n\nSynthetic metadata-only prompt.',
    },
    rationale: 'synthetic prompt simulation test',
    evidence: [{ kind: 'pattern', ref: 'synthetic-prompt-pattern' }],
    rollback: { plan: 'delete prompts/library/new-template.md' },
    ...overrides,
  });
}

test('loop:simulate passes a test proposal, records simulation, and advances to pending_approval', () => {
  withTempLedger(() => {
    const draft = appendRecord('proposal', draftProposal());
    const result = simulateProposal({ proposalId: draft.proposal_id });
    assert.equal(result.ok, true);
    assert.equal(result.simulation.mode, 'test-run');
    assert.equal(result.simulation.pass, true);
    assert.equal(result.pending.status, 'pending_approval');
    assert.equal(result.pending.created_by, 'system:simulate');
    assert.equal(result.pending.simulation_id, result.simulation.simulation_id);
    assert.match(result.pending.rollback.prior_sha256, /^[0-9a-f]{64}$/);

    const latest = foldLatestById(readLedger('proposal'), 'proposal_id')
      .find((proposal) => proposal.proposal_id === draft.proposal_id);
    assert.equal(latest.status, 'pending_approval');
    assert.equal(readLedger('simulation').length, 1);
  });
});

test('loop:simulate records a failing test-run simulation and leaves the proposal draft', () => {
  withTempLedger(() => {
    const draft = appendRecord('proposal', draftProposal({
      diff: { target_path: 'sync/__tests__/missing-loop-simulate.test.mjs' },
    }));
    const result = simulateProposal({ proposalId: draft.proposal_id });
    assert.equal(result.ok, false);
    assert.equal(result.simulation.pass, false);
    assert.equal(result.pending, null);

    const latest = foldLatestById(readLedger('proposal'), 'proposal_id')
      .find((proposal) => proposal.proposal_id === draft.proposal_id);
    assert.equal(latest.status, 'draft');
    assert.equal(readLedger('simulation').length, 1);
  });
});

test('loop:simulate refuses test proposals outside sync/__tests__ without ledger writes', () => {
  withTempLedger(() => {
    const draft = appendRecord('proposal', draftProposal({
      diff: { target_path: 'src/App.jsx' },
    }));
    assert.throws(
      () => simulateProposal({ proposalId: draft.proposal_id }),
      /\[simulation-target\]/,
    );
    assert.equal(readLedger('simulation').length, 0);
  });
});

test('loop:simulate refuses skeleton proposals with a clear message', () => {
  withTempLedger(() => {
    const draft = appendRecord('proposal', draftProposal({
      category: 'workflow',
      created_by: 'assistant:loop',
      rollback: { plan: 'n/a - investigation skeleton' },
      diff: { summary: 'skeleton only' },
    }));
    assert.throws(
      () => simulateProposal({ proposalId: draft.proposal_id }),
      /\[simulation-skeleton\]/,
    );
    assert.equal(readLedger('simulation').length, 0);
  });
});

test('loop:simulate passes a new-file prompt proposal for a fresh prompts path', () => {
  withTempLedger(() => {
    withTempRepo((repoRoot) => {
      const draft = appendRecord('proposal', promptProposal());
      const result = simulateProposal({ proposalId: draft.proposal_id, repoRoot });
      assert.equal(result.ok, true);
      assert.equal(result.simulation.mode, 'checklist');
      assert.equal(result.simulation.pass, true);
      assert.deepEqual(
        result.simulation.results.slice(0, 3).map((check) => [check.check, check.pass]),
        [
          ['new target path', true],
          ['target under prompts', true],
          ['target absent', true],
        ],
      );
      assert.equal(result.pending.status, 'pending_approval');
      assert.equal(result.pending.rollback.prior_sha256, undefined);
    });
  });
});

test('loop:simulate fails a new-file prompt proposal when the target already exists', () => {
  withTempLedger(() => {
    withTempRepo((repoRoot) => {
      writeFileSync(join(repoRoot, 'prompts', 'library', 'existing.md'), '# Existing\n');
      const draft = appendRecord('proposal', promptProposal({
        diff: {
          target_path: 'prompts/library/existing.md',
          before: '',
          after: '# Replacement should be refused\n',
        },
        rollback: { plan: 'delete prompts/library/existing.md' },
      }));
      const result = simulateProposal({ proposalId: draft.proposal_id, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.simulation.pass, false);
      assert.equal(result.simulation.results.find((check) => check.check === 'target absent').pass, false);
      assert.equal(result.pending, null);
    });
  });
});

test('loop:simulate fails a new-file prompt proposal outside prompts containment', () => {
  withTempLedger(() => {
    withTempRepo((repoRoot) => {
      const draft = appendRecord('proposal', promptProposal({
        diff: {
          target_path: 'src/new-template.md',
          before: '',
          after: '# Outside prompts\n',
        },
        rollback: { plan: 'delete src/new-template.md' },
      }));
      const result = simulateProposal({ proposalId: draft.proposal_id, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.simulation.pass, false);
      assert.equal(result.simulation.results.find((check) => check.check === 'target under prompts').pass, false);
      assert.equal(result.pending, null);
    });
  });
});

test('loop:simulate keeps the existing-target new-file fixture failing', () => {
  withTempLedger(() => {
    const fixture = JSON.parse(readFileSync(join(
      HERE,
      '..',
      '__fixtures__',
      'loop',
      'new-file-existing-proposal.json',
    ), 'utf8'));
    const draft = appendRecord('proposal', fixture);
    const result = simulateProposal({ proposalId: draft.proposal_id });
    assert.equal(result.ok, false);
    assert.equal(result.simulation.results.find((check) => check.check === 'target absent').pass, false);
  });
});
