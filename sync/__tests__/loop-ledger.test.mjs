import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendRecord, assertRedacted, foldLatestById, newId, readLedger, resolveLedgerDir,
} from '../loop-ledger.mjs';
import { validateProposal, validateStatusTransition } from '../loop-schema.mjs';
import {
  compareRuns, readLoopAliases, resolveLoopId, selectSessions, summarize,
} from '../loop-capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '__fixtures__', 'loop');

function withTempLedger(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-loop-'));
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function validRun() {
  return {
    run_id: newId('run'),
    loop_id: 'demo-loop',
    captured_at: new Date().toISOString(),
    sources: ['claude'],
    session_ids: ['demo-1'],
    metrics: { sessions: 1, duration_seconds: 10, total_tokens: 100, message_count: 2 },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validDraftProposal(overrides = {}) {
  const proposals = JSON.parse(readFileSync(join(FIXTURES, 'golden-proposals.json'), 'utf8'));
  return {
    ...clone(proposals.find((p) => p.expect_fail === null).record),
    proposal_id: newId('prop'),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

test('appendRecord round-trips through the ledger and stamps schema_version', () => {
  withTempLedger(() => {
    const stored = appendRecord('run', validRun());
    const back = readLedger('run');
    assert.equal(back.length, 1);
    assert.equal(back[0].run_id, stored.run_id);
    assert.equal(back[0].schema_version, 1);
  });
});

test('allowlist serializer drops unknown fields before they reach disk', () => {
  withTempLedger(() => {
    appendRecord('run', { ...validRun(), sneaky_note: 'should never persist' });
    assert.equal(readLedger('run')[0].sneaky_note, undefined);
  });
});

test('validator rejects a run missing loop_id', () => {
  withTempLedger(() => {
    const bad = validRun();
    delete bad.loop_id;
    assert.throws(() => appendRecord('run', bad), /\[missing-field\]/);
  });
});

test('worktree guard refuses a ledger dir inside a git repo', () => {
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = join(HERE, '..'); // sync/ — inside this repo
  try {
    assert.throws(() => resolveLedgerDir(), /\[worktree-guard\]/);
  } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
  }
});

test('assertRedacted rejects secrets and paths without echoing them', () => {
  // Secret-shaped strings are constructed at runtime on purpose — storing
  // them in fixtures would force the fixture scanner to carry exemptions.
  const homePath = ['/Users', 'x', 'project'].join('/');
  const fakeKey = `sk-${'a'.repeat(24)}`;
  for (const [value, rule] of [
    [homePath, 'abs-home-path'],
    [fakeKey, 'anthropic-key'],
    [['ghp_', 'a'.repeat(20)].join(''), 'github-token'],
    [['GOCSPX-', 'a'.repeat(20)].join(''), 'google-oauth'],
    [['sb_secret_', 'a'.repeat(20)].join(''), 'supabase-secret'],
    [['re_', 'a'.repeat(20)].join(''), 'resend-key'],
    [['eyJ', 'a'.repeat(24)].join(''), 'jwt'],
    ['A'.repeat(41), 'base64-run'],
  ]) {
    let message = null;
    try {
      assertRedacted({ notes: value }, 'test-record');
    } catch (err) {
      message = err.message;
    }
    assert.ok(message, `expected rejection for ${rule}`);
    assert.ok(message.includes(`[${rule}]`), `expected [${rule}] in "${message}"`);
    assert.ok(!message.includes(value), 'rejection message must not echo the matched content');
  }
});

test('assertRedacted rejects content-bearing keys at any depth', () => {
  assert.throws(
    () => assertRedacted({ meta: { inner: { cwd: 'anywhere' } } }),
    /\[forbidden-key\].*meta\.inner\.cwd/,
  );
});

test('sha256 hex does not false-positive the base64 rule', () => {
  const sha = 'b'.repeat(64);
  assert.doesNotThrow(() => assertRedacted({ rollback_hash: sha }));
});

test('foldLatestById keeps the superseding record', () => {
  const folded = foldLatestById([
    { proposal_id: 'p1', title: 'first' },
    { proposal_id: 'p2', title: 'other' },
    { proposal_id: 'p1', title: 'superseded' },
  ], 'proposal_id');
  assert.equal(folded.length, 2);
  assert.equal(folded.find((p) => p.proposal_id === 'p1').title, 'superseded');
});

test('status machine: draft cannot skip to approved', () => {
  assert.throws(() => validateStatusTransition('draft', 'approved'), /\[status-flow\]/);
  assert.equal(validateStatusTransition('draft', 'simulated'), true);
  assert.equal(validateStatusTransition('pending_approval', 'approved'), true);
  assert.equal(validateStatusTransition('approved', 'pending_approval'), true);
  assert.equal(validateStatusTransition('rejected', 'pending_approval'), true);
  assert.throws(() => validateStatusTransition('applied', 'pending_approval'), /\[status-flow\]/);
  assert.throws(() => validateStatusTransition('rejected', 'approved'), /\[status-flow\]/);
});

test('write choke point: assistant non-draft proposal cannot reach the ledger', () => {
  withTempLedger(() => {
    const proposals = JSON.parse(readFileSync(join(FIXTURES, 'golden-proposals.json'), 'utf8'));
    const forged = proposals.find((p) => p.expect_fail === 'assistant-status');
    assert.throws(() => appendRecord('proposal', forged.record), /\[assistant-status\]/);
    assert.equal(readLedger('proposal').length, 0, 'rejected record must not be written');
  });
});

test('write choke point: valid draft proposal round-trips', () => {
  withTempLedger(() => {
    const proposals = JSON.parse(readFileSync(join(FIXTURES, 'golden-proposals.json'), 'utf8'));
    const draft = proposals.find((p) => p.expect_fail === null);
    const stored = appendRecord('proposal', draft.record);
    const back = readLedger('proposal');
    assert.equal(back.length, 1);
    assert.equal(back[0].proposal_id, stored.proposal_id);
    assert.equal(back[0].status, 'draft');
  });
});

test('write choke point: fresh proposal cannot start at applied', () => {
  withTempLedger(() => {
    const proposal = validDraftProposal({ created_by: 'owner', status: 'applied' });
    assert.throws(() => appendRecord('proposal', proposal), /\[status-flow\]/);
    assert.equal(readLedger('proposal').length, 0);
  });
});

test('write choke point: draft cannot skip directly to applied', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    assert.throws(
      () => appendRecord('proposal', { ...draft, status: 'applied' }),
      /\[status-flow\]/,
    );
    assert.equal(readLedger('proposal').length, 1);
  });
});

test('write choke point: draft can advance to simulated', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    appendRecord('proposal', { ...draft, status: 'simulated' });
    const back = readLedger('proposal');
    assert.equal(back.length, 2);
    assert.equal(back[1].status, 'simulated');
  });
});

