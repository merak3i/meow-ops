import test from 'node:test';
import assert from 'node:assert/strict';

import { countOpenProposals } from '../../src/pages/loop-ops/proposal-counts.mjs';

test('counts open mapped proposals, including proposals reopened by undo', () => {
  const proposals = [
    { proposal_id: 'p1', loop_id: 'meow-ops-dev', status: 'draft' },
    { proposal_id: 'p2', loop_id: 'meow-ops-dev', status: 'pending_approval' },
    { proposal_id: 'p3', loop_id: 'meow-ops-dev', status: 'pending_approval' },
    { proposal_id: 'p4', loop_id: 'meow-ops-dev', status: 'draft' },
  ];
  const decisions = [
    { proposal_id: 'p3', decision: 'approved', decided_at: '2026-07-16T10:00:00.000Z' },
    { proposal_id: 'p4', decision: 'undone', decided_at: '2026-07-16T11:00:00.000Z' },
  ];
  assert.equal(countOpenProposals(proposals, decisions).get('meow-ops-dev'), 3);
});

test('ignores decided statuses and loop ids outside the explicit entity map', () => {
  const counts = countOpenProposals([
    { proposal_id: 'p1', loop_id: 'meow-ops-dev', status: 'approved' },
    { proposal_id: 'p2', loop_id: 'unknown-loop', status: 'draft' },
  ], []);
  assert.equal(counts.size, 0);
});
