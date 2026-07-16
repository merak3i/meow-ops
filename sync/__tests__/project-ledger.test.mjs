import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendProjectClaim, confirmProjectClaim, foldProjectClaims, readProjectClaims,
} from '../project-ledger.mjs';

test('owner teaching is appended privately and the latest correction wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-project-ledger-'));
  const previous = process.env.MEOW_PROJECT_INTELLIGENCE_DIR;
  process.env.MEOW_PROJECT_INTELLIGENCE_DIR = dir;
  try {
    const first = appendProjectClaim({
      project_name: 'Patherle',
      field: 'vision',
      value: 'Ship a secure beta for first users.',
      status: 'owner_confirmed',
      source: 'owner',
    });
    const correction = appendProjectClaim({
      project_name: 'Patherle',
      field: 'vision',
      value: 'Ship a secure, bug-free beta for first users.',
      status: 'owner_confirmed',
      source: 'owner',
      supersedes: first.claim_id,
    });

    assert.equal(readProjectClaims().length, 2);
    const [latest] = foldProjectClaims(readProjectClaims());
    assert.equal(latest.claim_id, correction.claim_id);
    assert.equal(latest.project_id, 'patherle');
    assert.match(latest.value, /bug-free/);
  } finally {
    if (previous === undefined) delete process.env.MEOW_PROJECT_INTELLIGENCE_DIR;
    else process.env.MEOW_PROJECT_INTELLIGENCE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an inferred claim becomes owner-confirmed only through explicit confirmation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-project-ledger-'));
  const previous = process.env.MEOW_PROJECT_INTELLIGENCE_DIR;
  process.env.MEOW_PROJECT_INTELLIGENCE_DIR = dir;
  try {
    const inferred = appendProjectClaim({
      project_name: 'Meow Ops',
      field: 'priority',
      value: 'Agentic workflow experimentation.',
      status: 'inferred',
      source: 'session_pattern',
    });
    const confirmed = confirmProjectClaim(inferred.claim_id);

    assert.equal(confirmed.claim_id, inferred.claim_id);
    assert.equal(confirmed.status, 'owner_confirmed');
    assert.equal(confirmed.source, 'owner');
    assert.equal(foldProjectClaims(readProjectClaims())[0].status, 'owner_confirmed');
  } finally {
    if (previous === undefined) delete process.env.MEOW_PROJECT_INTELLIGENCE_DIR;
    else process.env.MEOW_PROJECT_INTELLIGENCE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
