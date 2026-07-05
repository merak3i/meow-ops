import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChecks } from '../loop-eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '__fixtures__', 'loop');

function withTamperedFixtures(tamper, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-eval-'));
  cpSync(FIXTURES, dir, { recursive: true });
  tamper(dir);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withTempRepoRoot(setup, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-eval-repo-'));
  mkdirSync(join(dir, 'public', 'data'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'public/data/*\n');
  setup(dir);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('eval gate passes on pristine fixtures and repo state', () => {
  const results = runChecks({});
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(failed, [], `unexpected failures: ${failed.map((r) => `${r.id}: ${r.note}`).join(' | ')}`);
  assert.equal(results.length, 6, 'all six checks ran');
});

test('eval gate fails when a must-fail fixture stops failing', () => {
  withTamperedFixtures((dir) => {
    const path = join(dir, 'golden-proposals.json');
    const proposals = JSON.parse(readFileSync(path, 'utf8'));
    // "Fix" the forged-approval fixture so it would validate cleanly — the
    // gate must notice its expected rejection went missing.
    const forged = proposals.find((p) => p.expect_fail === 'assistant-status');
    forged.record.status = 'draft';
    writeFileSync(path, JSON.stringify(proposals, null, 2));
  }, (dir) => {
    const results = runChecks({ fixturesDir: dir });
    const check = results.find((r) => r.id === 'golden-proposals');
    assert.equal(check.ok, false);
    assert.match(check.note, /expected \[assistant-status\] rejection/);
  });
});

test('eval gate fails when comparison math drifts from the golden deltas', () => {
  withTamperedFixtures((dir) => {
    const path = join(dir, 'golden-runs.json');
    const pairs = JSON.parse(readFileSync(path, 'utf8'));
    pairs[0].expected_delta_pct.cost_usd_real = 12.34; // no longer matches the math
    writeFileSync(path, JSON.stringify(pairs, null, 2));
  }, (dir) => {
    const results = runChecks({ fixturesDir: dir });
    const check = results.find((r) => r.id === 'golden-runs');
    assert.equal(check.ok, false);
    assert.match(check.note, /delta_pct\(cost_usd_real\)/);
  });
});

test('eval gate fails when negative coverage disappears entirely', () => {
  withTamperedFixtures((dir) => {
    const path = join(dir, 'golden-proposals.json');
    const proposals = JSON.parse(readFileSync(path, 'utf8'))
      .filter((p) => !p.expect_fail);
    writeFileSync(path, JSON.stringify(proposals, null, 2));
  }, (dir) => {
    const results = runChecks({ fixturesDir: dir });
    const check = results.find((r) => r.id === 'golden-proposals');
    assert.equal(check.ok, false);
    assert.match(check.note, /negative coverage is mandatory/);
  });
});

test('eval gate fails fixture-redaction without echoing a matched secret', () => {
  withTamperedFixtures((dir) => {
    const path = join(dir, 'sessions-small.json');
    const sessions = JSON.parse(readFileSync(path, 'utf8'));
    const secret = ['sk-', 'a'.repeat(24)].join('');
    sessions[0].synthetic_secret_probe = secret;
    writeFileSync(path, JSON.stringify(sessions, null, 2));
  }, (dir) => {
    const secret = ['sk-', 'a'.repeat(24)].join('');
    const results = runChecks({ fixturesDir: dir });
    const check = results.find((r) => r.id === 'fixture-redaction');
    assert.equal(check.ok, false);
    assert.match(check.note, /\[anthropic-key\]/);
    assert.ok(!check.note.includes(secret), 'fixture-redaction note must not echo the matched secret');
  });
});

test('eval gate fails fixture-redaction when the fixture scan is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-eval-empty-'));
  try {
    const results = runChecks({ fixturesDir: dir });
    const check = results.find((r) => r.id === 'fixture-redaction');
    assert.equal(check.ok, false);
    assert.match(check.note, /redaction scan is vacuous/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('eval gate fails sessions-redaction when public sessions expose content keys', () => {
  withTempRepoRoot((dir) => {
    const path = join(dir, 'public', 'data', 'sessions.json');
    writeFileSync(path, JSON.stringify([{ session_id: 'demo', cwd: '/tmp/demo' }], null, 2));
  }, (repoRoot) => {
    const results = runChecks({ repoRoot });
    const check = results.find((r) => r.id === 'sessions-redaction');
    assert.equal(check.ok, false);
    assert.match(check.note, /forbidden key "cwd"/);
  });
});

test('eval gate fails gitignore-guard when real data is re-allowlisted', () => {
  withTempRepoRoot((dir) => {
    writeFileSync(join(dir, '.gitignore'), 'public/data/*\n!public/data/sessions.json\n');
  }, (repoRoot) => {
    const results = runChecks({ repoRoot });
    const check = results.find((r) => r.id === 'gitignore-guard');
    assert.equal(check.ok, false);
    assert.match(check.note, /re-allowlists real data/);
  });
});
