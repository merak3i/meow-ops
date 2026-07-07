#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { appendRecord, foldLatestById, readLedger } from './loop-ledger.mjs';
import { loadEnv } from './load-env.mjs';
import { REVIEW_ONLY_PATH_RE } from './loop-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const GATES = [
  ['test:sync', ['run', 'test:sync']],
  ['eval', ['run', 'eval']],
  ['build', ['run', 'build']],
];

export function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function parseArgs(argv) {
  let proposal = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--proposal') throw new Error(`unknown flag ${argv[i]}`);
    proposal = argv[i + 1];
    i++;
  }
  if (!proposal) throw new Error('--proposal <proposal_id> is required');
  return { proposal };
}

function tail(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(-500);
}

function run(execSync, cmd, args, cwd) {
  try {
    const out = execSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
    return { pass: true, note: tail(out) || 'ok' };
  } catch (err) {
    const out = `${err.stdout || ''}\n${err.stderr || ''}`.trim() || err.message;
    return { pass: false, note: tail(out) };
  }
}

export function validateExecutableProposal(proposalId, {
  env = process.env, proposals = foldLatestById(readLedger('proposal'), 'proposal_id'), repoRoot = REPO_ROOT,
} = {}) {
  if (env.MEOW_EXECUTOR_ENABLED !== '1') throw new Error('[executor-disabled] set MEOW_EXECUTOR_ENABLED=1 to enable');
  const proposal = proposals.find((item) => item.proposal_id === proposalId);
  if (!proposal) throw new Error('[proposal] not found');
  if (proposal.status !== 'approved') throw new Error('[status] proposal must be approved before execution');
  if (proposal.review_only === true) throw new Error('[review_only] review-only proposals cannot be executed');
  if (!proposal.diff || typeof proposal.diff !== 'object' || typeof proposal.diff.target_path !== 'string') {
    throw new Error('[diff] proposal has no actionable diff');
  }
  const targetPath = proposal.diff.target_path;
  const target = resolve(repoRoot, targetPath);
  if (REVIEW_ONLY_PATH_RE.test(targetPath) || !isInside(repoRoot, target)) {
    throw new Error('[target-fence] target path matches a gated surface and cannot be executed');
  }
  return { proposal, targetPath };
}

function applyDiff(proposal, worktreeDir, execSync) {
  if (typeof proposal.diff.patch === 'string') {
    const patchFile = join(tmpdir(), `meow-exec-${randomBytes(4).toString('hex')}.patch`);
    writeFileSync(patchFile, proposal.diff.patch);
    const result = run(execSync, 'git', ['apply', patchFile], worktreeDir);
    rmSync(patchFile, { force: true });
    return result;
  }
  if (typeof proposal.diff.before === 'string' && typeof proposal.diff.after === 'string') {
    const target = resolve(worktreeDir, proposal.diff.target_path);
    if (!isInside(worktreeDir, target)) return { pass: false, note: '[target-fence] target escaped worktree' };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, proposal.diff.after);
    return { pass: true, note: 'applied before/after content' };
  }
  return { pass: false, note: '[diff] proposal diff has no applicable patch or before/after content' };
}

function appendExecutionEvidence(proposal, gateResults, now = new Date()) {
  const pass = gateResults.every((gate) => gate.pass);
  const stored = appendRecord('proposal', {
    ...proposal,
    created_by: 'system:executor',
    evidence: [
      ...proposal.evidence,
      { kind: 'execution', ref: `dry-run-${Date.now().toString(36)}`, pass, gates: gateResults, executed_at: now.toISOString(), mode: 'dry-run' },
    ],
    status: 'approved',
  });
  return { pass, proposal: stored, gateResults };
}

export function executeProposal({
  proposalId, repoRoot = REPO_ROOT, env = process.env, execSync = execFileSync, now = new Date(), tmpBase = tmpdir(),
} = {}) {
  const { proposal } = validateExecutableProposal(proposalId, { env, repoRoot });
  const worktreeDir = join(tmpBase, `meow-exec-${randomBytes(4).toString('hex')}`);
  const gateResults = [];
  try {
    execSync('git', ['worktree', 'add', worktreeDir, 'HEAD', '--detach'], { cwd: repoRoot, stdio: 'pipe' });
    const applied = applyDiff(proposal, worktreeDir, execSync);
    if (!applied.pass) gateResults.push({ gate: 'apply', pass: false, note: applied.note });
    else {
      const install = run(execSync, 'npm', ['ci'], worktreeDir);
      if (!install.pass) gateResults.push({ gate: 'npm ci', pass: false, note: install.note });
      else for (const [gate, args] of GATES) gateResults.push({ gate, ...run(execSync, 'npm', args, worktreeDir) });
    }
    return appendExecutionEvidence(proposal, gateResults, now);
  } finally {
    try { execSync('git', ['worktree', 'remove', worktreeDir, '--force'], { cwd: repoRoot, stdio: 'pipe' }); } catch {}
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const { proposal } = parseArgs(argv);
  const result = executeProposal({ proposalId: proposal });
  console.log(`execution dry-run ${result.pass ? 'passed' : 'failed'}: ${result.gateResults.map((g) => `${g.gate}=${g.pass ? 'ok' : 'FAIL'}`).join(', ')}`);
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv(REPO_ROOT);
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