test('write choke point: draft can be superseded by another draft append', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    appendRecord('proposal', { ...draft, title: 'Superseded draft title' });
    const back = readLedger('proposal');
    assert.equal(back.length, 2);
    assert.equal(back[1].status, 'draft');
    assert.equal(back[1].title, 'Superseded draft title');
  });
});

test('write choke point: approved proposal can rewind to pending_approval', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'simulated' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'approved' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' });
    const back = readLedger('proposal');
    assert.equal(back.at(-1).status, 'pending_approval');
  });
});

test('write choke point: rejected proposal can rewind to pending_approval', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'simulated' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'rejected' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' });
    const back = readLedger('proposal');
    assert.equal(back.at(-1).status, 'pending_approval');
  });
});

test('write choke point: applied proposal cannot rewind to pending_approval', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'simulated' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'approved' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'applied' });
    assert.throws(
      () => appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' }),
      /\[status-flow\]/,
    );
  });
});

test('write choke point: rejected proposal cannot skip to approved', () => {
  withTempLedger(() => {
    const draft = validDraftProposal({ created_by: 'owner' });
    appendRecord('proposal', draft);
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'simulated' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'pending_approval' });
    appendRecord('proposal', { ...draft, created_by: 'owner', status: 'rejected' });
    assert.throws(
      () => appendRecord('proposal', { ...draft, created_by: 'owner', status: 'approved' }),
      /\[status-flow\]/,
    );
  });
});

