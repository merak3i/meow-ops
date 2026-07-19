// Private learning ledger and public-safe projection for Learning Quest.
// Raw project learning, evidence, paths, and artifact metadata never enter snapshots.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const MASTERY_STAGES = ['discovered', 'practiced', 'proven', 'shipped'];
export const LEARNING_LANES = ['code', 'product', 'marketing', 'gtm', 'sales'];
export const RECALL_DAYS = [0, 1, 3, 7, 14, 30, 60, 90, 180, 270, 360];

const ACTIONS = new Set([
  'lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
  'tests_passed', 'broken_case_repaired', 'feynman_passed', 'recall_passed', 'recall_failed',
  'commit_verified', 'pr_verified', 'release_verified', 'production_verified',
]);
const ASSISTANCE = new Set(['none', 'scaffold', 'hint', 'explanation', 'partial_solution', 'full_solution']);
const FORBIDDEN_KEYS = /(?:path|root|remote|evidence|artifact|metadata|timestamp|session|hash|content|excerpt|prompt|customer)/i;
const STAGE_RULES = {
  discovered: ['lesson_opened', 'concept_preview_completed'],
  practiced: ['exercise_attempted', 'code_changed'],
  proven: ['tests_passed', 'broken_case_repaired', 'feynman_passed'],
  shipped: ['commit_verified|pr_verified|release_verified|production_verified'],
};

const clean = (value, name, max = 240) => {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new Error(`[learning-quest] invalid ${name}`);
  return text;
};
const bounded = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};
const safeId = (value, name = 'id') => {
  const id = clean(value, name, 100);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`[learning-quest] unsafe ${name}`);
  return id;
};

