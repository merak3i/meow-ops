// Private learning ledger and public-safe projection for Learning Quest.
// Raw project learning, evidence, paths, and artifact metadata never enter snapshots.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const MASTERY_STAGES = ['discovered', 'practiced', 'proven', 'shipped'];
export const LEARNING_LANES = ['code', 'product', 'marketing', 'gtm', 'sales'];
export const RECALL_DAYS = [0, 1, 3, 7, 14, 30, 60, 90, 180, 270, 360];

const ACTIONS = new Set([
  'lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
  'tests_passed', 'broken_case_repaired', 'feynman_attempted', 'feynman_passed', 'recall_passed', 'recall_failed',
  'product_slice_attempted', 'acceptance_criteria_written', 'acceptance_checked',
  'story_drafted', 'claim_evidence_checked', 'audience_tested',
  'experiment_designed', 'channel_tested', 'signal_reviewed',
  'qualification_practiced', 'objection_repaired', 'commitment_reviewed',
  'outcome_owner_confirmed',
  'commit_verified', 'pr_verified', 'release_verified', 'production_verified',
]);
const ASSISTANCE = new Set(['none', 'scaffold', 'hint', 'explanation', 'partial_solution', 'full_solution']);
const FORBIDDEN_KEYS = /(?:path|root|remote|evidence|artifact|metadata|timestamp|session|hash|content|excerpt|prompt|customer)/i;
const SENSITIVE_CONCEPT = /(?:\b(?:patherle|berglabs|client|customer|secret|token|password|credential|private[_ -]?key)\b|https?:\/\/|(?:^|\s)(?:\.{0,2}\/|~\/|\/Users\/|[A-Za-z]:\\)|@[a-z0-9.-]+\.[a-z]{2,})/i;
const STAGE_RULES = {
  discovered: ['lesson_opened', 'concept_preview_completed'],
  practiced: ['exercise_attempted', 'code_changed'],
  proven: ['tests_passed', 'broken_case_repaired', 'feynman_passed'],
  shipped: ['commit_verified|pr_verified|release_verified|production_verified'],
};
const LANE_STAGE_RULES = {
  code: STAGE_RULES,
  product: {
    discovered: STAGE_RULES.discovered,
    practiced: ['product_slice_attempted', 'acceptance_criteria_written'],
    proven: ['acceptance_checked', 'broken_case_repaired', 'feynman_passed'],
    shipped: ['outcome_owner_confirmed'],
  },
  marketing: {
    discovered: STAGE_RULES.discovered,
    practiced: ['story_drafted', 'claim_evidence_checked'],
    proven: ['audience_tested', 'broken_case_repaired', 'feynman_passed'],
    shipped: ['outcome_owner_confirmed'],
  },
  gtm: {
    discovered: STAGE_RULES.discovered,
    practiced: ['experiment_designed', 'channel_tested'],
    proven: ['signal_reviewed', 'broken_case_repaired', 'feynman_passed'],
    shipped: ['outcome_owner_confirmed'],
  },
  sales: {
    discovered: STAGE_RULES.discovered,
    practiced: ['qualification_practiced', 'objection_repaired'],
    proven: ['commitment_reviewed', 'broken_case_repaired', 'feynman_passed'],
    shipped: ['outcome_owner_confirmed'],
  },
};

function stageRules(lane) {
  return LANE_STAGE_RULES[lane] || STAGE_RULES;
}

function actionStage(action, lane) {
  return Object.entries(stageRules(lane)).find(([, rules]) =>
    rules.some((rule) => rule.split('|').includes(action)))?.[0] || null;
}

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
function workshopsPath() { return join(resolveLearningQuestDir(), 'workshops.json'); }

function gitHead(root) {
  if (!root) return null;
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    }).trim();
  } catch { return null; }
}

export function readLearningTopics() {
  const rows = readJson(topicsPath(), []);
  return Array.isArray(rows) ? rows : [];
}