test('assistant-authored proposals must stay drafts', () => {
  const proposals = JSON.parse(readFileSync(join(FIXTURES, 'golden-proposals.json'), 'utf8'));
  const forged = proposals.find((p) => p.expect_fail === 'assistant-status');
  assert.throws(() => validateProposal(forged.record), /\[assistant-status\]/);
});

test('review_only is required for gated target paths', () => {
  const proposal = validDraftProposal({
    created_by: 'owner',
    category: 'workflow',
    diff: { target_path: 'sync/com.meowops.localapi.plist' },
    review_only: false,
  });
  assert.throws(() => validateProposal(proposal), /\[review_only\]/);
});

test('capture: selection dedupes by session_id and metrics match hand-computed values', () => {
  const all = JSON.parse(readFileSync(join(FIXTURES, 'sessions-small.json'), 'utf8'));
  assert.equal(all.length, 5, 'fixture ships one duplicated session id');
  const picked = selectSessions(all, { since: '2026-07-01', until: '2026-07-01' });
  assert.equal(picked.length, 4, 'duplicate demo-dup collapses to one');
  const { metrics, sources } = summarize(picked);
  assert.deepEqual(sources, ['claude', 'codex']);
  assert.equal(metrics.sessions, 4);
  assert.equal(metrics.duration_seconds, 1000);
  assert.equal(metrics.total_tokens, 100000);
  assert.equal(metrics.cost_usd_real, 3.0);      // claude only
  assert.equal(metrics.cost_usd_notional, 2.0);  // codex only — never summed with real
  assert.equal(metrics.message_count, 100);
});

test('compareRuns reproduces the golden deltas and flags', () => {
  const pairs = JSON.parse(readFileSync(join(FIXTURES, 'golden-runs.json'), 'utf8'));
  for (const pair of pairs) {
    const { deltas, flags } = compareRuns(pair.baseline, pair.after);
    for (const [metric, expected] of Object.entries(pair.expected_delta_pct)) {
      assert.equal(deltas[metric].delta_pct, expected, `${pair.name}: ${metric}`);
    }
    assert.deepEqual(flags, [...pair.expected_flags].sort(), pair.name);
  }
});

test('capture aliases resolve explicit loop first, then longest correlation prefix', () => {
  withTempLedger((dir) => {
    writeFileSync(join(dir, 'aliases.json'), JSON.stringify({
      'branch:fix/': 'general-fix-loop',
      'branch:fix/qa-': 'patherle-qa',
    }, null, 2));
    assert.equal(
      resolveLoopId({ loop: 'explicit-loop', correlation: 'branch:fix/qa-123' }),
      'explicit-loop',
    );
    assert.equal(
      resolveLoopId({ loop: null, correlation: 'branch:fix/qa-123' }),
      'patherle-qa',
    );
    assert.equal(
      resolveLoopId({ loop: null, correlation: 'branch:fix/other' }),
      'general-fix-loop',
    );
    assert.throws(
      () => resolveLoopId({ loop: null, correlation: 'branch:feature/other' }),
      /--loop <loop_id> is required/,
    );
  });
});

test('capture aliases fail loud on malformed files', () => {
  withTempLedger((dir) => {
    writeFileSync(join(dir, 'aliases.json'), JSON.stringify([{ bad: 'shape' }]));
    assert.throws(() => readLoopAliases(), /\[aliases\]/);
  });
});
