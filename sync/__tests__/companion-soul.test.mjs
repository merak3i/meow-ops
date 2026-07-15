import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applySoulPolicy, compileSoulInstructions, DEFAULT_SOUL, readSoulProfile, saveSoulProfile,
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
