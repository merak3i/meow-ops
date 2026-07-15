import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SOUL } from '../companion-soul.mjs';
import {
  appendCompanionFeedback, applyPreferenceProposal, readPreferenceState, recordPreferenceDecision,
} from '../companion-preferences.mjs';

const NOW = new Date('2026-07-15T00:00:00.000Z');

function withPreferenceDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-companion-preferences-'));
  const previous = process.env.MEOW_COMPANION_PREFERENCE_DIR;
  process.env.MEOW_COMPANION_PREFERENCE_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.MEOW_COMPANION_PREFERENCE_DIR;
    else process.env.MEOW_COMPANION_PREFERENCE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('three metadata-only signals create one review-only preference proposal', () => withPreferenceDir((dir) => {
  for (let index = 1; index <= 3; index++) {
    appendCompanionFeedback({
      signal: 'too_verbose',
      response_ref: `assistant-${index}`,
      gate: 'known_known',
      soul_revision: 2,
      response_text: 'this must never be stored',
    }, { now: NOW });
  }

  const state = readPreferenceState(DEFAULT_SOUL, { now: NOW });
  assert.equal(state.feedback_count, 3);
  assert.equal(state.proposals.length, 1);
  assert.equal(state.proposals[0].status, 'review_only');
  assert.deepEqual(state.proposals[0].target, {
    scope: 'global', field: 'verbosity', value: 'concise',
  });
  assert.doesNotMatch(readFileSync(join(dir, 'preferences.jsonl'), 'utf8'), /must never be stored/);
}));

test('owner application changes the profile and consumes the reviewed signal batch', () => withPreferenceDir(() => {
  for (let index = 1; index <= 3; index++) {
    appendCompanionFeedback({
      signal: 'too_verbose', response_ref: `apply-${index}`, gate: 'known_known', soul_revision: 2,
    }, { now: NOW });
  }
  const proposal = readPreferenceState(DEFAULT_SOUL, { now: NOW }).proposals[0];
  const nextProfile = applyPreferenceProposal(DEFAULT_SOUL, proposal);
  recordPreferenceDecision({
    proposal_id: proposal.proposal_id, decision: 'applied', soul_revision: 3,
  }, { now: NOW });

  assert.equal(nextProfile.response_preferences.verbosity, 'concise');
  assert.deepEqual(readPreferenceState(nextProfile, { now: NOW }).proposals, []);
}));

test('project feedback creates a project-only proposal without changing the global soul', () => withPreferenceDir(() => {
  const profile = {
    ...DEFAULT_SOUL,
    project_overlays: [{
      project_id: 'patherle', project_name: 'Patherle', enabled: true, preset: 'inherit',
      custom_instructions: '',
      response_preferences: { verbosity: 'inherit', challenge: 'inherit', exploration: 'inherit' },
    }],
  };
  for (let index = 1; index <= 3; index++) {
    appendCompanionFeedback({
      signal: 'too_soft', response_ref: `project-${index}`, gate: 'known_known',
      soul_revision: 2, project_id: 'Patherle',
    }, { now: NOW });
  }
  const proposal = readPreferenceState(profile, { now: NOW }).proposals[0];
  const nextProfile = applyPreferenceProposal(profile, proposal);

  assert.deepEqual(proposal.target, {
    scope: 'project', project_id: 'patherle', field: 'challenge', value: 'direct',
  });
  assert.equal(nextProfile.project_overlays[0].response_preferences.challenge, 'direct');
  assert.equal(nextProfile.response_preferences, DEFAULT_SOUL.response_preferences);
}));

test('one response can contribute only one feedback signal', () => withPreferenceDir(() => {
  appendCompanionFeedback({
    signal: 'too_soft', response_ref: 'same-response', gate: 'known_known', soul_revision: 2,
  }, { now: NOW });

  assert.throws(() => appendCompanionFeedback({
    signal: 'too_harsh', response_ref: 'same-response', gate: 'known_known', soul_revision: 2,
  }, { now: NOW }), /already recorded/);
}));