export function upsertLearningTopic(input = {}) {
  const title = clean(input.title, 'title', 120);
  const summary = clean(input.summary, 'summary', 500);
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((tag) => safeId(tag, 'tag'))) ].slice(0, 12);
  if (input.approved_for_projection === true && SENSITIVE_CONCEPT.test([title, summary, ...tags].join(' '))) {
    throw new Error('[learning-quest] concept contains private or identifying material');
  }
  const topic_id = safeId(input.topic_id || `topic-${Date.now().toString(36)}`, 'topic_id');
  const rows = readLearningTopics();
  const existing = rows.find((row) => row.topic_id === topic_id);
  const lane = LEARNING_LANES.includes(input.lane) ? input.lane : 'code';
  if (existing && existing.lane !== lane
    && readLearningEvents().some((event) => event.topic_id === topic_id)) {
    throw new Error('[learning-quest] topic lane cannot change after learning evidence exists');
  }
  const source_project_root = input.source_project_root
    ? resolve(clean(input.source_project_root, 'source_project_root', 500))
    : existing?.source_project_root || null;
  const sourceChanged = Boolean(existing && existing.source_project_root !== source_project_root);
  const topic = {
    topic_id,
    title,
    summary,
    lane,
    difficulty: Math.max(1, Math.min(5, Number(input.difficulty) || 1)),
    tags,
    prerequisite_ids: [...new Set((Array.isArray(input.prerequisite_ids) ? input.prerequisite_ids : [])
      .map((id) => safeId(id, 'prerequisite_id'))) ],
    approved_for_projection: input.approved_for_projection === true,
    // Private linkage is stored locally and intentionally omitted from every projection.
    source_project_id: input.source_project_id ? clean(input.source_project_id, 'source_project_id', 160) : null,
    source_project_root,
    source_revision_baseline: sourceChanged
      ? gitHead(source_project_root)
      : existing?.source_revision_baseline || gitHead(source_project_root),
  };
  const next = rows.filter((row) => row.topic_id !== topic.topic_id);
  next.push(topic);
  atomicJson(topicsPath(), next.sort((a, b) => a.topic_id.localeCompare(b.topic_id)));
  return topic;
}

export function appendVerifiedLearningProof(input = {}) {
  const topic_id = safeId(input.topic_id, 'topic_id');
  const action = input.action === 'commit_verified' ? input.action : null;
  if (!action) throw new Error('[learning-quest] only local commit verification is currently supported');
  const topic = readLearningTopics().find((row) => row.topic_id === topic_id);
  if (!topic?.source_project_root) throw new Error('[learning-quest] topic has no private local project link');
  const sha = gitHead(topic.source_project_root);
  if (!sha) throw new Error('[learning-quest] linked project has no verifiable Git commit');
  if (topic.source_revision_baseline && sha === topic.source_revision_baseline) {
    throw new Error('[learning-quest] linked project has no new commit since this topic started');
  }
  const proof = createHash('sha256').update(`commit:${sha}`).digest('hex');
  const proof_fingerprint = `sha256:${proof}`;
  if (readLearningEvents().some((event) => event.proof_fingerprint === proof_fingerprint)) {
    throw new Error('[learning-quest] this verified commit proof is already recorded');
  }
  return appendLearningEvent({
    topic_id, action, result: 'passed', assistance: 'none', variation: 'local-git',
    proof_fingerprint,
  }, { verifiedProof: true });
}

const OUTCOME_KIND_BY_LANE = {
  product: 'accepted_product_result',
  marketing: 'published_marketing_asset',
  gtm: 'reviewed_experiment_signal',
  sales: 'reviewed_customer_commitment',
};

