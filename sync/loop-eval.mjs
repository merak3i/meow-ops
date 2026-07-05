#!/usr/bin/env node
// `npm run eval` — the universal Loop Engineering gate.
//
// One runner shared by tests, (future) simulation, (future) CI, and pre-push
// checks. Prints a PASS/FAIL table and exits non-zero on any FAIL. Check
// output names files and rule ids only — matched content is never printed,
// so even a public CI log cannot republish what a check caught.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateLoopRun, validateProposal, validateStatusTransition } from './loop-schema.mjs';
import { assertRedacted } from './loop-ledger.mjs';
import { compareRuns } from './loop-capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const DEFAULT_FIXTURES = join(HERE, '__fixtures__', 'loop');

// The demo files are the only public/data entries allowed in git — synthetic
// by construction. Anything else tracked there is a leak regression.
const ALLOWED_TRACKED_DATA = new Set([
  'public/data/demo-cost-summary.json',
  'public/data/demo-sessions.json',
  'public/data/demo-superadmin-usage.json',
]);

const FORBIDDEN_SESSION_KEYS = ['"cwd"', '"session_title"', '"first_user_message"'];

function checkGoldenRuns(fixturesDir) {
  const pairs = JSON.parse(readFileSync(join(fixturesDir, 'golden-runs.json'), 'utf8'));
  for (const pair of pairs) {
    validateLoopRun(pair.baseline);
    validateLoopRun(pair.after);
    const { deltas, flags } = compareRuns(pair.baseline, pair.after);
    for (const [metric, expected] of Object.entries(pair.expected_delta_pct)) {
      const got = deltas[metric] && deltas[metric].delta_pct;
      if (got !== expected) {
        throw new Error(`${pair.name}: delta_pct(${metric}) = ${got}, expected ${expected}`);
      }
    }
    const expectedFlags = [...pair.expected_flags].sort().join(',');
    if (flags.join(',') !== expectedFlags) {
      throw new Error(`${pair.name}: flags [${flags.join(',')}], expected [${expectedFlags}]`);
    }
  }
  return `${pairs.length} golden run pair(s) reproduce hand-computed deltas`;
}

function checkGoldenProposals(fixturesDir) {
  const entries = JSON.parse(readFileSync(join(fixturesDir, 'golden-proposals.json'), 'utf8'));
  let mustFail = 0;
  for (const entry of entries) {
    if (!entry.expect_fail) {
      validateProposal(entry.record);
      continue;
    }
    mustFail++;
    let failedAs = null;
    try {
      validateProposal(entry.record);
    } catch (err) {
      failedAs = err.message;
    }
    if (!failedAs) throw new Error(`${entry.name}: expected [${entry.expect_fail}] rejection but record validated`);
    if (!failedAs.includes(`[${entry.expect_fail}]`)) {
      throw new Error(`${entry.name}: rejected, but not by [${entry.expect_fail}]`);
    }
  }
  if (mustFail === 0) throw new Error('no must-fail fixtures found — negative coverage is mandatory');
  return `${entries.length} proposals checked, ${mustFail} must-fail case(s) failed for the right reason`;
}

function checkStatusMachine() {
  const illegal = [['draft', 'approved'], ['draft', 'applied'], ['simulated', 'approved'], ['rejected', 'approved']];
  for (const [from, to] of illegal) {
    let threw = false;
    try {
      validateStatusTransition(from, to);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`illegal transition ${from} → ${to} was allowed`);
  }
  validateStatusTransition('draft', 'simulated');
  validateStatusTransition('pending_approval', 'approved');
  return 'status machine rejects every skip, allows the legal walk';
}

function checkSessionsRedaction(repoRoot) {
  const path = join(repoRoot, 'public', 'data', 'sessions.json');
  if (!existsSync(path)) return 'public/data/sessions.json absent — nothing to scan (ok)';
  const raw = readFileSync(path, 'utf8');
  for (const key of FORBIDDEN_SESSION_KEYS) {
    if (raw.includes(key)) throw new Error(`sessions.json contains forbidden key ${key}`);
  }
  return 'local sessions.json carries no content-bearing keys';
}

export function checkGitignore(repoRoot) {
  const raw = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
  const lines = raw.split('\n').map((l) => l.trim());
  if (!lines.includes('public/data/*')) throw new Error('.gitignore lost the public/data/* rule');
  // demo-* negations are the one legitimate exception: synthetic by
  // construction and required by the hosted demo rewrites.
  const badNegation = lines.find(
    (l) => l.startsWith('!') && !l.includes('demo-')
      && /loop|sessions\.json|cost-summary|rate-limits/.test(l),
  );
  if (badNegation) throw new Error(`.gitignore re-allowlists real data: "${badNegation}"`);
  if (!existsSync(join(repoRoot, '.git'))) {
    return 'git metadata absent; .gitignore pattern check passed (tracked-data scan skipped)';
  }
  const tracked = execSync('git ls-files public/data', { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const extras = tracked.filter((f) => !ALLOWED_TRACKED_DATA.has(f));
  if (extras.length > 0) throw new Error(`unexpected tracked data file(s): ${extras.join(', ')}`);
  return `only ${tracked.length} demo file(s) tracked under public/data`;
}

function checkFixtureRedaction(fixturesDir) {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error('no fixture files found — redaction scan is vacuous');
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
    assertRedacted(parsed, `fixture ${file}`);
  }
  return `${files.length} fixture file(s) pass the redaction scan`;
}

export function runChecks({ fixturesDir = DEFAULT_FIXTURES, repoRoot = REPO_ROOT } = {}) {
  const checks = [
    ['golden-runs', () => checkGoldenRuns(fixturesDir)],
    ['golden-proposals', () => checkGoldenProposals(fixturesDir)],
    ['status-machine', checkStatusMachine],
    ['sessions-redaction', () => checkSessionsRedaction(repoRoot)],
    ['gitignore-guard', () => checkGitignore(repoRoot)],
    ['fixture-redaction', () => checkFixtureRedaction(fixturesDir)],
  ];
  const results = [];
  for (const [id, fn] of checks) {
    try {
      results.push({ id, ok: true, note: fn() });
    } catch (err) {
      results.push({ id, ok: false, note: err.message });
    }
  }
  return results;
}

function main() {
  const results = runChecks({});
  const width = Math.max(...results.map((r) => r.id.length));
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(width)}  ${r.note}`);
  }
  const failures = results.filter((r) => !r.ok).length;
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
