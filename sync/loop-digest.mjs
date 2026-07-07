#!/usr/bin/env node
// Daily Loop Engineering digest: capture, intake, health, propose, summarize.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadEnv } from './load-env.mjs';
import { appendRecord, readLedger } from './loop-ledger.mjs';
import { buildRun, selectSessions, summarize } from './loop-capture.mjs';
import { runIntake } from './intake-local.mjs';
import { runAutomationHealth } from './automation-health.mjs';
import { runAllRules } from './loop-propose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const LOOP_ID = 'meow-ops-dev';
const EMPTY_INTAKE = { processed: 0, stored: 0, dropped: 0, skipped: 0 };

function latestProposals(records) {
  const byId = new Map();
  for (const record of records) byId.set(record.proposal_id, record);
  return [...byId.values()];
}

export function assembleDigest({
  nowIso, sinceIso, run, captureSessions, intake, health, newDraftCount, proposals, notes,
}) {
  const latest = latestProposals(proposals);
  return {
    generated_at: nowIso,
    period: { since: sinceIso, until: nowIso },
    capture: { run_id: run?.run_id || null, sessions: run?.metrics?.sessions || captureSessions || 0 },
    intake: {
      processed: intake.processed || 0,
      stored: intake.stored || 0,
      dropped: intake.dropped || 0,
      skipped: intake.skipped || 0,
    },
    health: {
      agents_total: health.agents.length,
      flagged: health.agents.filter((agent) => agent.flags.length > 0).length,
      flags: [...new Set(health.agents.flatMap((agent) => agent.flags))].sort(),
      agents: health.agents.map((agent) => ({
        label: agent.label,
        running: agent.running,
        last_exit_status: agent.last_exit_status,
        log_staleness_hours: agent.log_staleness_hours,
        flags: agent.flags,
      })),
    },
    proposals: {
      new_drafts: newDraftCount,
      pending: latest.filter((proposal) => proposal.status === 'pending_approval').length,
      total: latest.length,
    },
    ...(notes.length ? { notes } : {}),
  };
}

function writeDigest(path, digest) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(digest, null, 2)}\n`);
}

function appendDigestHistory(dir, digest) {
  appendFileSync(join(dir, 'digest-history.jsonl'), `${JSON.stringify(digest)}\n`);
}

export async function runDigest({
  repoRoot = REPO_ROOT,
  now = new Date(),
  noIntake = false,
  noAi = false,
  deps = {},
} = {}) {
  const nowIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const sessionsPath = join(repoRoot, 'public', 'data', 'sessions.json');
  const rawSessions = deps.readSessions
    ? deps.readSessions(sessionsPath)
    : (existsSync(sessionsPath) ? JSON.parse(readFileSync(sessionsPath, 'utf8')) : []);
  const sessions = selectSessions(rawSessions, { loop: LOOP_ID, since: sinceIso });
  const captureSummary = summarize(sessions);
  const run = sessions.length === 0 ? null : (deps.appendRun
    ? deps.appendRun(sessions, { loop: LOOP_ID, since: sinceIso })
    : appendRecord('run', buildRun(sessions, { loop: LOOP_ID, since: sinceIso })));

  const notes = [];
  let intake = EMPTY_INTAKE;
  if (!noIntake) {
    try {
      intake = await (deps.runIntake || runIntake)({ limit: 5 });
    } catch (err) {
      notes.push(`intake failed: ${err.message}`);
      intake = { ...EMPTY_INTAKE, dropped: 1 };
    }
  }
  const health = await (deps.runAutomationHealth || runAutomationHealth)();
  const ruleRun = await (deps.runAllRules || runAllRules)({
    repoRoot, now, ai: !noAi,
  });
  const proposals = deps.readProposals ? deps.readProposals() : readLedger('proposal');
  const digest = assembleDigest({
    nowIso,
    sinceIso,
    run,
    captureSessions: captureSummary.metrics.sessions,
    intake,
    health,
    newDraftCount: ruleRun.proposals?.length || 0,
    proposals,
    notes,
  });
  const digestDir = join(repoRoot, 'public', 'data', 'loop-engineering');
  (deps.writeDigest || writeDigest)(join(digestDir, 'digest.json'), digest);
  (deps.appendDigestHistory || appendDigestHistory)(digestDir, digest);
  return digest;
}

export async function main(argv = process.argv.slice(2)) {
  const digest = await runDigest({ noIntake: argv.includes('--no-intake'), noAi: argv.includes('--no-ai') });
  console.log(`digest generated: ${digest.capture.sessions} sessions, ${digest.intake.stored} intake, ${digest.health.flagged} flagged agents, ${digest.proposals.new_drafts} new proposals`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv(REPO_ROOT);
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