export function appendOwnerConfirmedLearningOutcome(input = {}) {
  const topic_id = safeId(input.topic_id, 'topic_id');
  const topic = readLearningTopics().find((row) => row.topic_id === topic_id);
  if (!topic) throw new Error('[learning-quest] topic not found');
  const expectedKind = OUTCOME_KIND_BY_LANE[topic.lane];
  if (!expectedKind) throw new Error('[learning-quest] code topics require the local Git verifier');
  if (input.confirmed !== true) throw new Error('[learning-quest] owner confirmation is required');
  const outcomeKind = safeId(input.outcome_kind, 'outcome_kind');
  if (outcomeKind !== expectedKind) throw new Error('[learning-quest] outcome kind does not match this learning lane');
  const note = clean(input.note, 'outcome note', 500);
  if (note.length < 20) throw new Error('[learning-quest] outcome note must describe the real-world evidence');
  const digest = createHash('sha256')
    .update(`owner-outcome:${topic_id}:${outcomeKind}:${note.toLowerCase()}`)
    .digest('hex');
  const proof_fingerprint = `sha256:${digest}`;
  if (readLearningEvents().some((event) => event.proof_fingerprint === proof_fingerprint)) {
    throw new Error('[learning-quest] this owner-confirmed outcome is already recorded');
  }
  return appendLearningEvent({
    topic_id,
    action: 'outcome_owner_confirmed',
    result: 'passed',
    assistance: 'none',
    variation: outcomeKind,
    proof_fingerprint,
  }, { verifiedProof: true });
}

