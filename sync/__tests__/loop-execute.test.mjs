import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendRecord, foldLatestById, newId, readLedger } from '../loop-ledger.mjs';
import { executeProposal, validateExecutableProposal } from '../loop-execute.mjs';
import { AUTO_MERGE_CATEGORIES } from '../loop-schema.mjs';

const NOW = new Date('2026-07-07T00:00:00.000Z');

function withTempLedger(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-loop-exec-ledger-'));
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = dir;
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function withTempRepo(fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'meow-exec-repo-'));
  try { return fn(repoRoot); } finally { rmSync(repoRoot, { recursive: true, force: true }); }
}

function draft(overrides = {}) {
  return {
    proposal_id: newId('prop'),
    loop_id: 'executor-test-loop',
    created_at: NOW.toISOString(),
    created_by: 'assistant:prompt',
    category: 'prompt',
    title: 'Executor synthetic proposal',
    one_percent_target: 'Prove dry-run execution',
    diff: { target_path: 'prompts/library/executor.md', before: '', after: '# Executor\n' },
    evidence: [{ kind: 'rule', ref: 'executor-test' }],
    rollback: { plan: 'delete prompts/library/executor.md' },
    review_only: false,
    status: 'draft',
    ...overrides,
  };
}

function advance(record, status, createdBy) {
  return appendRecord('proposal', { ...record, created_by: createdBy, status });
}

function approvedProposal(overrides = {}) {
  const d = appendRecord('proposal', draft(overrides));
  const s = advance(d, 'simulated', 'system:simulate');
  const p = advance(s, 'pending_approval', 'system:simulate');
  return advance(p, 'approved', 'owner');
}

function mockExec({
  failGate = null,
  failPush = false,
  failMerge = false,
  prUrl = 'https://github.com/merak3i/meow-ops/pull/99',
} = {}) {
  const calls = [];
  const execSync = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') mkdirSync(args[2], { recursive: true });
    if (cmd === 'git' && args[0] === 'push' && failPush) {
      const err = new Error('push failed');
      err.stdout = '';
      err.stderr = 'push failed';
      throw err;
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return `${prUrl}\n`;
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge' && failMerge) {
      const err = new Error('merge failed');
      err.stdout = '';
      err.stderr = 'merge failed';
      throw err;
    }
    if (cmd === 'npm' && args[0] === 'run' && args[1] === failGate) {
      const err = new Error(`${failGate} failed`);
      err.stdout = '';
      err.stderr = `${failGate} failed`;
      throw err;
    }
    return `${cmd} ${args.join(' ')} ok`;
  };
  return { calls, execSync };
}

test('executor-disabled rejects when env missing', () => {
  assert.throws(() => validateExecutableProposal('fake_id', { env: {}, proposals: [] }), /\[executor-disabled\]/);
});

test('review_only proposal rejected', () => withTempLedger(() => {
  const proposal = approvedProposal({ review_only: true });
  assert.throws(() => validateExecutableProposal(proposal.proposal_id, { env: { MEOW_EXECUTOR_ENABLED: '1' } }), /\[review_only\]/);
}));

test('non-approved proposal rejected', () => withTempLedger(() => {
  const proposal = advance(advance(appendRecord('proposal', draft()), 'simulated', 'system:simulate'), 'pending_approval', 'system:simulate');
  assert.throws(() => validateExecutableProposal(proposal.proposal_id, { env: { MEOW_EXECUTOR_ENABLED: '1' } }), /\[status\]/);
}));

test('target-fence blocks gated paths', () => {
  const base = { ...draft(), status: 'approved', review_only: false };
  assert.throws(
    () => validateExecutableProposal(base.proposal_id, {
      env: { MEOW_EXECUTOR_ENABLED: '1' },
      repoRoot: '/repo',
      proposals: [{ ...base, diff: { target_path: '.github/workflows/ci.yml', before: '', after: 'x' } }],
    }),
    /\[target-fence\]/,
  );
});

test('isInside blocks traversal', () => {
  const base = { ...draft(), status: 'approved', review_only: false };
  assert.throws(
    () => validateExecutableProposal(base.proposal_id, {
      env: { MEOW_EXECUTOR_ENABLED: '1' },
      repoRoot: '/repo',
      proposals: [{ ...base, diff: { target_path: '../../etc/passwd', before: '', after: 'x' } }],
    }),
    /\[target-fence\]/,
  );
});

test('worktree cleanup on gate failure', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'meow-exec-work-'));
    const proposal = approvedProposal();
    const mocked = mockExec({ failGate: 'eval' });
    const result = executeProposal({
      proposalId: proposal.proposal_id,
      repoRoot,
      tmpBase,
      now: NOW,
      env: { MEOW_EXECUTOR_ENABLED: '1' },
      execSync: mocked.execSync,
    });
    assert.equal(result.pass, false);
    const worktree = mocked.calls.find((call) => call.cmd === 'git' && call.args[1] === 'add').args[2];
    assert.equal(existsSync(worktree), false);
    rmSync(tmpBase, { recursive: true, force: true });
  });
}));

test('execution evidence appended on success', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    const result = executeProposal({
      proposalId: proposal.proposal_id,
      repoRoot,
      now: NOW,
      env: { MEOW_EXECUTOR_ENABLED: '1' },
      execSync: mockExec().execSync,
    });
    assert.equal(result.pass, true);
    const latest = foldLatestById(readLedger('proposal'), 'proposal_id')[0];
    const evidence = latest.evidence.find((item) => item.kind === 'execution');
    assert.equal(latest.status, 'approved');
    assert.equal(evidence.pass, true);
    assert.equal(evidence.mode, 'dry-run');
    assert.deepEqual(evidence.gates.map((gate) => [gate.gate, gate.pass]), [['test:sync', true], ['eval', true], ['build', true]]);
  });
}));

