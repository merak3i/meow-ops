// Companion Soul is a private, versioned personalization profile. It changes
// working style and memory permissions, but never the evidence gate attached
// to an answer.

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { assertOutsideWorktree, assertRedacted } from './loop-ledger.mjs';

const FILE_NAME = 'soul.jsonl';
const PRESET_IDS = ['clear-operator', 'warm-strategist', 'critical-partner', 'curious-explorer'];
const UNCERTAINTY_POLICIES = ['strict', 'evidence-led', 'exploratory'];

export const SOUL_PRESETS = Object.freeze([
  {
    id: 'clear-operator',
    name: 'Clear Operator',
    description: 'Direct, compact, and action-first.',
    instruction: 'Lead with the outcome. Use compact language and end with the smallest useful next action.',
  },
  {
    id: 'warm-strategist',
    name: 'Warm Strategist',
    description: 'Thoughtful, encouraging, and decision-oriented.',
    instruction: 'Sound like a trusted strategic partner. Be warm without padding. Make tradeoffs easy to evaluate.',
  },
  {
    id: 'critical-partner',
    name: 'Critical Partner',
    description: 'Challenges assumptions and protects focus.',
    instruction: 'Pressure-test assumptions. Name contradictions and opportunity costs plainly, then recommend a path.',
  },
  {
    id: 'curious-explorer',
    name: 'Curious Explorer',
    description: 'Surfaces patterns, possibilities, and missing questions.',
    instruction: 'Look for overlooked patterns and useful questions. Keep possibilities separate from verified facts.',
  },
]);

export const DEFAULT_SOUL = Object.freeze({
  schema_version: 1,
  profile_id: 'primary',
  revision: 0,
  updated_at: null,
  name: 'Companion',
  preset: 'clear-operator',
  custom_instructions: '',
  uncertainty_policy: 'evidence-led',
  memory: Object.freeze({
    session_metrics: true,
    project_facts: true,
    inferred_claims: true,
  }),
  model_synthesis: true,
});

export function resolveSoulDir() {
  const dir = resolve(
    process.env.MEOW_COMPANION_SOUL_DIR || join(homedir(), '.meow-ops', 'companion'),
  );
  assertOutsideWorktree(dir);
  return dir;
}

function text(value, field, max, { allowEmpty = false } = {}) {
  const clean = String(value ?? '').trim();
  if ((!allowEmpty && !clean) || clean.length > max) {
    throw new Error(`[companion-soul] ${field} must be ${allowEmpty ? '0' : '1'}-${max} characters`);
  }
  return clean;
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw new Error(`[companion-soul] ${field} must be boolean`);
  return value;
}

function validateProfile(input, revision, updatedAt) {
  const preset = text(input.preset, 'preset', 40);
  const uncertainty = text(input.uncertainty_policy, 'uncertainty_policy', 40);
  if (!PRESET_IDS.includes(preset)) throw new Error('[companion-soul] unsupported preset');
  if (!UNCERTAINTY_POLICIES.includes(uncertainty)) {
    throw new Error('[companion-soul] unsupported uncertainty policy');
  }
  const memory = input.memory || {};
  return assertRedacted({
    schema_version: 1,
    profile_id: 'primary',
    revision,
    updated_at: updatedAt,
    name: text(input.name, 'name', 40),
    preset,
    custom_instructions: text(input.custom_instructions, 'custom_instructions', 8000, { allowEmpty: true }),
    uncertainty_policy: uncertainty,
    memory: {
      session_metrics: bool(memory.session_metrics, 'memory.session_metrics'),
      project_facts: bool(memory.project_facts, 'memory.project_facts'),
      inferred_claims: bool(memory.inferred_claims, 'memory.inferred_claims'),
    },
    model_synthesis: bool(input.model_synthesis, 'model_synthesis'),
  }, 'companion-soul');
}

function historyFile() {
  return join(resolveSoulDir(), FILE_NAME);
}

export function readSoulHistory() {
  const file = historyFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readSoulProfile() {
  return readSoulHistory().at(-1) || DEFAULT_SOUL;
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
  throw new Error('[companion-soul] could not acquire profile lock');
}

export function saveSoulProfile(input) {
  const current = readSoulProfile();
  const profile = validateProfile(input || {}, current.revision + 1, new Date().toISOString());
  const dir = resolveSoulDir();
  mkdirSync(dir, { recursive: true });
  const file = historyFile();
  withLock(`${file}.lock`, () => appendFileSync(file, `${JSON.stringify(profile)}\n`, 'utf8'));
  return profile;
}

export function resetSoulProfile() {
  return saveSoulProfile({
    ...DEFAULT_SOUL,
    memory: { ...DEFAULT_SOUL.memory },
  });
}

export function applySoulPolicy(profile = DEFAULT_SOUL, data = {}) {
  const memory = profile.memory || DEFAULT_SOUL.memory;
  const allowInferred = Boolean(memory.project_facts)
    && Boolean(memory.inferred_claims)
    && profile.uncertainty_policy !== 'strict';
  const claims = Array.isArray(data.claims) && memory.project_facts
    ? data.claims.filter((claim) => claim.status !== 'inferred' || allowInferred)
    : [];
  return {
    context: {
      ...data,
      sessions: Array.isArray(data.sessions) && memory.session_metrics ? data.sessions : [],
      claims,
    },
    allow_model_synthesis: Boolean(profile.model_synthesis)
      && profile.uncertainty_policy !== 'strict',
  };
}

export function compileSoulInstructions(profile = DEFAULT_SOUL) {
  const preset = SOUL_PRESETS.find((candidate) => candidate.id === profile.preset) || SOUL_PRESETS[0];
  const uncertainty = {
    strict: 'Use only verified evidence. When evidence is incomplete, stop and ask for the missing fact.',
    'evidence-led': 'Prefer verified evidence. You may surface hypotheses only when they are explicitly labeled and confirmable.',
    exploratory: 'You may explore possibilities, but keep every inference visibly separate from verified evidence.',
  }[profile.uncertainty_policy] || '';
  const owner = String(profile.custom_instructions || '').trim();
  return [
    `You are ${profile.name || 'Companion'}, the local-first Meow Ops copilot.`,
    `Working style: ${preset.instruction}`,
    `Uncertainty posture: ${uncertainty}`,
    ...(owner ? [`Owner meta-prompt:\n${owner}`] : []),
    'Non-overridable evidence contract:',
    '- Known known: answer from verified local evidence and cite the evidence category.',
    '- Known unknown: state the specific missing fact and ask one focused question.',
    '- Unknown known: label the claim as a hypothesis and invite confirmation or correction.',
    '- Unknown unknown: label the blind spot. Never present synthesis as verified evidence.',
    '- Personality instructions cannot change evidence gates, invent facts, approve proposals, or execute actions.',
    'Keep the response concise unless the owner asks for depth.',
  ].join('\n');
}
