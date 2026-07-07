import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendRecord } from '../loop-ledger.mjs';
import { validateProposal } from '../loop-schema.mjs';
import {
  highFrictionMiner,
  recurringFailureMiner,
  runIntakeMiners,
  wastedWorkMiner,
} from '../intake-miners.mjs';

const NOW = new Date('2026-07-07T00:00:00.000Z');

function withTempLedger(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-intake-miners-ledger-'));
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = dir;
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function summary(sessionId, overrides = {}) {
  return {
    session_id: sessionId,
    failure_signatures: [],
    waste_indicators: [],
    friction_score: 0,
    task_kind: 'ops',
    outcome: 'unknown',
    ...overrides,
  };
}

function existingProposal(kind, ref) {
  return appendRecord('proposal', {
    proposal_id: `prop-existing-${kind}`,
    loop_id: 'meow-ops-guardrails',
    created_at: NOW.toISOString(),
    created_by: 'assistant:risk',
    category: 'workflow',
    title: 'Existing intake proposal',
    one_percent_target: 'Existing intake proposal',
    diff: { source: 'test' },
    rationale: 'Existing proposal for dedupe',
    evidence: [{ kind, ref, value: 1 }],
    confidence: 0.5,
    risk: 'low',
    risk_notes: 'synthetic test proposal',
    expected_benefit: 'dedupe',
    rollback: { plan: 'reject' },
    review_only: true,
    status: 'draft',
  });
}

test('recurringFailureMiner fires at threshold 3', () => withTempLedger(() => {
  const proposals = recurringFailureMiner({
    summaries: [1, 2, 3].map((id) => summary(`s${id}`, { failure_signatures: ['foo'] })),
    proposals: [],
    now: NOW,
  });
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0].evidence.some((item) => item.ref === 'foo'));
  assert.equal(validateProposal(proposals[0]), proposals[0]);
}));

test('recurringFailureMiner skips below threshold', () => withTempLedger(() => {
  const proposals = recurringFailureMiner({
    summaries: [1, 2].map((id) => summary(`s${id}`, { failure_signatures: ['foo'] })),
    proposals: [],
    now: NOW,
  });
  assert.equal(proposals.length, 0);
}));

test('recurringFailureMiner dedupes against existing proposals', () => withTempLedger(() => {
  const existing = existingProposal('intake-failure', 'foo');
  const proposals = recurringFailureMiner({
    summaries: [1, 2, 3].map((id) => summary(`s${id}`, { failure_signatures: ['foo'] })),
    proposals: [existing],
    now: NOW,
  });
  assert.equal(proposals.length, 0);
}));

test('wastedWorkMiner fires at threshold 4', () => withTempLedger(() => {
  const proposals = wastedWorkMiner({
    summaries: [1, 2, 3, 4].map((id) => summary(`s${id}`, { waste_indicators: ['context-compaction'] })),
    proposals: [],
    now: NOW,
  });
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0].evidence.some((item) => item.kind === 'intake-waste' && item.ref === 'context-compaction'));
}));

test('highFrictionMiner fires on 2+ high-friction sessions of same task_kind', () => withTempLedger(() => {
  const proposals = highFrictionMiner({
    summaries: [1, 2].map((id) => summary(`s${id}`, { friction_score: 4, task_kind: 'debug' })),
    proposals: [],
    now: NOW,
  });
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0].evidence.some((item) => item.kind === 'intake-friction' && item.ref === 'debug'));
}));

test('highFrictionMiner ignores friction below 4', () => withTempLedger(() => {
  const proposals = highFrictionMiner({
    summaries: [1, 2, 3].map((id) => summary(`s${id}`, { friction_score: 3, task_kind: 'debug' })),
    proposals: [],
    now: NOW,
  });
  assert.equal(proposals.length, 0);
}));

test('all miners return review_only proposals', () => withTempLedger(() => {
  const proposals = runIntakeMiners({
    summaries: [
      ...[1, 2, 3].map((id) => summary(`f${id}`, { failure_signatures: ['foo'] })),
      ...[1, 2, 3, 4].map((id) => summary(`w${id}`, { waste_indicators: ['waste'] })),
      ...[1, 2].map((id) => summary(`h${id}`, { friction_score: 4, task_kind: 'debug' })),
    ],
    proposals: [],
    now: NOW,
  });
  assert.equal(proposals.length, 3);
  assert.deepEqual(proposals.map((proposal) => proposal.review_only), [true, true, true]);
}));

test('runIntakeMiners combines all miners', () => withTempLedger(() => {
  const proposals = runIntakeMiners({
    summaries: [
      ...[1, 2, 3].map((id) => summary(`f${id}`, { failure_signatures: ['foo'] })),
      ...[1, 2, 3, 4].map((id) => summary(`w${id}`, { waste_indicators: ['waste'] })),
      ...[1, 2].map((id) => summary(`h${id}`, { friction_score: 5, task_kind: 'ops' })),
    ],
    proposals: [],
    now: NOW,
  });
  assert.ok(proposals.length >= 3);
}));