export function deleteLearningTopic(topicId) {
  const id = safeId(topicId, 'topic_id');
  if (activeWorkshop()?.topic_ids?.includes(id)) {
    throw new Error('[learning-quest] active workshop topics cannot be deleted; finish or abandon the workshop first');
  }
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

function readLearningWorkshops() {
  const rows = readJson(workshopsPath(), []);
  return Array.isArray(rows) ? rows : [];
}

function activeWorkshop() {
  return readLearningWorkshops().findLast((row) => !row.completed_at) || null;
}

function touchActiveWorkshop(topicId, occurredAt) {
  const rows = readLearningWorkshops();
  const index = rows.findLastIndex((row) => !row.completed_at);
  if (index < 0) return;
  rows[index] = {
    ...rows[index],
    last_activity_at: occurredAt,
    topic_ids: [...new Set([...rows[index].topic_ids, topicId])],
  };
  atomicJson(workshopsPath(), rows);
}

export function updateLearningWorkshop(input = {}, { now = Date.now() } = {}) {
  const action = clean(input.action, 'workshop action', 40);
  if (!['start', 'complete', 'abandon'].includes(action)) throw new Error('[learning-quest] unsupported workshop action');
  const topics = readLearningTopics().filter((topic) => topic.approved_for_projection);
  const rows = readLearningWorkshops();
  const activeIndex = rows.findLastIndex((row) => !row.completed_at);
  if (action === 'abandon') {
    if (activeIndex < 0) throw new Error('[learning-quest] no active workshop');
    rows[activeIndex] = {
      ...rows[activeIndex],
      completed_at: new Date(now).toISOString(),
      abandoned_at: new Date(now).toISOString(),
    };
    atomicJson(workshopsPath(), rows);
    return rows[activeIndex];
  }
  if (action === 'complete') {
    if (activeIndex < 0) throw new Error('[learning-quest] no active workshop');
    const eventCounts = Object.fromEntries(rows[activeIndex].topic_ids.map((id) => [id,
      readLearningEvents().filter((event) => event.topic_id === id).length]));
    const advanced = rows[activeIndex].topic_ids.some((id) =>
      eventCounts[id] > (rows[activeIndex].baseline_action_counts[id] || 0));
    if (!advanced) throw new Error('[learning-quest] complete one learning action before finishing');
    rows[activeIndex] = { ...rows[activeIndex], completed_at: new Date(now).toISOString() };
    atomicJson(workshopsPath(), rows);
    return rows[activeIndex];
  }
  if (activeIndex >= 0) return rows[activeIndex];
  const requested = [...new Set((Array.isArray(input.topic_ids) ? input.topic_ids : [])
    .map((id) => safeId(id, 'topic_id')))];
  const allowed = new Set(topics.map((topic) => topic.topic_id));
  const topicIds = requested.filter((id) => allowed.has(id)).slice(0, 5);
  if (!topicIds.length) throw new Error('[learning-quest] workshop requires an approved topic');
  const date = new Date(now);
  const workshop = {
    workshop_id: `lqw_${date.getTime().toString(36)}_${randomBytes(4).toString('hex')}`,
    started_at: date.toISOString(),
    last_activity_at: date.toISOString(),
    completed_at: null,
    origin: [0, 6].includes(date.getUTCDay()) ? 'weekend' : 'spontaneous',
    topic_ids: topicIds,
    baseline_action_counts: Object.fromEntries(topicIds.map((id) => [id,
      readLearningEvents().filter((event) => event.topic_id === id).length])),
  };
  rows.push(workshop);
  atomicJson(workshopsPath(), rows);
  return workshop;
}

export function appendLearningEvent(input = {}, options = {}) {
  const topic_id = safeId(input.topic_id, 'topic_id');
  const topic = readLearningTopics().find((row) => row.topic_id === topic_id);
  if (!topic) throw new Error('[learning-quest] topic not found');
  const action = clean(input.action, 'action', 80);
  if (!ACTIONS.has(action)) throw new Error('[learning-quest] unsupported action');
  const result = ['passed', 'partial', 'failed', 'completed'].includes(input.result) ? input.result : 'completed';
  const existing = readLearningEvents().filter((row) => row.topic_id === topic_id);
  const requiredStage = actionStage(action, topic.lane);
  const globalAction = action === 'recall_passed'
    || action === 'recall_failed'
    || action === 'feynman_attempted';
  if (!requiredStage && !globalAction) {
    throw new Error(`[learning-quest] ${action} is not valid for the ${topic.lane} lane`);
  }
  const requiredIndex = requiredStage ? MASTERY_STAGES.indexOf(requiredStage) : -1;
  const currentStage = masteryFor(existing, topic.lane);
  const currentIndex = currentStage ? MASTERY_STAGES.indexOf(currentStage) : -1;
  if (requiredIndex > currentIndex + 1) throw new Error('[learning-quest] action is ahead of the current mastery stage');
  if (requiredStage === 'shipped' && options.verifiedProof !== true) {
    throw new Error('[learning-quest] shipped evidence must come from a verifier-owned proof path');
  }
  const occurredAtMs = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  if ((action === 'recall_passed' || action === 'recall_failed')) {
    if (!existing.some((event) => ['passed', 'completed'].includes(event.result)
      && actionStage(event.action, topic.lane))) {
      throw new Error('[learning-quest] start learning before recall');
    }
    const previousChecks = existing.filter(
      (event) => event.action === 'recall_passed' || event.action === 'recall_failed',
    );
    if (previousChecks.length > 0 && !recallFor(existing, occurredAtMs).refresh_due) {
      throw new Error('[learning-quest] this recall check is not due yet');
    }
  }
  if (action === 'feynman_passed' && ['passed', 'completed'].includes(result)
    && ['accuracy', 'clarity', 'causality', 'transfer'].some((key) => bounded(input.rubric?.[key]) < 0.75)) {
    throw new Error('[learning-quest] Feynman proof requires all four rubric dimensions');
  }
  const event = {
    event_id: `lqe_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`,
    topic_id, action, result, lane: topic.lane,
    occurred_at: new Date(occurredAtMs).toISOString(),
    duration_seconds: Math.max(0, Math.min(86_400, Number(input.duration_seconds) || 0)),
    attempts: Math.max(1, Math.min(100, Number(input.attempts) || 1)),
    hints: Math.max(0, Math.min(100, Number(input.hints) || 0)),
    assistance: ASSISTANCE.has(input.assistance) ? input.assistance : 'none',
    variation: input.variation ? safeId(input.variation, 'variation') : 'standard',
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
  touchActiveWorkshop(topic_id, event.occurred_at);
  return event;
}

function masteryFor(events, lane = 'code') {
  const passed = new Set(events.filter((event) =>
    eventFitsLane(event, lane) && ['passed', 'completed'].includes(event.result)).map((event) => event.action));
  let stage = null;
  for (const name of MASTERY_STAGES) {
    const met = stageRules(lane)[name].every((rule) => rule.split('|').some((action) => passed.has(action)));
    if (!met) break;
    stage = name;
  }
  return stage;
}

function eventFitsLane(event, lane) {
  if (event?.lane && event.lane !== lane) return false;
  if (event?.action === 'recall_passed'
    || event?.action === 'recall_failed'
    || event?.action === 'feynman_attempted') return true;
  if (!actionStage(event?.action, lane)) return false;
  if (event.action === 'outcome_owner_confirmed') {
    return event.variation === OUTCOME_KIND_BY_LANE[lane];
  }
  return true;
}

function recallFor(events, now) {
  const checks = events.filter((event) => event.action === 'recall_passed' || event.action === 'recall_failed');
  const passes = checks.filter((event) => event.action === 'recall_passed').length;
  const lastFailed = checks.at(-1)?.action === 'recall_failed';
  const interval = lastFailed ? 1 : RECALL_DAYS[Math.min(passes, RECALL_DAYS.length - 1)];
  const latest = checks.at(-1)?.occurred_at || events.at(-1)?.occurred_at || new Date(now).toISOString();
  return {
    confidence: checks.length ? passes / checks.length : 0,
    refresh_due: Date.parse(latest) + interval * 86_400_000 <= now,
    interval_days: interval,
    next_due_at: new Date(Date.parse(latest) + interval * 86_400_000).toISOString(),
  };
}

function completedActions(events) {
  return [...new Set(events.filter((event) => ['passed', 'completed'].includes(event.result)).map((event) => event.action))];
}

function nextActions(events, lane = 'code') {
  const completed = new Set(completedActions(events));
  const stage = masteryFor(events, lane);
  const nextStage = MASTERY_STAGES[stage ? MASTERY_STAGES.indexOf(stage) + 1 : 0];
  if (!nextStage) return [];
  return stageRules(lane)[nextStage].flatMap((rule) => rule.split('|')).filter((action) => !completed.has(action));
}

function mean(rows) {
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function buildAnalytics(topics, allEvents, now) {
  const projectedIds = new Set(topics.map((topic) => topic.topic_id));
  const events = allEvents.filter((event) => projectedIds.has(event.topic_id));
  const recalls = events.filter((event) => event.action === 'recall_passed' || event.action === 'recall_failed');
  const feynman = events.filter((event) => event.action === 'feynman_passed' && event.result === 'passed');
  const completed = events.filter((event) => ['passed', 'completed'].includes(event.result));
  const independent = completed.filter((event) => event.assistance === 'none');
  const calibrated = events.filter((event) => ['passed', 'failed'].includes(event.result));
  const byLane = Object.fromEntries(LEARNING_LANES.map((lane) => {
    const rows = topics.filter((topic) => topic.lane === lane);
    return [lane, {
      topics: rows.length,
      shipped: rows.filter((topic) => topic.stage === 'shipped').length,
      recall_confidence: mean(rows.map((topic) => topic.recall.confidence)),
    }];
  }));
  const stageCounts = Object.fromEntries(MASTERY_STAGES.map((stage) => [stage,
    topics.filter((topic) => MASTERY_STAGES.indexOf(topic.stage) >= MASTERY_STAGES.indexOf(stage)).length]));
  const due = topics.filter((topic) => topic.progress.action_count > 0
    && (topic.recall.refresh_due || Date.parse(topic.recall.next_due_at) <= now)).length;
  const recentBoundary = now - 30 * 86_400_000;
  const recentCompleted = completed.filter((event) => Date.parse(event.occurred_at) >= recentBoundary);
  const recentIndependent = recentCompleted.filter((event) => event.assistance === 'none');
  const exactStageCounts = {
    'not started': topics.filter((topic) => !topic.stage).length,
    ...Object.fromEntries(MASTERY_STAGES.map((stage) => [stage,
      topics.filter((topic) => topic.stage === stage).length])),
  };
  const bottleneck = ['not started', ...MASTERY_STAGES].reduce((best, stage) =>
    exactStageCounts[stage] > exactStageCounts[best] ? stage : best, 'not started');
  const recentRate = recentCompleted.length ? recentIndependent.length / recentCompleted.length : 0;
  const allRate = completed.length ? independent.length / completed.length : 0;
  const intervention = due > 0 ? 'refresh_due_recall'
    : topics.some((topic) => topic.stage === 'practiced') ? 'repair_and_explain'
      : topics.some((topic) => topic.stage === 'proven') ? 'ship_verified_proof'
        : topics.some((topic) => !topic.stage) ? 'open_smallest_lesson'
          : 'choose_new_topic';
  return {
    recall: {
      attempts: recalls.length,
      pass_rate: recalls.length ? recalls.filter((row) => row.action === 'recall_passed').length / recalls.length : 0,
      refresh_due: due,
      reached_360_days: topics.filter((topic) => topic.recall.interval_days === 360).length,
    },
    independence: {
      completed_actions: completed.length,
      unassisted_rate: completed.length ? independent.length / completed.length : 0,
      average_hints: mean(events.map((row) => row.hints)),
    },
    explanation: {
      passes: feynman.length,
      rubric_average: mean(feynman.flatMap((row) => Object.values(row.rubric))),
    },
    calibration_error: mean(calibrated.map((row) => Math.abs(row.confidence_before - (row.result === 'passed' ? 1 : 0)))),
    effort: {
      average_attempts: mean(events.map((row) => row.attempts)),
      average_duration_seconds: mean(events.map((row) => row.duration_seconds)),
    },
    stage_funnel: stageCounts,
    by_lane: byLane,
    guidance: {
      bottleneck_stage: bottleneck,
      independence_direction: recentCompleted.length < 2 || Math.abs(recentRate - allRate) < 0.1
        ? 'steady' : recentRate > allRate ? 'rising' : 'falling',
      next_intervention: intervention,
    },
  };
}

function buildRewards(topics, allEvents, now) {
  const projectedIds = new Set(topics.map((topic) => topic.topic_id));
  const completed = allEvents.filter((event) => projectedIds.has(event.topic_id)
    && ['passed', 'completed'].includes(event.result));
  const uniqueProofs = new Set(completed.map((event) => `${event.topic_id}:${event.action}`));
  const recallBonus = completed.filter((event) => event.action === 'recall_passed').length * 10;
  const xp = uniqueProofs.size * 25 + recallBonus;
  const activeDays = [...new Set(completed.map((event) => event.occurred_at.slice(0, 10)))].sort().reverse();
  let streak = 0;
  if (activeDays.length) {
    const latestDay = new Date(`${activeDays[0]}T00:00:00.000Z`).getTime();
    const currentDay = new Date(now).setUTCHours(0, 0, 0, 0);
    const dayGap = Math.floor((currentDay - latestDay) / 86_400_000);
    if (dayGap <= 1) {
      let cursor = latestDay;
      for (const day of activeDays) {
        if (new Date(`${day}T00:00:00.000Z`).getTime() !== cursor) break;
        streak += 1;
        cursor -= 86_400_000;
      }
    }
  }
  const dimensions = {
    understanding: completed.filter((event) => event.action === 'feynman_passed').length,
    independence: completed.filter((event) => event.assistance === 'none').length,
    shipping: topics.filter((topic) => topic.stage === 'shipped').length,
    consistency: activeDays.length,
  };
  const badges = [
    dimensions.understanding > 0 && 'first-principles',
    dimensions.independence >= 5 && 'independent-builder',
    dimensions.shipping > 0 && 'proof-shipper',
    dimensions.consistency >= 4 && 'steady-craft',
  ].filter(Boolean);
  return { xp, level: Math.floor(Math.sqrt(xp / 100)) + 1, streak_days: streak, dimensions, badges };
}

function buildWorkshopProjection(topics, allEvents, now) {
  const workshop = activeWorkshop();
  if (!workshop) return { state: 'none', health: 100, age_days: 0, inactive_days: 0,
    pending_count: 0, completed_count: 0, can_resume: false, can_complete: false,
    origin: 'spontaneous', focus_topic_id: topics.find((topic) =>
      topic.progress.action_count > 0 && topic.recall.refresh_due)?.topic_id
      || topics.find((topic) => topic.stage !== 'shipped')?.topic_id || topics[0]?.topic_id || null,
    reminder: 'Choose any lane when curiosity strikes.' };
  const ageDays = Math.max(0, Math.floor((now - Date.parse(workshop.started_at)) / 86_400_000));
  const inactiveDays = Math.max(0, Math.floor((now - Date.parse(workshop.last_activity_at)) / 86_400_000));
  const counts = Object.fromEntries(workshop.topic_ids.map((id) => [id,
    allEvents.filter((event) => event.topic_id === id).length]));
  const completedCount = workshop.topic_ids.filter((id) =>
    counts[id] > (workshop.baseline_action_counts[id] || 0)).length;
  const pendingCount = Math.max(0, workshop.topic_ids.length - completedCount);
  const health = Math.max(20, Math.min(100, 100 - inactiveDays * 9 + completedCount * 12));
  const reminder = ageDays >= 7 ? "Last weekend's workshop is still yours to finish."
    : inactiveDays >= 3 ? 'Your workshop is resting, not lost.'
      : pendingCount ? 'One honest action will restore momentum.'
        : 'The learning action is complete. Close the workshop when ready.';
  return {
    state: 'active', health, age_days: ageDays, inactive_days: inactiveDays,
    pending_count: pendingCount, completed_count: completedCount, can_resume: true,
    can_complete: completedCount > 0, origin: workshop.origin,
    focus_topic_id: workshop.topic_ids.find((id) => topics.some((topic) => topic.topic_id === id))
      || topics[0]?.topic_id || null,
    reminder,
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
  const projectedTopics = readLearningTopics().filter((topic) => topic.approved_for_projection);
  const projectedById = new Map(projectedTopics.map((topic) => [topic.topic_id, topic]));
  const validEvents = allEvents.filter((event) => {
    const topic = projectedById.get(event.topic_id);
    return topic && eventFitsLane(event, topic.lane);
  });
  const topics = projectedTopics.map((topic) => {
    const events = validEvents.filter((event) => event.topic_id === topic.topic_id);
    const snapshot = {
      topic_id: topic.topic_id, title: topic.title, summary: topic.summary, lane: topic.lane,
      difficulty: topic.difficulty, tags: topic.tags, prerequisite_ids: topic.prerequisite_ids,
      stage: masteryFor(events, topic.lane), recall: recallFor(events, now), next_question: safeQuestion(topic, events),
      progress: {
        action_count: events.length,
        attempts: events.reduce((sum, row) => sum + row.attempts, 0),
        completed_actions: completedActions(events),
        next_actions: nextActions(events, topic.lane),
      },
    };
    return snapshot;
  });
  const snapshot = {
    schema_version: 2,
    topics,
    summary: {
      total_topics: topics.length,
      by_stage: Object.fromEntries(MASTERY_STAGES.map((stage) => [stage, topics.filter((topic) => topic.stage === stage).length])),
      by_lane: Object.fromEntries(LEARNING_LANES.map((lane) => [lane, topics.filter((topic) => topic.lane === lane).length])),
      durable_capability: topics.length ? topics.reduce((sum, topic) => sum + topic.recall.confidence, 0) / topics.length : 0,
    },
    analytics: buildAnalytics(topics, validEvents, now),
    rewards: buildRewards(topics, validEvents, now),
    workshop: buildWorkshopProjection(topics, validEvents, now),
  };
  assertProjectionSafe(snapshot);
  return snapshot;
}
