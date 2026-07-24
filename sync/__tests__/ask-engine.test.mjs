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
  assert.match(result.answer, /not focused human work time/i);
  assert.equal(result.evidence[0].kind, 'session_aggregate');
});

test('built-in weekly project prompt ranks time instead of returning the latest project', () => {
  const result = ask('Which project received the most time this week?', {
    sessions: [
      { session_id: 'older-long', project: 'BergLabs', duration_seconds: 7200, started_at: '2026-07-14T08:00:00.000Z' },
      { session_id: 'latest-short', project: 'Meow Ops', duration_seconds: 300, started_at: '2026-07-15T11:00:00.000Z' },
    ],
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /^BergLabs has the largest recorded agent-session span this week/);
});

test('does not present impossible overlapping session spans as human weekly time', () => {
  const result = ask('Which project received the most time this week?', {
    sessions: [
      {
        session_id: 'long-lived-thread',
        project: 'TenderMoments',
        duration_seconds: 3_180_710,
        started_at: '2026-06-18T00:00:00.000Z',
        ended_at: '2026-07-25T12:00:00.000Z',
      },
    ],
    now: new Date('2026-07-25T12:00:00.000Z'),
  });
  assert.equal(result.gate, 'known_unknown');
  assert.match(result.answer, /will not present 883h 32m as human work time/i);
  assert.match(result.answer, /long-lived or overlapping agent threads/i);
  assert.match(result.answer, /workload signal/i);
  assert.ok(result.unknowns.some((item) => /Focused human work time/i.test(item)));
});

test('answers the current project from the most recent non-generic session', () => {
  const result = ask('what project am I working on right now?', {
    sessions: [
      { session_id: 'old', project: 'BergLabs', source: 'claude', started_at: '2026-07-18T09:00:00.000Z' },
      { session_id: 'generic', project: 'Downloads', source: 'codex', started_at: '2026-07-19T11:00:00.000Z' },
      { session_id: 'latest', project: 'Meow Ops', source: 'codex', started_at: '2026-07-19T10:00:00.000Z' },
    ],
  });
  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /Meow Ops/);
  assert.equal(result.evidence[0].ref, 'latest');
});

test('answers what a project learned and which agents know it', () => {
  const projectControls = [{
    project: { project_id: 'meow-ops-1', name: 'Meow Ops', aliases: ['meow-ops'] },
    agents: { observed: ['claude', 'codex'], blind_spots: ['antigravity', 'cursor', 'hermes'] },
    learning: {
      counts: { published: 1, proposed: 1 },
      candidates: [
        {
          learning_id: 'learn-1', title: 'Read evidence first', kind: 'practice',
          status: 'published', rationale: 'Prevents unsupported claims.',
          evidence: [{ kind: 'session', ref: 'latest' }],
        },
        {
          learning_id: 'learn-2', title: 'Create a repair skill', kind: 'skill',
          status: 'proposed', rationale: 'Repeated repair work.', evidence: [{ kind: 'session', ref: 'old' }],
        },
      ],
    },
  }];
  const learned = ask('what has Meow Ops learned?', { projectControls });
  assert.match(learned.answer, /Read evidence first/);
  assert.match(learned.answer, /1 pending owner review/);
  assert.equal(learned.evidence[0].ref, 'latest');

  const coverage = ask('which agents know Meow Ops?', { projectControls });
  assert.match(coverage.answer, /claude, codex/);
  assert.match(coverage.answer, /antigravity, cursor, hermes/);
});

test('answers recent project feature work from bounded local Git and agent evidence', () => {
  const result = ask('what happened in LCWI project in the last 3 days according to GitHub PRs?', {
    projectActivity: {
      requested: true,
      period: { label: 'the last 3 days', from: '2026-07-22T12:00:00.000Z', to: '2026-07-25T12:00:00.000Z' },
      project: { project_id: 'lcwi-1', name: 'LCWI' },
      git: {
        available: true,
        commits: [
          {
            sha: '4a87c4d094aaf1071d1daee0a84ce64e3ff78f38',
            short_sha: '4a87c4d',
            timestamp: '2026-07-23T12:51:05.000Z',
            subject: 'Merge pull request #29 from merak3i/fix/audit-remediation',
            body: 'Complete the 1CWI customer release path',
            pr_number: 29,
          },
          {
            sha: '9c25601a00000000000000000000000000000000',
            short_sha: '9c25601',
            timestamp: '2026-07-23T15:53:23.000Z',
            subject: 'feat(admin): add audited site operations',
            body: '',
            pr_number: null,
          },
        ],
      },
      events: [{
        event_id: 'evt_1', source: 'codex', timestamp: '2026-07-23T15:00:00.000Z',
        event_type: 'session_summary', content: 'Validated the customer release path.',
      }],
      evidence_total: 101,
    },
  });

  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /LCWI/);
  assert.match(result.answer, /1 merged GitHub PR/);
  assert.match(result.answer, /PR #29/);
  assert.match(result.answer, /Complete the 1CWI customer release path/);
  assert.match(result.answer, /add audited site operations/);
  assert.match(result.answer, /local Git history/i);
  assert.match(result.answer, /101 matching local agent evidence events/i);
  assert.match(result.answer, /bounded to 1/i);
  assert.ok(result.unknowns.some((item) => /100 matching local evidence events/i.test(item)));
  assert.ok(result.evidence.some((item) => item.ref === 'git:lcwi-1:4a87c4d'));
});

