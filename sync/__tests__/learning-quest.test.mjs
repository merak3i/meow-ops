import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  appendLearningEvent, appendOwnerConfirmedLearningOutcome, appendVerifiedLearningProof,
  buildLearningQuestSnapshot, deleteLearningTopic, RECALL_DAYS, readLearningTopics,
  updateLearningWorkshop, upsertLearningTopic,
} from '../learning-quest.mjs';
import { AGENT_ENGINEERING_CURRICULUM, SIDE_QUESTS } from '../learning-quest-curriculum.mjs';

function withQuest(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-learning-quest-'));
  const previous = process.env.MEOW_LEARNING_QUEST_DIR;
  process.env.MEOW_LEARNING_QUEST_DIR = dir;
  try { return fn(dir); } finally {
    if (previous === undefined) delete process.env.MEOW_LEARNING_QUEST_DIR;
    else process.env.MEOW_LEARNING_QUEST_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const topic = {
  topic_id: 'structured-output', title: 'Structured output',
  summary: 'A schema accepts valid agent responses and rejects malformed responses',
  lane: 'code', difficulty: 1, tags: ['reliability'], approved_for_projection: true,
  source_project_id: 'private-patherle-id',
};

test('topic CRUD stays private and projects only explicitly approved concepts', () => withQuest((dir) => {
  upsertLearningTopic(topic);
  upsertLearningTopic({ ...topic, topic_id: 'private-topic', title: 'Private', approved_for_projection: false });
  assert.equal(readLearningTopics().length, 2);
  const snapshot = buildLearningQuestSnapshot();
  assert.deepEqual(snapshot.topics.map((row) => row.topic_id), ['structured-output']);
  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, /private-patherle-id|source_project|learning-state|\.meow|path|evidence|metadata/i);
  assert.equal(readFileSync(join(dir, 'topics.json'), 'utf8').includes('private-patherle-id'), true);
  assert.deepEqual(deleteLearningTopic('private-topic'), { topic_id: 'private-topic', deleted: true });
}));

test('mastery is derived from evidence actions instead of a mutable checkbox', () => withQuest(() => {
  upsertLearningTopic(topic);
  const record = (action, result = 'completed') => appendLearningEvent({
    topic_id: topic.topic_id, action, result,
    rubric: action === 'feynman_passed' ? { accuracy: 1, clarity: 1, causality: 1, transfer: 1 } : undefined,
  });
  record('lesson_opened'); record('concept_preview_completed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'discovered');
  record('exercise_attempted'); record('code_changed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'practiced');
  record('tests_passed', 'passed'); record('broken_case_repaired', 'passed'); record('feynman_passed', 'passed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'proven');
  assert.throws(
    () => appendLearningEvent({ topic_id: topic.topic_id, action: 'pr_verified', result: 'passed', proof_fingerprint: 'sha256:opaque' }),
    /verifier-owned/,
  );
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'proven');
}));

test('failed recall preserves mastery while reducing confidence and scheduling refresh', () => withQuest(() => {
  upsertLearningTopic(topic);
  for (const action of ['lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
    'tests_passed', 'broken_case_repaired', 'feynman_passed']) {
    appendLearningEvent({
      topic_id: topic.topic_id, action, result: 'passed',
      rubric: action === 'feynman_passed' ? { accuracy: 1, clarity: 1, causality: 1, transfer: 1 } : undefined,
    });
  }
  const firstRecall = Date.parse('2026-07-20T10:00:00.000Z');
  appendLearningEvent(
    { topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' },
    { now: firstRecall },
  );
  appendLearningEvent(
    { topic_id: topic.topic_id, action: 'recall_failed', result: 'failed' },
    { now: firstRecall + 86_400_000 },
  );
  const row = buildLearningQuestSnapshot().topics[0];
  assert.equal(row.stage, 'proven');
  assert.equal(row.recall.refresh_due, true);
  assert.equal(row.recall.confidence, 0.5);
  assert.equal(row.recall.interval_days, 1);
  assert.equal(RECALL_DAYS.at(-1), 360);
}));

test('projection rejects identifying concepts and shipping claims without proof', () => withQuest(() => {
  assert.throws(() => upsertLearningTopic({ ...topic, summary: 'Read /Users/name/private.json' }), /private or identifying/);
  upsertLearningTopic(topic);
  const record = (action) => appendLearningEvent({
    topic_id: topic.topic_id, action, result: 'passed',
    rubric: action === 'feynman_passed' ? { accuracy: 1, clarity: 1, causality: 1, transfer: 1 } : undefined,
  });
  for (const action of ['lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
    'tests_passed', 'broken_case_repaired', 'feynman_passed']) record(action);
  assert.throws(() => record('commit_verified'), /verifier-owned/);
  assert.throws(
    () => appendLearningEvent({ topic_id: topic.topic_id, action: 'commit_verified', result: 'passed', proof_fingerprint: 'sha256:opaque' }),
    /verifier-owned/,
  );
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'proven');
}));

test('local Git verifier derives opaque shipped proof without projecting commit data', () => withQuest((dir) => {
  const repo = join(dir, 'source');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'learning@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Learning Test']);
  writeFileSync(join(repo, 'work.txt'), 'verified work\n');
  execFileSync('git', ['-C', repo, 'add', 'work.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'prove work']);
  upsertLearningTopic({ ...topic, source_project_root: repo });
  assert.throws(() => appendVerifiedLearningProof({ topic_id: topic.topic_id, action: 'commit_verified' }), /no new commit/);
  writeFileSync(join(repo, 'work.txt'), 'verified work\nnew learning proof\n');
  execFileSync('git', ['-C', repo, 'add', 'work.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'complete learning proof']);
  for (const action of ['lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
    'tests_passed', 'broken_case_repaired']) {
    appendLearningEvent({ topic_id: topic.topic_id, action, result: 'passed' });
  }
  appendLearningEvent({
    topic_id: topic.topic_id, action: 'feynman_passed', result: 'passed',
    rubric: { accuracy: 1, clarity: 1, causality: 1, transfer: 1 },
  });
  appendVerifiedLearningProof({ topic_id: topic.topic_id, action: 'commit_verified' });
  assert.throws(
    () => appendVerifiedLearningProof({ topic_id: topic.topic_id, action: 'commit_verified' }),
    /already recorded/,
  );
  const snapshot = buildLearningQuestSnapshot();
  assert.equal(snapshot.topics[0].stage, 'shipped');
  assert.doesNotMatch(JSON.stringify(snapshot), /source_project|[a-f0-9]{40}|work\.txt|proof_fingerprint/);
}));

test('snapshot exposes next evidence and aggregate analytics without raw events', () => withQuest(() => {
  upsertLearningTopic(topic);
  appendLearningEvent({ topic_id: topic.topic_id, action: 'lesson_opened', assistance: 'none', duration_seconds: 90 });
  const snapshot = buildLearningQuestSnapshot();
  assert.deepEqual(snapshot.topics[0].progress.completed_actions, ['lesson_opened']);
  assert.deepEqual(snapshot.topics[0].progress.next_actions, ['concept_preview_completed']);
  assert.equal(snapshot.analytics.independence.unassisted_rate, 1);
  assert.equal(snapshot.analytics.effort.average_duration_seconds, 90);
  assert.equal(snapshot.rewards.xp, 25);
  assert.equal(snapshot.rewards.level, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /occurred_at|event_id|proof_fingerprint/);
}));

test('Feynman proof requires complete rubric evidence', () => withQuest(() => {
  upsertLearningTopic(topic);
  for (const action of ['lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed']) {
    appendLearningEvent({ topic_id: topic.topic_id, action, result: 'passed' });
  }
  assert.throws(() => appendLearningEvent({
    topic_id: topic.topic_id, action: 'feynman_passed', result: 'passed',
    rubric: { accuracy: 1, clarity: 1, causality: 1, transfer: 0 },
  }), /four rubric dimensions/);
}));

test('random questions vary deterministically without private source material', () => withQuest(() => {
  upsertLearningTopic(topic);
  const first = buildLearningQuestSnapshot().topics[0].next_question;
  appendLearningEvent({ topic_id: topic.topic_id, action: 'lesson_opened' });
  const second = buildLearningQuestSnapshot().topics[0].next_question;
  assert.notEqual(first.kind, second.kind);
  assert.doesNotMatch(JSON.stringify([first, second]), /patherle|private|path|evidence/i);
}));

test('event boundary rejects arbitrary actions and unknown topics', () => withQuest(() => {
  upsertLearningTopic(topic);
  assert.throws(() => appendLearningEvent({ topic_id: topic.topic_id, action: 'set_stage_shipped' }), /unsupported action/);
  assert.throws(() => appendLearningEvent({ topic_id: 'missing', action: 'lesson_opened' }), /topic not found/);
}));

test('recall checks cannot be replayed before the server-derived due time', () => withQuest(() => {
  upsertLearningTopic(topic);
  appendLearningEvent({ topic_id: topic.topic_id, action: 'lesson_opened' }, {
    now: Date.parse('2026-07-20T10:00:00.000Z'),
  });
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' }, {
    now: Date.parse('2026-07-20T10:00:01.000Z'),
  });
  assert.throws(
    () => appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' }, {
      now: Date.parse('2026-07-20T10:00:02.000Z'),
    }),
    /not due yet/,
  );
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' }, {
    now: Date.parse('2026-07-21T10:00:02.000Z'),
  });
  assert.equal(buildLearningQuestSnapshot({ now: Date.parse('2026-07-21T10:00:02.000Z') }).analytics.recall.attempts, 2);
}));

