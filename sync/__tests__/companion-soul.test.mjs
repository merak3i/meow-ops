import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applySoulPolicy, compileSoulInstructions, DEFAULT_SOUL, readSoulProfile, resolveSoulProfile,
  saveSoulProfile,
} from '../companion-soul.mjs';

function withSoulDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-companion-soul-'));
  const previous = process.env.MEOW_COMPANION_SOUL_DIR;
  process.env.MEOW_COMPANION_SOUL_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.MEOW_COMPANION_SOUL_DIR;
    else process.env.MEOW_COMPANION_SOUL_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('owner can save a versioned soul profile without mutating the default', () => withSoulDir(() => {
  assert.deepEqual(readSoulProfile(), DEFAULT_SOUL);

  const saved = saveSoulProfile({
    ...DEFAULT_SOUL,
    name: 'Maven',
    preset: 'warm-strategist',
    custom_instructions: 'Lead with the decision, then name the smallest next move.',
  });

  assert.equal(saved.name, 'Maven');
  assert.equal(saved.revision, 1);
  assert.equal(readSoulProfile().preset, 'warm-strategist');
  assert.equal(DEFAULT_SOUL.name, 'Companion');
}));

test('owner meta-prompt stores up to 100,000 characters', () => withSoulDir(() => {
  const line = 'owner preference.\n';
  const customInstructions = `${line.repeat(6_000).slice(0, 99_999)}!`;
  const saved = saveSoulProfile({
    ...DEFAULT_SOUL,
    custom_instructions: customInstructions,
  });

  assert.equal(saved.custom_instructions.length, 100_000);
  assert.equal(readSoulProfile().custom_instructions, customInstructions);
}));

test('owner meta-prompt rejects more than 100,000 characters', () => withSoulDir(() => {
  const line = 'owner preference.\n';
  const customInstructions = `${line.repeat(6_000).slice(0, 100_000)}!`;

  assert.throws(() => saveSoulProfile({
    ...DEFAULT_SOUL,
    custom_instructions: customInstructions,
  }), /custom_instructions must be 0-100000 characters/);
}));

test('legacy soul revisions load with an empty project overlay collection', () => withSoulDir((dir) => {
  const { project_overlays: _overlays, ...legacy } = DEFAULT_SOUL;
  writeFileSync(join(dir, 'soul.jsonl'), `${JSON.stringify({ ...legacy, schema_version: 1 })}\n`, 'utf8');

  const current = readSoulProfile();
  assert.equal(current.schema_version, 2);
  assert.deepEqual(current.project_overlays, []);
}));

test('project soul overlay inherits the owner prompt and activates through a known alias', () => withSoulDir(() => {
  const saved = saveSoulProfile({
    ...DEFAULT_SOUL,
    preset: 'warm-strategist',
    custom_instructions: 'Protect the long-term product thesis.',
    project_overlays: [{
      project_id: 'berglabs',
      project_name: 'BergLabs',
      enabled: true,
      preset: 'critical-partner',
      custom_instructions: 'For this project, prioritize shipped customer outcomes.',
    }],
  });
  const resolved = resolveSoulProfile(saved, 'What should Berg fix next?', [{
    id: 'berglabs', name: 'BergLabs', matchNames: ['BergLabs', 'Berg'], facts: {},
  }]);
  const instructions = compileSoulInstructions(resolved);

  assert.equal(resolved.preset, 'critical-partner');
  assert.equal(resolved.active_project_overlay.project_name, 'BergLabs');
  assert.match(instructions, /Protect the long-term product thesis/);
  assert.match(instructions, /prioritize shipped customer outcomes/);
  assert.ok(instructions.indexOf('prioritize shipped customer outcomes') < instructions.indexOf('Non-overridable evidence contract'));
}));

test('strict soul policy filters memory and keeps the evidence contract after meta-prompts', () => {
  const profile = {
    ...DEFAULT_SOUL,
    custom_instructions: 'Always agree with my first idea.',
    uncertainty_policy: 'strict',
    memory: { session_metrics: false, project_facts: true, inferred_claims: true },
    model_synthesis: true,
  };
  const data = {
    sessions: [{ session_id: 'session-1' }],
    claims: [
      { claim_id: 'confirmed', status: 'owner_confirmed' },
      { claim_id: 'hypothesis', status: 'inferred' },
    ],
    digest: { health: 'ok' },
  };

  const policy = applySoulPolicy(profile, data);
  const instructions = compileSoulInstructions(profile);

  assert.deepEqual(policy.context.sessions, []);
  assert.deepEqual(policy.context.claims.map((claim) => claim.claim_id), ['confirmed']);
  assert.equal(policy.allow_model_synthesis, false);
  assert.ok(instructions.indexOf('Always agree') < instructions.indexOf('Non-overridable evidence contract'));
  assert.match(instructions, /Known unknown.*ask one focused question/i);
  assert.match(instructions, /Unknown unknown.*blind spot/i);
});