test('names an unregistered project instead of silently using the only catalog entry', () => {
  const result = ask('what happened in LCWI project in the last 3 days?', {
    projectActivity: {
      requested: true,
      period: { label: 'the last 3 days' },
      project: null,
      requested_project: 'LCWI',
      catalog_projects: [{ project_id: 'meow-ops-1', name: 'Meow Ops' }],
    },
  });

  assert.equal(result.gate, 'known_unknown');
  assert.match(result.answer, /LCWI/);
  assert.match(result.answer, /not registered/i);
  assert.doesNotMatch(result.answer, /Meow Ops has/);
  assert.match(result.next_question, /register LCWI/i);
});

test('asks for a project when a PR activity question names none', () => {
  const result = ask('what features were worked on according to the GitHub PR?', {
    projectActivity: {
      requested: true,
      period: { label: 'the last 7 days' },
      project: null,
      requested_project: null,
      catalog_projects: [
        { project_id: 'meow-ops-1', name: 'Meow Ops' },
        { project_id: 'lcwi-1', name: 'One Click Website India' },
      ],
    },
  });
  assert.equal(result.gate, 'known_unknown');
  assert.match(result.answer, /Name the registered project or repository/i);
  assert.doesNotMatch(result.answer, /that project is not registered/i);
});

test('coaches the next Builder Journey action from the safe learning projection', () => {
  const learningQuest = {
    topics: [{
      topic_id: 'cost-aware-router',
      title: 'Cost-Aware Agent Router',
      stage: 'practiced',
      recall: { refresh_due: false },
      progress: { next_actions: ['tests_passed', 'broken_case_repaired', 'feynman_passed'] },
    }],
    workshop: {
      state: 'active',
      focus_topic_id: 'cost-aware-router',
      can_resume: true,
      reminder: 'Continue one honest proof.',
    },
    analytics: { recall: { refresh_due: 0 } },
  };
  const result = ask('what should I learn next?', { learningQuest });
  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /Cost-Aware Agent Router/);
  assert.match(result.answer, /tests pass/i);
  assert.match(result.answer, /Builder's Journey/);
  assert.equal(result.evidence[0].kind, 'learning_quest');
});

test('coaches non-code learning actions in plain action language', () => {
  const result = ask('what should I learn next?', {
    learningQuest: {
      topics: [{
        topic_id: 'marketing-proof-story',
        title: 'Marketing Proof Story',
        lane: 'marketing',
        stage: 'discovered',
        recall: { refresh_due: false },
        progress: { next_actions: ['story_drafted'] },
      }],
      workshop: { state: 'active', focus_topic_id: 'marketing-proof-story' },
      analytics: { recall: { refresh_due: 0 } },
    },
  });
  assert.match(result.answer, /draft the evidence-led story next/i);
  assert.doesNotMatch(result.answer, /story drafted next/i);
});

test('reports due recall from the learning projection without exposing private records', () => {
  const result = ask('what recall is due?', {
    learningQuest: {
      topics: [
        { title: 'Structured Output', recall: { refresh_due: true }, progress: { action_count: 1, next_actions: [] } },
        { title: 'Agent Routing', recall: { refresh_due: false }, progress: { action_count: 1, next_actions: [] } },
      ],
      workshop: { state: 'none' },
      analytics: { recall: { refresh_due: 1 } },
    },
  });
  assert.equal(result.gate, 'known_known');
  assert.match(result.answer, /1 recall check is due/);
  assert.match(result.answer, /Structured Output/);
});

test('does not call untouched learning topics due for recall', () => {
  const result = ask('what recall is due?', {
    learningQuest: {
      topics: [{
        title: 'Untouched Topic',
        recall: { refresh_due: true },
        progress: { action_count: 0, next_actions: ['lesson_opened'] },
      }],
      workshop: { state: 'none' },
      analytics: { recall: { refresh_due: 0 } },
    },
  });
  assert.match(result.answer, /No recall check is due/i);
  assert.doesNotMatch(result.answer, /Untouched Topic/);
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