test('failed recall waits for its one-day server-derived interval', () => withQuest(() => {
  upsertLearningTopic(topic);
  appendLearningEvent({ topic_id: topic.topic_id, action: 'lesson_opened' }, {
    now: Date.parse('2026-07-20T10:00:00.000Z'),
  });
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_failed', result: 'failed' }, {
    now: Date.parse('2026-07-20T10:00:01.000Z'),
  });
  assert.throws(
    () => appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' }, {
      now: Date.parse('2026-07-20T10:00:02.000Z'),
    }),
    /not due yet/,
  );
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' }, {
    now: Date.parse('2026-07-21T10:00:01.000Z'),
  });
  assert.equal(buildLearningQuestSnapshot({ now: Date.parse('2026-07-21T10:00:01.000Z') }).analytics.recall.attempts, 2);
}));

test('unfinished workshops expose gentle aggregate health without continuity records', () => withQuest((dir) => {
  upsertLearningTopic(topic);
  const started = Date.parse('2026-07-11T10:00:00.000Z');
  updateLearningWorkshop({ action: 'start', topic_ids: [topic.topic_id] }, { now: started });
  const snapshot = buildLearningQuestSnapshot({ now: started + 8 * 86_400_000 });
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.workshop.state, 'active');
  assert.equal(snapshot.workshop.age_days, 8);
  assert.equal(snapshot.workshop.health, 28);
  assert.equal(snapshot.workshop.can_resume, true);
  assert.match(snapshot.workshop.reminder, /Last weekend/);
  assert.doesNotMatch(JSON.stringify(snapshot), /started_at|last_activity_at|completed_at|baseline_action_counts|workshop_id/);
  assert.match(readFileSync(join(dir, 'workshops.json'), 'utf8'), /started_at/);
}));