export function resolveLearningQuestDir(env = process.env) {
  return resolve(env.MEOW_LEARNING_QUEST_DIR || join(homedir(), '.meow-ops', 'learning-quest'));
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function topicsPath() { return join(resolveLearningQuestDir(), 'topics.json'); }
function eventsPath() { return join(resolveLearningQuestDir(), 'events.jsonl'); }

export function readLearningTopics() {
  const rows = readJson(topicsPath(), []);
  return Array.isArray(rows) ? rows : [];
}

export function upsertLearningTopic(input = {}) {
  const topic = {
    topic_id: safeId(input.topic_id || `topic-${Date.now().toString(36)}`, 'topic_id'),
    title: clean(input.title, 'title', 120),
    summary: clean(input.summary, 'summary', 500),
    lane: LEARNING_LANES.includes(input.lane) ? input.lane : 'code',
    difficulty: Math.max(1, Math.min(5, Number(input.difficulty) || 1)),
    tags: [...new Set((Array.isArray(input.tags) ? input.tags : []).map((tag) => safeId(tag, 'tag'))) ].slice(0, 12),
    prerequisite_ids: [...new Set((Array.isArray(input.prerequisite_ids) ? input.prerequisite_ids : [])
      .map((id) => safeId(id, 'prerequisite_id'))) ],
    approved_for_projection: input.approved_for_projection === true,
    // Private linkage is stored locally and intentionally omitted from every projection.
    source_project_id: input.source_project_id ? clean(input.source_project_id, 'source_project_id', 160) : null,
  };
  const rows = readLearningTopics().filter((row) => row.topic_id !== topic.topic_id);
  rows.push(topic);
  atomicJson(topicsPath(), rows.sort((a, b) => a.topic_id.localeCompare(b.topic_id)));
  return topic;
}

export function deleteLearningTopic(topicId) {
  const id = safeId(topicId, 'topic_id');
  const rows = readLearningTopics();
  const next = rows.filter((row) => row.topic_id !== id);
  if (next.length === rows.length) throw new Error('[learning-quest] topic not found');
  atomicJson(topicsPath(), next);
  return { topic_id: id, deleted: true };
}

export function readLearningEvents() {
  try {
    return readFileSync(eventsPath(), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch { return []; }
}

export function appendLearningEvent(input = {}) {
  const topic_id = safeId(input.topic_id, 'topic_id');
  if (!readLearningTopics().some((row) => row.topic_id === topic_id)) throw new Error('[learning-quest] topic not found');
  const action = clean(input.action, 'action', 80);
  if (!ACTIONS.has(action)) throw new Error('[learning-quest] unsupported action');
  const result = ['passed', 'partial', 'failed', 'completed'].includes(input.result) ? input.result : 'completed';
  const event = {
    event_id: `lqe_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`,
    topic_id, action, result,
    occurred_at: new Date(input.occurred_at || Date.now()).toISOString(),
    duration_seconds: Math.max(0, Math.min(86_400, Number(input.duration_seconds) || 0)),
    attempts: Math.max(1, Math.min(100, Number(input.attempts) || 1)),
    hints: Math.max(0, Math.min(100, Number(input.hints) || 0)),
    assistance: ASSISTANCE.has(input.assistance) ? input.assistance : 'none',
    confidence_before: bounded(input.confidence_before),
    confidence_after: bounded(input.confidence_after),
    rubric: {
      accuracy: bounded(input.rubric?.accuracy), clarity: bounded(input.rubric?.clarity),
      causality: bounded(input.rubric?.causality), transfer: bounded(input.rubric?.transfer),
    },
    proof_fingerprint: input.proof_fingerprint ? clean(input.proof_fingerprint, 'proof_fingerprint', 120) : null,
  };
  mkdirSync(dirname(eventsPath()), { recursive: true });
  appendFileSync(eventsPath(), `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return event;
}

function masteryFor(events) {
  const passed = new Set(events.filter((event) => ['passed', 'completed'].includes(event.result)).map((event) => event.action));
  let stage = null;
  for (const name of MASTERY_STAGES) {
    const met = STAGE_RULES[name].every((rule) => rule.split('|').some((action) => passed.has(action)));
    if (!met) break;
    stage = name;
  }
  return stage;
}

function recallFor(events, now) {
  const checks = events.filter((event) => event.action === 'recall_passed' || event.action === 'recall_failed');
  const passes = checks.filter((event) => event.action === 'recall_passed').length;
  const interval = RECALL_DAYS[Math.min(passes, RECALL_DAYS.length - 1)];
  const latest = checks.at(-1)?.occurred_at || events.at(-1)?.occurred_at || new Date(now).toISOString();
  return {
    confidence: checks.length ? passes / checks.length : 0,
    refresh_due: checks.at(-1)?.action === 'recall_failed',
    interval_days: interval,
    next_due_at: new Date(Date.parse(latest) + interval * 86_400_000).toISOString(),
  };
}

function safeQuestion(topic, events) {
  const kinds = ['analogy', 'predict', 'debug', 'architecture', 'transfer'];
  const offset = createHash('sha256').update(topic.topic_id).digest().readUInt32BE(0) % kinds.length;
  const kind = kinds[(offset + events.length) % kinds.length];
  const prompts = {
    analogy: `Explain ${topic.title} using an everyday analogy without jargon.`,
    predict: `Predict what should happen when ${topic.summary.toLowerCase()} succeeds and when it fails.`,
    debug: `Name one failure this ${topic.title} design must detect, then describe the repair.`,
    architecture: `Place ${topic.title} inside a larger system and explain its boundary.`,
    transfer: `Apply ${topic.title} to a different project without copying project-specific details.`,
  };
  return { question_id: `${topic.topic_id}-${events.length}-${kind}`, kind, question_text: prompts[kind] };
}

function assertProjectionSafe(value, trail = 'root') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new Error(`[learning-quest] forbidden projection key at ${trail}.${key}`);
    assertProjectionSafe(child, `${trail}.${key}`);
  }
}

export function buildLearningQuestSnapshot({ now = Date.now() } = {}) {
  const allEvents = readLearningEvents();
  const topics = readLearningTopics().filter((topic) => topic.approved_for_projection).map((topic) => {
    const events = allEvents.filter((event) => event.topic_id === topic.topic_id);
    const snapshot = {
      topic_id: topic.topic_id, title: topic.title, summary: topic.summary, lane: topic.lane,
      difficulty: topic.difficulty, tags: topic.tags, prerequisite_ids: topic.prerequisite_ids,
      stage: masteryFor(events), recall: recallFor(events, now), next_question: safeQuestion(topic, events),
      progress: { action_count: events.length, attempts: events.reduce((sum, row) => sum + row.attempts, 0) },
    };
    return snapshot;
  });
  const snapshot = {
    schema_version: 1,
    topics,
    summary: {
      total_topics: topics.length,
      by_stage: Object.fromEntries(MASTERY_STAGES.map((stage) => [stage, topics.filter((topic) => topic.stage === stage).length])),
      by_lane: Object.fromEntries(LEARNING_LANES.map((lane) => [lane, topics.filter((topic) => topic.lane === lane).length])),
      durable_capability: topics.length ? topics.reduce((sum, topic) => sum + topic.recall.confidence, 0) / topics.length : 0,
    },
  };
  assertProjectionSafe(snapshot);
  return snapshot;
}
