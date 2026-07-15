// Companion Preferences learns only from allowlisted feedback metadata. It
// creates review-only proposals; no preference changes until the owner applies
// one through the local helper.

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { assertOutsideWorktree, assertRedacted, newId } from './loop-ledger.mjs';
import { projectId } from './project-ledger.mjs';

const FILE_NAME = 'preferences.jsonl';
const PROPOSAL_THRESHOLD = 3;
const WINDOW_DAYS = 30;
const GATES = ['known_known', 'known_unknown', 'unknown_known', 'unknown_unknown'];
const DECISIONS = ['applied', 'dismissed'];
const DEFAULT_RESPONSE_PREFERENCES = {
  verbosity: 'balanced',
  challenge: 'balanced',
  exploration: 'balanced',
};

export const PREFERENCE_SIGNALS = Object.freeze([
  {
    id: 'too_verbose', label: 'Too long', description: 'Use shorter, more decisive answers.',
    field: 'verbosity', value: 'concise', title: 'Make answers more concise',
  },
  {
    id: 'too_brief', label: 'Needs more depth', description: 'Include more reasoning and useful context.',
    field: 'verbosity', value: 'detailed', title: 'Add more useful depth',
  },
  {
    id: 'too_soft', label: 'Challenge me more', description: 'Name contradictions and tradeoffs more directly.',
    field: 'challenge', value: 'direct', title: 'Use a more direct challenge style',
  },
  {
    id: 'too_harsh', label: 'Too harsh', description: 'Keep challenge constructive and gentler.',
    field: 'challenge', value: 'gentle', title: 'Use a gentler challenge style',
  },
  {
    id: 'too_speculative', label: 'Too speculative', description: 'Minimize optional synthesis beyond the evidence.',
    field: 'exploration', value: 'focused', title: 'Keep exploration more focused',
  },
  {
    id: 'missed_possibilities', label: 'Explore more', description: 'Surface more labeled possibilities and questions.',
    field: 'exploration', value: 'expansive', title: 'Explore more possibilities',
  },
]);

const SIGNAL_BY_ID = new Map(PREFERENCE_SIGNALS.map((signal) => [signal.id, signal]));

export function resolvePreferenceDir() {
  const dir = resolve(
    process.env.MEOW_COMPANION_PREFERENCE_DIR
      || process.env.MEOW_COMPANION_SOUL_DIR
      || join(homedir(), '.meow-ops', 'companion'),
  );
  assertOutsideWorktree(dir);
  return dir;
}

function preferenceFile() {
  return join(resolvePreferenceDir(), FILE_NAME);
}

function text(value, field, max) {
  const clean = String(value || '').trim();
  if (!clean || clean.length > max) {
    throw new Error(`[companion-preferences] ${field} must be 1-${max} characters`);
  }
  return clean;
}

function isoNow(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('[companion-preferences] invalid timestamp');
  return date.toISOString();
}

function withLock(lockPath, fn) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        return fn();
      } finally {
        closeSync(fd);
        unlinkSync(lockPath);
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5000) unlinkSync(lockPath);
      } catch { /* another writer released it */ }
      const until = Date.now() + 10;
      while (Date.now() < until); // bounded local-only backoff
    }
  }
  throw new Error('[companion-preferences] could not acquire ledger lock');
}