test('workshops require a real learning action before completion', () => withQuest(() => {
  upsertLearningTopic(topic);
  updateLearningWorkshop({ action: 'start', topic_ids: [topic.topic_id] });
  assert.throws(() => updateLearningWorkshop({ action: 'complete' }), /complete one learning action/);
  appendLearningEvent({ topic_id: topic.topic_id, action: 'lesson_opened' });
  const progressed = buildLearningQuestSnapshot();
  assert.equal(progressed.workshop.completed_count, 1);
  assert.equal(progressed.workshop.can_complete, true);
  updateLearningWorkshop({ action: 'complete' });
  assert.equal(buildLearningQuestSnapshot().workshop.state, 'none');
}));

test('active workshop topics cannot be deleted and workshops can be abandoned safely', () => withQuest(() => {
  upsertLearningTopic(topic);
  updateLearningWorkshop({ action: 'start', topic_ids: [topic.topic_id] });
  assert.throws(() => deleteLearningTopic(topic.topic_id), /active workshop/);
  updateLearningWorkshop({ action: 'abandon' });
  assert.equal(buildLearningQuestSnapshot().workshop.state, 'none');
  assert.deepEqual(deleteLearningTopic(topic.topic_id), { topic_id: topic.topic_id, deleted: true });
}));

test('rewards and guidance project decisions instead of raw learning rows', () => withQuest(() => {
  upsertLearningTopic(topic);
  appendLearningEvent({ topic_id: topic.topic_id, action: 'lesson_opened', assistance: 'none' });
  const snapshot = buildLearningQuestSnapshot();
  assert.equal(snapshot.rewards.dimensions.independence, 1);
  assert.equal(snapshot.analytics.guidance.next_intervention, 'refresh_due_recall');
  assert.ok(['rising', 'steady', 'falling'].includes(snapshot.analytics.guidance.independence_direction));
  assert.doesNotMatch(JSON.stringify(snapshot.analytics.guidance), /occurred_at|event_id|proof/i);
}));

