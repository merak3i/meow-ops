#!/usr/bin/env node
// Local verification runner for the Review Deck.
//
// It stores only check ids and exit codes outside the worktree. Raw command
// output can contain paths or secrets, so it is deliberately never persisted.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { resolveIntakeDir, writeIntakeJson } from './intake-local.mjs';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const REVIEW_FILE = 'review-fix.json';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const CHECKS = [
  { id: 'sync-tests', args: ['run', 'test:sync'] },
  { id: 'eval', args: ['run', 'eval'] },
  { id: 'lint', args: ['run', 'lint'] },
  { id: 'typecheck', args: ['run', 'typecheck'] },
  { id: 'build', args: ['run', 'build'] },
];
const E2E_CHECK = { id: 'e2e', args: ['run', 'test:e2e'] };

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function exitCode(error) {
  return Number.isInteger(error?.code) ? error.code : 1;
}

async function runNpmCheck(check, { repoRoot }) {
  try {
    await execFileAsync(NPM, check.args, { cwd: repoRoot, maxBuffer: 2 * 1024 * 1024 });
    return 0;
  } catch (error) {
    return exitCode(error);
  }
}

export async function runReviewFix({
  repoRoot = REPO_ROOT,
  intakeDir,
  env = process.env,
  now = new Date(),
  withE2E = false,
  runner = runNpmCheck,
} = {}) {
  const checks = withE2E ? [...CHECKS, E2E_CHECK] : CHECKS;
  const results = [];
  for (const check of checks) {
    const result = await runner(check, { repoRoot });
    const code = Number.isInteger(result) ? result : 1;
    results.push({ id: check.id, passed: code === 0, exit_code: code });
  }
  const snapshot = {
    generated_at: iso(now),
    checks: results,
  };
  writeIntakeJson(intakeDir || resolveIntakeDir(env), REVIEW_FILE, snapshot);
  return snapshot;
}

function parseArgs(argv) {
  const options = { propose: false, withE2E: false };
  for (const arg of argv) {
    if (arg === '--propose') options.propose = true;
    else if (arg === '--with-e2e') options.withE2E = true;
    else throw new Error(`unknown flag ${arg}`);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const snapshot = await runReviewFix({ withE2E: options.withE2E });
  if (options.propose) {
    const { runProposer } = await import('./loop-propose.mjs');
    runProposer({});
  }
  for (const check of snapshot.checks) {
    console.log(`${check.id}: ${check.passed ? 'passed' : `failed (${check.exit_code})`}`);
  }
  if (snapshot.checks.some((check) => !check.passed)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
