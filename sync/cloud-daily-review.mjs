#!/usr/bin/env node
// GitHub-hosted daily review.
//
// This intentionally reviews repository state only. GitHub-hosted runners
// cannot access the operator's local sessions, ledger, LaunchAgents, or
// localhost helper, so the report keeps that boundary explicit.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runReviewFix } from './loop-review-fix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

function markdown(report) {
  const rows = report.checks
    .map((check) => `| ${check.id} | ${check.passed ? 'pass' : `fail (${check.exit_code})`} |`)
    .join('\n');
  return [
    '# Meow Ops daily cloud review',
    '',
    `**Status:** ${report.status}`,
    `**Commit:** \`${report.source.sha || 'unknown'}\``,
    `**Generated:** ${report.generated_at}`,
    '',
    '| Check | Result |',
    '|---|---|',
    rows,
    '',
    `> ${report.nudge.title}: ${report.nudge.body}`,
    '',
    'Local session sync is deferred until the operator machine is online. No private session data was available to this runner.',
    '',
  ].join('\n');
}

export async function runCloudDailyReview({
  repoRoot = REPO_ROOT,
  outputDir = process.env.MEOW_CLOUD_OUT || join(homedir(), '.meow-ops', 'cloud-daily'),
  env = process.env,
  now = new Date(),
  deps = {},
} = {}) {
  const review = await (deps.runReviewFix || runReviewFix)({
    repoRoot,
    intakeDir: outputDir,
    env,
    now,
  });
  const failures = review.checks.filter((check) => !check.passed);
  const report = {
    schema_version: 1,
    generated_at: now.toISOString(),
    scope: 'repository-only',
    status: failures.length === 0 ? 'clear' : 'needs-attention',
    source: {
      repository: env.GITHUB_REPOSITORY || null,
      sha: env.GITHUB_SHA || null,
      run_id: env.GITHUB_RUN_ID || null,
    },
    local_sync: {
      status: 'deferred',
      reason: 'GitHub-hosted runners cannot access local session stores or localhost services.',
    },
    checks: review.checks,
    nudge: failures.length > 0 ? {
      level: 'action',
      title: `${failures.length} repository check${failures.length === 1 ? '' : 's'} need attention`,
      body: `Start with ${failures[0].id}; reproduce it locally before changing code.`,
      prompt: 'Review failing repository checks',
    } : {
      level: 'quiet',
      title: 'Repository review is clear',
      body: 'All cloud-safe gates passed. Local session ingestion will resume when the operator machine is online.',
      prompt: 'What changed today?',
    },
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'cloud-daily.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = markdown(report);
  writeFileSync(join(outputDir, 'cloud-daily.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return report;
}

export async function main() {
  const report = await runCloudDailyReview();
  console.log(`cloud daily review: ${report.status}; local sync=${report.local_sync.status}`);
  if (report.status !== 'clear') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
