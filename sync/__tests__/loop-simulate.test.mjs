import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendRecord, foldLatestById, newId, readLedger,
} from '../loop-ledger.mjs';
import { simulateProposal } from '../loop-simulate.mjs';

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
