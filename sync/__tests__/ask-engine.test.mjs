import test from 'node:test';
import assert from 'node:assert/strict';

import { ask } from '../ask-engine.mjs';

const proposals = [
  { proposal_id: 'p1', title: 'Refresh stale panel', status: 'pending_approval' },
  { proposal_id: 'p2', title: 'Trim noisy alert', status: 'pending_approval' },
  { proposal_id: 'p3', title: 'Archive old draft', status: 'draft' },
];

const runs = [
  { metrics: { cost_usd_real: 0.5, cost_usd_notional: 1.25 } },
  { metrics: { cost_usd_real: 1, cost_usd_notional: 2 } },
];

const digest = {
  health: {
    agents_total: 2,
    flagged: 1,
    agents: [
      { label: 'localapi', flags: [] },
      { label: 'daily-digest', flags: ['stale-log'] },
    ],
  },
};

test('answers pending count and titles', () => {
  const result = ask('what is pending?', { proposals });
  assert.match(result.answer, /2 pending proposals/);
  assert.match(result.answer, /Refresh stale panel/);
  assert.match(result.answer, /Trim noisy alert/);
});

test('counts only the latest revision of each proposal', () => {
  const revised = [
    { proposal_id: 'p1', title: 'Already handled', status: 'pending_approval' },
    { proposal_id: 'p2', title: 'Still pending', status: 'pending_approval' },
    { proposal_id: 'p1', title: 'Already handled', status: 'approved' },
  ];
  assert.match(ask('what is pending?', { proposals: revised }).answer, /^1 pending proposal:/);
  assert.match(ask('what is approved?', { proposals: revised }).answer, /^1 approved proposal:/);
});

test('answers cost totals across runs', () => {
  assert.equal(ask('money spent', { runs }).answer, '$1.50 real / $3.25 notional across 2 runs.');
});

test('answers health from latest digest', () => {
  const result = ask('agent health', { digest });
  assert.match(result.answer, /2 agents, 1 flagged/);
  assert.match(result.answer, /daily-digest: stale-log/);
});

test('unknown question returns fallback', () => {
  const result = ask('what should I eat?', {});
  assert.match(result.answer, /I don't know how to answer that yet/);
});

test('empty data is graceful', () => {
  assert.equal(ask('runs', { runs: [] }).answer, '0 runs. Latest run: none.');
  assert.equal(ask('recent activity', { decisions: [], proposals: [] }).answer, 'No recent decisions.');
});
