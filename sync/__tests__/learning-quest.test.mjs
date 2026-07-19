import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendLearningEvent, buildLearningQuestSnapshot, deleteLearningTopic, RECALL_DAYS,
  readLearningTopics, upsertLearningTopic,
} from '../learning-quest.mjs';

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
  const record = (action, result = 'completed') => appendLearningEvent({ topic_id: topic.topic_id, action, result });
  record('lesson_opened'); record('concept_preview_completed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'discovered');
  record('exercise_attempted'); record('code_changed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'practiced');
  record('tests_passed', 'passed'); record('broken_case_repaired', 'passed'); record('feynman_passed', 'passed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'proven');
  record('pr_verified', 'passed');
  assert.equal(buildLearningQuestSnapshot().topics[0].stage, 'shipped');
}));

test('failed recall preserves mastery while reducing confidence and scheduling refresh', () => withQuest(() => {
  upsertLearningTopic(topic);
  for (const action of ['lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
    'tests_passed', 'broken_case_repaired', 'feynman_passed']) {
    appendLearningEvent({ topic_id: topic.topic_id, action, result: 'passed' });
  }
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_passed', result: 'passed' });
  appendLearningEvent({ topic_id: topic.topic_id, action: 'recall_failed', result: 'failed' });
  const row = buildLearningQuestSnapshot().topics[0];
  assert.equal(row.stage, 'proven');
  assert.equal(row.recall.refresh_due, true);
  assert.equal(row.recall.confidence, 0.5);
  assert.equal(RECALL_DAYS.at(-1), 360);
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
