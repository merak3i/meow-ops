import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  appendLearningEvent, appendVerifiedLearningProof, buildLearningQuestSnapshot, deleteLearningTopic, RECALL_DAYS,
  readLearningTopics, upsertLearningTopic,
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
  appendLearningEvent({ topic_id: topic.topic_id, action: 'pr_verified', result: 'passed', proof_fingerprint: 'sha256:opaque' });
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'shipped');
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
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' });
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_failed', result: 'failed' });
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
  assert.throws(() => record('commit_verified'), /verified proof fingerprint/);
  appendLearningEvent({ topic_id: topic.topic_id, action: 'commit_verified', result: 'passed', proof_fingerprint: 'sha256:opaque' });
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'shipped');
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