test('built-in curriculum is generic, sequential, and projection-safe', () => withQuest(() => {
  assert.equal(AGENT_ENGINEERING_CURRICULUM.length, 12);
  assert.equal(SIDE_QUESTS.length, 4);
  for (const row of [...AGENT_ENGINEERING_CURRICULUM, ...SIDE_QUESTS]) upsertLearningTopic(row);
  const snapshot = buildLearningQuestSnapshot();
  assert.equal(snapshot.topics.length, 16);
  assert.equal(snapshot.analytics.recall.refresh_due, 0);
  assert.deepEqual(AGENT_ENGINEERING_CURRICULUM[1].prerequisite_ids, ['structured-output-agent']);
  assert.doesNotMatch(JSON.stringify(snapshot), /patherle|berglabs|\/Users\/|https?:\/\//i);
}));

test('business lanes use independent mastery evidence instead of code-only actions', () => withQuest(() => {
  const paths = [
    ['product', ['product_slice_attempted', 'acceptance_criteria_written'], 'acceptance_checked'],
    ['marketing', ['story_drafted', 'claim_evidence_checked'], 'audience_tested'],
    ['gtm', ['experiment_designed', 'channel_tested'], 'signal_reviewed'],
    ['sales', ['qualification_practiced', 'objection_repaired'], 'commitment_reviewed'],
  ];
  for (const [lane, practiced, proven] of paths) {
    const id = `${lane}-topic`;
    upsertLearningTopic({
      ...topic, topic_id: id, title: `${lane} proof`, lane,
    });
    appendLearningEvent({ topic_id: id, action: 'lesson_opened' });
    appendLearningEvent({ topic_id: id, action: 'concept_preview_completed' });
    for (const action of practiced) appendLearningEvent({ topic_id: id, action });
    assert.equal(buildLearningQuestSnapshot().topics.find((row) => row.topic_id === id).stage, 'practiced');
    appendLearningEvent({ topic_id: id, action: proven, result: 'passed' });
    appendLearningEvent({ topic_id: id, action: 'broken_case_repaired', result: 'passed' });
    appendLearningEvent({
      topic_id: id, action: 'feynman_passed', result: 'passed',
      rubric: { accuracy: 1, clarity: 1, causality: 1, transfer: 1 },
    });
    assert.equal(buildLearningQuestSnapshot().topics.find((row) => row.topic_id === id).stage, 'proven');
    const outcomeKinds = {
      product: 'accepted_product_result',
      marketing: 'published_marketing_asset',
      gtm: 'reviewed_experiment_signal',
      sales: 'reviewed_customer_commitment',
    };
    appendOwnerConfirmedLearningOutcome({
      topic_id: id,
      outcome_kind: outcomeKinds[lane],
      note: `I checked the real ${lane} outcome in its work surface and observed the intended result.`,
      confirmed: true,
    });
    assert.equal(buildLearningQuestSnapshot().topics.find((row) => row.topic_id === id).stage, 'shipped');
  }
}));

test('non-code shipped proof is lane-bound, owner-confirmed, and deduplicated', () => withQuest(() => {
  const row = { ...topic, topic_id: 'marketing-outcome', title: 'Marketing outcome', lane: 'marketing' };
  upsertLearningTopic(row);
  for (const action of [
    'lesson_opened', 'concept_preview_completed', 'story_drafted', 'claim_evidence_checked',
    'audience_tested', 'broken_case_repaired',
  ]) appendLearningEvent({ topic_id: row.topic_id, action, result: 'passed' });
  appendLearningEvent({
    topic_id: row.topic_id, action: 'feynman_passed', result: 'passed',
    rubric: { accuracy: 1, clarity: 1, causality: 1, transfer: 1 },
  });
  const input = {
    topic_id: row.topic_id,
    outcome_kind: 'published_marketing_asset',
    note: 'I opened the published asset and checked every claim against its visible evidence.',
    confirmed: true,
  };
  assert.throws(() => appendOwnerConfirmedLearningOutcome({ ...input, confirmed: false }), /owner confirmation/);
  assert.throws(() => appendOwnerConfirmedLearningOutcome({
    ...input, outcome_kind: 'reviewed_customer_commitment',
  }), /does not match/);
  appendOwnerConfirmedLearningOutcome(input);
  assert.equal(buildLearningQuestSnapshot().topics.find((topicRow) => topicRow.topic_id === row.topic_id).stage, 'shipped');
  assert.throws(() => appendOwnerConfirmedLearningOutcome(input), /already recorded/);
}));
