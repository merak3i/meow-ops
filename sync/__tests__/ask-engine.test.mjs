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

test('answers the highest-time project from verified session evidence', () => {
  const sessions = [
    { project: 'BergLabs', duration_seconds: 5400, started_at: '2026-07-14T08:00:00.000Z', source: 'codex' },
    { project: 'BergLabs', duration_seconds: 1800, started_at: '2026-07-15T08:00:00.000Z', source: 'claude' },
    { project: 'Patherle', duration_seconds: 3600, started_at: '2026-07-15T09:00:00.000Z', source: 'codex' },
  ];
  const result = ask('what project did I spend the most time on this week?', {
    sessions,
    now: new Date('2026-07-15T12:00:00.000Z'),
  });

  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /BergLabs/);
  assert.match(result.answer, /2h/);
  assert.match(result.answer, /2 sessions/);
  assert.equal(result.evidence[0].kind, 'session_aggregate');
});

test('project-time ranking ignores generic container folders', () => {
  const result = ask('what project did I spend the most time on all time?', {
    sessions: [
      { project: 'Downloads', duration_seconds: 7200, started_at: '2026-07-15T00:00:00.000Z' },
      { project: 'repos', duration_seconds: 5400, started_at: '2026-07-15T00:00:00.000Z' },
      { project: 'BergLabs', duration_seconds: 3600, started_at: '2026-07-15T00:00:00.000Z' },
    ],
  });

  assert.match(result.answer, /^BergLabs/);
});

test('owner-taught aliases roll folder variants into one canonical project', () => {
  const result = ask('what project did I spend the most time on all time?', {
    sessions: [
      { project: 'Patherle', duration_seconds: 1800, started_at: '2026-07-15T00:00:00.000Z' },
      { project: 'patherle-main-fix', duration_seconds: 3600, started_at: '2026-07-15T01:00:00.000Z' },
      { project: 'BergLabs', duration_seconds: 4000, started_at: '2026-07-15T02:00:00.000Z' },
    ],
    claims: [{
      claim_id: 'claim_patherle_alias', project_id: 'patherle', project_name: 'Patherle',
      field: 'alias', value: 'patherle-main-fix', status: 'owner_confirmed', source: 'owner',
      confidence: 1, recorded_at: '2026-07-15T00:00:00.000Z',
    }],
  });

  assert.match(result.answer, /^Patherle/);
  assert.match(result.answer, /1h 30m/);
});

test('answers a project vision only when the owner-confirmed claim exists', () => {
  const result = ask('what is the vision for Patherle?', {
    claims: [{
      claim_id: 'claim_patherle_vision',
      project_id: 'patherle',
      project_name: 'Patherle',
      field: 'vision',
      value: 'Ship a secure, bug-free beta for first users.',
      status: 'owner_confirmed',
      source: 'owner',
      confidence: 1,
      recorded_at: '2026-07-15T00:00:00.000Z',
    }],
  });

  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /secure, bug-free beta/);
  assert.equal(result.claim_id, 'claim_patherle_vision');
});

test('asks one focused teaching question when a project fact is known missing', () => {
  const result = ask('what is the vision for BergLabs?', {
    sessions: [{ project: 'BergLabs', duration_seconds: 60, started_at: '2026-07-15T00:00:00.000Z' }],
  });

  assert.equal(result.gate, 'known_unknown');
  assert.equal(result.next_question, 'What is the current vision for BergLabs?');
  assert.deepEqual(result.learning, {
    project_id: 'berglabs', project_name: 'BergLabs', field: 'vision',
  });
});

test('labels an inferred project claim as an unknown known hypothesis', () => {
  const result = ask('what is the priority for Meow Ops?', {
    sessions: [{ project: 'meow-ops', duration_seconds: 60, started_at: '2026-07-15T00:00:00.000Z' }],
    claims: [{
      claim_id: 'claim_meow_priority',
      project_id: 'meow-ops',
      project_name: 'Meow Ops',
      field: 'priority',
      value: 'Internal agentic workflow experimentation.',
      status: 'inferred',
      source: 'session_pattern',
      confidence: 0.65,
      recorded_at: '2026-07-15T00:00:00.000Z',
    }],
  });

  assert.equal(result.gate, 'unknown_known');
  assert.match(result.answer, /possible priority/);
  assert.equal(result.claim_status, 'inferred');
});

test('lists explicit known unknowns for a named project', () => {
  const result = ask("what don't you know about BergLabs?", {
    claims: [{
      claim_id: 'claim_berglabs_vision', project_id: 'berglabs', project_name: 'BergLabs',
      field: 'vision', value: 'Agentic operations.', status: 'owner_confirmed', source: 'owner',
      confidence: 1, recorded_at: '2026-07-15T00:00:00.000Z',
    }],
  });

  assert.equal(result.gate, 'known_unknown');
  assert.match(result.answer, /mission/);
  assert.match(result.answer, /current phase/);
  assert.doesNotMatch(result.answer, /vision/);
  assert.equal(result.learning.project_name, 'BergLabs');
});

test('answers health from latest digest', () => {
  const result = ask('agent health', { digest });
  assert.match(result.answer, /2 agents, 1 flagged/);
  assert.match(result.answer, /daily-digest: stale-log/);
});

test('unknown question returns fallback', () => {
  const result = ask('what should I eat?', {});
  assert.match(result.answer, /I don't know how to answer that from local evidence yet/);
  assert.equal(result.gate, 'unknown_unknown');
  assert.match(result.next_question, /evidence source/i);
});

test('answers sync health and creates an evidence-bound repair prompt', () => {
  const sync = {
    state: 'failed',
    phase: 'export_sessions',
    artifact: { sessions: 42 },
    failure: { stage: 'export_sessions', code: 'exit_1', summary: 'Session export did not complete successfully.' },
  };
  assert.match(ask('is sync healthy?', { sync }).answer, /failed at export_sessions/);
  const repair = ask('prepare a repair prompt', { sync }).answer;
  assert.match(repair, /Evidence code: exit_1/);
  assert.match(repair, /smallest fix/);
});

test('sync health distinguishes the complete archive from the bounded browser preview', () => {
  const sync = {
    state: 'succeeded',
    artifact: {
      sessions: 1000,
      source_counts: { codex: 800, claude: 150, cursor: 50 },
    },
  };
  const sessionHistory = {
    archive: { total: 1929 },
    facets: { sources: ['claude', 'codex', 'cursor'] },
  };

  const answer = ask('is sync healthy?', { sync, sessionHistory }).answer;
  assert.match(answer, /complete local archive contains 1,929 sessions across 3 sources/i);
  assert.match(answer, /newest 1,000/i);
  assert.doesNotMatch(answer, /verified 1000 sessions/i);
});

test('fix-next prioritizes a failed sync before proposals', () => {
  const answer = ask('what should I fix next?', {
    proposals,
    digest,
    sync: { state: 'failed', failure: { stage: 'verify_artifacts', summary: 'Missing artifact', code: 'missing' } },
  }).answer;
  assert.match(answer, /failed at verify_artifacts/);
});

test('empty data is graceful', () => {
  assert.equal(ask('runs', { runs: [] }).answer, '0 runs. Latest run: none.');
  assert.equal(ask('recent activity', { decisions: [], proposals: [] }).answer, 'No recent decisions.');
});