test('execution evidence records gate failure', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    const result = executeProposal({
      proposalId: proposal.proposal_id,
      repoRoot,
      now: NOW,
      env: { MEOW_EXECUTOR_ENABLED: '1' },
      execSync: mockExec({ failGate: 'eval' }).execSync,
    });
    assert.equal(result.pass, false);
    const evidence = foldLatestById(readLedger('proposal'), 'proposal_id')[0].evidence.find((item) => item.kind === 'execution');
    assert.equal(evidence.pass, false);
    assert.deepEqual(evidence.gates.map((gate) => [gate.gate, gate.pass]), [['test:sync', true], ['eval', false], ['build', true]]);
  });
}));

test('push mode commits and creates PR', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    const mocked = mockExec();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mocked.execSync });
    const commands = mocked.calls.map((call) => `${call.cmd} ${call.args.join(' ')}`);
    assert.ok(commands.some((cmd) => cmd.includes('git checkout -b executor/')));
    assert.ok(commands.includes('git add -A'));
    assert.ok(commands.some((cmd) => cmd.startsWith('git commit -m docs: Executor synthetic proposal')));
    assert.ok(commands.some((cmd) => cmd.includes('git push origin executor/')));
    assert.ok(commands.some((cmd) => cmd.startsWith('gh pr create')));
  });
}));

test('push mode advances proposal to applied', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mockExec().execSync });
    const latest = foldLatestById(readLedger('proposal'), 'proposal_id')[0];
    const evidence = latest.evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    const decision = readLedger('decision').find((item) => item.created_by === 'system:executor');
    assert.equal(latest.status, 'applied');
    assert.equal(evidence.pass, true);
    assert.equal(decision.decided_by, 'system:executor');
  });
}));

test('push failure does not advance status', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mockExec({ failPush: true }).execSync });
    const latest = foldLatestById(readLedger('proposal'), 'proposal_id')[0];
    const evidence = latest.evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    assert.equal(latest.status, 'approved');
    assert.equal(evidence.pass, false);
    assert.equal(readLedger('decision').some((item) => item.created_by === 'system:executor'), false);
  });
}));

test('mode defaults to dry-run', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    const mocked = mockExec();
    executeProposal({ proposalId: proposal.proposal_id, repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mocked.execSync });
    assert.equal(mocked.calls.some((call) => call.cmd === 'git' && call.args[0] === 'push'), false);
    assert.equal(mocked.calls.some((call) => call.cmd === 'gh'), false);
  });
}));

test('PR URL captured in evidence', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mockExec({ prUrl: 'https://github.com/merak3i/meow-ops/pull/99' }).execSync });
    const evidence = foldLatestById(readLedger('proposal'), 'proposal_id')[0].evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    assert.equal(evidence.pr_url, 'https://github.com/merak3i/meow-ops/pull/99');
  });
}));

test('workflow category does not auto-merge even with green CI', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal({ category: 'workflow' });
    const mocked = mockExec();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mocked.execSync });
    const evidence = foldLatestById(readLedger('proposal'), 'proposal_id')[0].evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    assert.equal(mocked.calls.some((call) => call.cmd === 'gh' && call.args[0] === 'pr' && call.args[1] === 'merge'), false);
    assert.equal(evidence.auto_merged, false);
  });
}));

test('test category triggers auto-merge', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal({ category: 'test' });
    const mocked = mockExec();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mocked.execSync });
    const evidence = foldLatestById(readLedger('proposal'), 'proposal_id')[0].evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    assert.ok(mocked.calls.some((call) => call.cmd === 'gh' && call.args.join(' ') === 'pr merge https://github.com/merak3i/meow-ops/pull/99 --squash --delete-branch'));
    assert.equal(evidence.auto_merged, true);
  });
}));

test('prompt category triggers auto-merge', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal({ category: 'prompt' });
    const mocked = mockExec();
    executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mocked.execSync });
    const evidence = foldLatestById(readLedger('proposal'), 'proposal_id')[0].evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    assert.ok(mocked.calls.some((call) => call.cmd === 'gh' && call.args[1] === 'merge'));
    assert.equal(evidence.auto_merged, true);
  });
}));

test('auto-merge failure records error and does not retry', () => withTempLedger(() => {
  withTempRepo((repoRoot) => {
    const proposal = approvedProposal({ category: 'test' });
    const mocked = mockExec({ failMerge: true });
    const result = executeProposal({ proposalId: proposal.proposal_id, mode: 'push', repoRoot, now: NOW, env: { MEOW_EXECUTOR_ENABLED: '1' }, execSync: mocked.execSync });
    const evidence = foldLatestById(readLedger('proposal'), 'proposal_id')[0].evidence.find((item) => item.kind === 'execution' && item.mode === 'push');
    const merges = mocked.calls.filter((call) => call.cmd === 'gh' && call.args[1] === 'merge');
    assert.equal(result.pass, true);
    assert.equal(merges.length, 1);
    assert.equal(evidence.auto_merged, false);
    assert.match(evidence.auto_merge_error, /merge failed/);
  });
}));

test('AUTO_MERGE_CATEGORIES is exactly test and prompt', () => {
  assert.equal(AUTO_MERGE_CATEGORIES.size, 2);
  assert.equal(AUTO_MERGE_CATEGORIES.has('test'), true);
  assert.equal(AUTO_MERGE_CATEGORIES.has('prompt'), true);
});