export function readPreferenceRecords() {
  const file = preferenceFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function appendRecord(record) {
  const clean = assertRedacted(record, 'companion-preference');
  const dir = resolvePreferenceDir();
  mkdirSync(dir, { recursive: true });
  const file = preferenceFile();
  withLock(`${file}.lock`, () => appendFileSync(file, `${JSON.stringify(clean)}\n`, 'utf8'));
  return clean;
}

export function appendCompanionFeedback(input = {}, { now = new Date() } = {}) {
  const signal = text(input.signal, 'signal', 40);
  if (!SIGNAL_BY_ID.has(signal)) throw new Error('[companion-preferences] unsupported feedback signal');
  const response_ref = text(input.response_ref, 'response_ref', 120);
  if (!/^[a-z0-9_-]+$/i.test(response_ref)) {
    throw new Error('[companion-preferences] response_ref contains unsupported characters');
  }
  if (readPreferenceRecords().some((record) => record.type === 'feedback' && record.response_ref === response_ref)) {
    throw new Error('[companion-preferences] feedback already recorded for this response');
  }
  const gate = input.gate === undefined ? null : text(input.gate, 'gate', 40);
  if (gate && !GATES.includes(gate)) throw new Error('[companion-preferences] unsupported evidence gate');
  const soul_revision = Number(input.soul_revision);
  if (!Number.isInteger(soul_revision) || soul_revision < 0) {
    throw new Error('[companion-preferences] soul_revision must be a non-negative integer');
  }
  return appendRecord({
    schema_version: 1,
    type: 'feedback',
    feedback_id: newId('feedback'),
    signal,
    response_ref,
    gate,
    soul_revision,
    scope: input.project_id ? 'project' : 'global',
    ...(input.project_id ? { project_id: projectId(input.project_id) } : {}),
    recorded_at: isoNow(now),
  });
}

function proposalId(signal, scope, project_id) {
  const digest = createHash('sha256').update(`${signal}:${scope}:${project_id || 'global'}`).digest('hex').slice(0, 16);
  return `pref_${digest}`;
}

function currentPreference(profile, scope, project_id, field) {
  if (scope === 'project') {
    const overlay = (profile?.project_overlays || []).find((item) => item.project_id === project_id);
    if (!overlay) return null;
    return overlay.response_preferences?.[field] || 'inherit';
  }
  return profile?.response_preferences?.[field] || DEFAULT_RESPONSE_PREFERENCES[field];
}

export function readPreferenceState(profile = {}, { now = new Date() } = {}) {
  const records = readPreferenceRecords();
  const nowDate = now instanceof Date ? now : new Date(now);
  const since = nowDate.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const feedback = records.filter((record) => (
    record.type === 'feedback' && Date.parse(record.recorded_at) >= since
  ));
  const decisions = records.filter((record) => record.type === 'decision');
  const groups = new Map();
  for (const item of feedback) {
    const key = `${item.signal}:${item.scope}:${item.project_id || 'global'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const proposals = [];
  for (const items of groups.values()) {
    items.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
    const first = items[0];
    const definition = SIGNAL_BY_ID.get(first.signal);
    if (!definition) continue;
    const proposal_id = proposalId(first.signal, first.scope, first.project_id);
    const lastDecision = decisions
      .filter((decision) => decision.proposal_id === proposal_id)
      .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))[0];
    const fresh = lastDecision
      ? items.filter((item) => item.recorded_at > lastDecision.recorded_at)
      : items;
    if (fresh.length < PROPOSAL_THRESHOLD) continue;
    const current = currentPreference(profile, first.scope, first.project_id, definition.field);
    if (current === null || current === definition.value) continue;
    const overlay = first.scope === 'project'
      ? (profile?.project_overlays || []).find((item) => item.project_id === first.project_id)
      : null;
    proposals.push({
      proposal_id,
      status: 'review_only',
      signal: definition.id,
      signal_label: definition.label,
      title: definition.title,
      reason: `${fresh.length} matching feedback signals in the last ${WINDOW_DAYS} days.`,
      impact: definition.description,
      evidence_count: fresh.length,
      scope_label: overlay?.project_name || 'All projects',
      target: {
        scope: first.scope,
        ...(first.project_id ? { project_id: first.project_id } : {}),
        field: definition.field,
        value: definition.value,
      },
      current_value: current,
    });
  }
  return {
    feedback_count: feedback.length,
    proposals: proposals.sort((a, b) => a.title.localeCompare(b.title)),
    signals: PREFERENCE_SIGNALS.map(({ field: _field, value: _value, title: _title, ...signal }) => signal),
    policy: { threshold: PROPOSAL_THRESHOLD, window_days: WINDOW_DAYS, auto_apply: false },
  };
}

export function recordPreferenceDecision(input = {}, { now = new Date() } = {}) {
  const proposal_id = text(input.proposal_id, 'proposal_id', 120);
  const decision = text(input.decision, 'decision', 20);
  if (!DECISIONS.includes(decision)) throw new Error('[companion-preferences] unsupported decision');
  const soul_revision = Number(input.soul_revision);
  if (!Number.isInteger(soul_revision) || soul_revision < 0) {
    throw new Error('[companion-preferences] soul_revision must be a non-negative integer');
  }
  return appendRecord({
    schema_version: 1,
    type: 'decision',
    decision_id: newId('prefdecision'),
    proposal_id,
    decision,
    soul_revision,
    recorded_at: isoNow(now),
  });
}

export function applyPreferenceProposal(profile, proposal) {
  if (!proposal || proposal.status !== 'review_only') {
    throw new Error('[companion-preferences] only review-only proposals may be applied');
  }
  const { scope, project_id, field, value } = proposal.target || {};
  if (scope === 'global') {
    return {
      ...profile,
      response_preferences: {
        ...DEFAULT_RESPONSE_PREFERENCES,
        ...(profile.response_preferences || {}),
        [field]: value,
      },
    };
  }
  if (scope === 'project' && project_id) {
    let found = false;
    const project_overlays = (profile.project_overlays || []).map((overlay) => {
      if (overlay.project_id !== project_id) return overlay;
      found = true;
      return {
        ...overlay,
        response_preferences: {
          verbosity: 'inherit', challenge: 'inherit', exploration: 'inherit',
          ...(overlay.response_preferences || {}),
          [field]: value,
        },
      };
    });
    if (!found) throw new Error('[companion-preferences] project soul no longer exists');
    return { ...profile, project_overlays };
  }
  throw new Error('[companion-preferences] unsupported proposal target');
}
