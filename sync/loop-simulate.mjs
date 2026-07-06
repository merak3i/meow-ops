#!/usr/bin/env node
// Simulate a Loop Engineering proposal before owner approval.
//
// Test proposals may only execute tests under sync/__tests__/. Other proposals
// get checklist simulation: local structure only, no network and no writes
// beyond the ledger append choke point.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  dirname, isAbsolute, join, relative, resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  appendRecord, foldLatestById, newId, readLedger,
} from './loop-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseArgs(argv) {
  const opts = { proposal: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (!(name in opts)) throw new Error(`unknown flag --${name}`);
    opts[name] = argv[i + 1];
    i++;
  }
  if (!opts.proposal) throw new Error('--proposal <proposal_id> is required');
  return opts;
}

function latestProposal(proposalId, records = readLedger('proposal')) {
  return foldLatestById(records, 'proposal_id')
    .find((proposal) => proposal.proposal_id === proposalId) || null;
}

function targetInfo(repoRoot, targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return null;
  const resolved = resolve(repoRoot, targetPath);
  const rel = relative(repoRoot, resolved).split('/').join('/');
  return { resolved, rel };
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isTestTarget(repoRoot, resolved) {
  return isInside(resolve(repoRoot, 'sync', '__tests__'), resolved);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function cleanNote(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 240);
}

function appendSimulation(proposal, mode, results, { now = new Date() } = {}) {
  return appendRecord('simulation', {
    simulation_id: newId('sim'),
    proposal_id: proposal.proposal_id,
    ran_at: iso(now),
    mode,
    results,
    pass: results.every((result) => result.pass === true),
  });
}

function simulationMode(proposal, repoRoot) {
  const info = targetInfo(repoRoot, proposal.diff?.target_path);
  if (proposal.category !== 'test') return { mode: 'checklist', target: info };
  if (!info || !isTestTarget(repoRoot, info.resolved)) {
    throw new Error('[simulation-target] test proposals must target a file under sync/__tests__/');
  }
  return { mode: 'test-run', target: info };
}

function testRunResults(repoRoot, target) {
  const results = [];
  // node --test exit codes for a missing file differ across node majors
  // (20 exits 0, 25 exits 1) — resolve existence here so the simulation
  // verdict never depends on the runner version.
  if (!existsSync(target.resolved)) {
    results.push({ check: 'target exists', pass: false, note: `${target.rel} not found` });
    return results;
  }
  try {
    execFileSync(process.execPath, ['--test', target.rel], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    results.push({ check: 'node --test', pass: true, note: `${target.rel} passed` });
  } catch (err) {
    results.push({
      check: 'node --test',
      pass: false,
      note: `${target.rel} failed with exit ${err.status ?? 1}`,
    });
  }
  return results;
}

function checklistResults(proposal, repoRoot, target) {
  const results = [];
  if (target) {
    results.push({
      check: 'target exists',
      pass: existsSync(target.resolved),
      note: target.rel,
    });
  }
  results.push({
    check: 'rollback plan',
    pass: Boolean(proposal.rollback?.plan),
    note: proposal.rollback?.plan ? 'present' : 'missing',
  });
  results.push({
    check: 'evidence',
    pass: Array.isArray(proposal.evidence) && proposal.evidence.length > 0,
    note: `${Array.isArray(proposal.evidence) ? proposal.evidence.length : 0} item(s)`,
  });
  return results;
}

function withRollbackHash(proposal, target) {
  if (!target || !existsSync(target.resolved)) return proposal;
  return {
    ...proposal,
    rollback: {
      ...proposal.rollback,
      prior_sha256: sha256(target.resolved),
    },
  };
}

function assertSimulatable(proposal) {
  if (!proposal) throw new Error('[proposal] proposal not found');
  if (proposal.status !== 'draft') {
    throw new Error('[status-flow] only latest draft proposals can be simulated');
  }
  if (String(proposal.rollback?.plan || '').toLowerCase().startsWith('n/a')) {
    throw new Error('[simulation-skeleton] skeleton proposals are not simulatable; complete the draft manually first');
  }
}

export function simulateProposal({
  proposalId,
  repoRoot = REPO_ROOT,
  now = new Date(),
} = {}) {
  const proposal = latestProposal(proposalId);
  assertSimulatable(proposal);
  const { mode, target } = simulationMode(proposal, repoRoot);
  const results = mode === 'test-run'
    ? testRunResults(repoRoot, target)
    : checklistResults(proposal, repoRoot, target);
  const simulation = appendSimulation(proposal, mode, results, { now });

  if (!simulation.pass) {
    return { ok: false, proposal, simulation, pending: null };
  }

  const base = withRollbackHash(proposal, target);
  const simulated = appendRecord('proposal', {
    ...base,
    created_by: 'system:simulate',
    simulation_id: simulation.simulation_id,
    status: 'simulated',
  });
  const pending = appendRecord('proposal', {
    ...simulated,
    created_by: 'system:simulate',
    status: 'pending_approval',
  });
  return { ok: true, proposal, simulation, pending };
}

function main() {
  let result;
  try {
    const opts = parseArgs(process.argv.slice(2));
    result = simulateProposal({ proposalId: opts.proposal });
  } catch (err) {
    console.error(cleanNote(err.message));
    process.exit(1);
  }
  const status = result.ok ? 'passed' : 'failed';
  console.log(`simulation ${result.simulation.simulation_id} ${status}: ${result.simulation.mode}`);
  for (const check of result.simulation.results) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.check}: ${check.note || ''}`);
  }
  if (result.pending) console.log(`advanced ${result.pending.proposal_id} to ${result.pending.status}`);
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
