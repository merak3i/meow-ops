#!/usr/bin/env node
// One daily local operations cycle: sync, validate, review, and write a nudge.

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadEnv } from './load-env.mjs';
import { runDigest } from './loop-digest.mjs';
import { runSync } from './sync-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

function buildNudge(sync, digest, now = new Date()) {
  if (sync.state === 'failed') {
    return {
      level: 'action',
      title: `Sync stopped at ${sync.failure?.stage || sync.phase || 'unknown'}`,
      body: sync.failure?.summary || 'Open Sync Activity and inspect the recorded phase.',
      prompt: 'Prepare a repair prompt',
    };
  }
  if ((digest.health?.flagged || 0) > 0) {
    return {
      level: 'review',
      title: `${digest.health.flagged} automation${digest.health.flagged === 1 ? '' : 's'} need review`,
      body: 'Companion can rank the first evidence-backed investigation without executing changes.',
      prompt: 'What should I fix next?',
    };
  }
  if ((digest.proposals?.pending || 0) > 0) {
    return {
      level: 'review',
      title: `${digest.proposals.pending} proposal${digest.proposals.pending === 1 ? '' : 's'} waiting`,
      body: 'Review evidence and simulation before approving any action.',
      prompt: 'What should I fix next?',
    };
  }
  return {
    level: 'quiet',
    title: 'Daily review is clear',
    body: `${sync.artifact?.sessions || 0} sessions verified at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
    prompt: 'What changed today?',
  };
}

export async function runDailyOperator({ repoRoot = REPO_ROOT, env = process.env, now = new Date(), deps = {} } = {}) {
  // This process gets at most one DeepSeek call. Deterministic rules and local
  // evidence still run when the key, network, or budget is unavailable.
  env.MEOW_LLM_CALLS_PER_CYCLE = '1';
  const sync = await (deps.runSync || runSync)({
    repoRoot,
    env,
    trigger: 'daily',
    node: process.execPath,
  });
  const digest = await (deps.runDigest || runDigest)({ repoRoot, now });
  const nudge = {
    generated_at: now.toISOString(),
    sync_run_id: sync.run_id || null,
    ...buildNudge(sync, digest, now),
  };
  const runtime = env.MEOW_RUNTIME_DIR || join(homedir(), '.meow-ops', 'runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, 'daily-nudge.json'), `${JSON.stringify(nudge, null, 2)}\n`, { mode: 0o600 });
  return { sync, digest, nudge };
}

export async function main() {
  loadEnv(REPO_ROOT);
  const result = await runDailyOperator();
  console.log(`daily operator: sync=${result.sync.state}, flagged=${result.digest.health.flagged}, pending=${result.digest.proposals.pending}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
