import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDigest } from '../loop-digest.mjs';

const NOW = new Date('2026-07-07T12:00:00.000Z');
const errorSignatureKey = ['last_error', 'signature'].join('_');

function deps(overrides = {}) {
  const calls = { intake: 0, rules: [] };
  return {
    calls,
    deps: {
      readSessions: () => [{ session_id: 's1', ended_at: '2026-07-07T01:00:00.000Z', duration_seconds: 5, total_tokens: 10, message_count: 1 }],
      appendRun: (sessions) => ({ run_id: 'run_1', metrics: { sessions: sessions.length } }),
      runIntake: async () => {
        calls.intake += 1;
        return { processed: 2, stored: 1, dropped: 0, skipped: 1 };
      },
      runAutomationHealth: async () => ({
        agents: [
          { label: 'agent.one', running: false, last_exit_status: 1, log_staleness_hours: 30, [errorSignatureKey]: 'hidden', flags: ['failed'] },
          { label: 'agent.two', running: true, last_exit_status: 0, log_staleness_hours: 1, [errorSignatureKey]: null, flags: [] },
        ],
      }),
      runAllRules: async (opts) => {
        calls.rules.push(opts);
        return { proposals: [{ proposal_id: 'prop_new' }] };
      },
      readProposals: () => [{ proposal_id: 'prop_new', status: 'pending_approval' }, { proposal_id: 'prop_old', status: 'draft' }],
      writeDigest: (path, digest) => {
        calls.path = path;
        calls.digest = digest;
      },
      appendDigestHistory: (dir, digest) => {
        calls.historyDir = dir;
        calls.historyDigest = digest;
      },
      ...overrides,
    },
  };
}

test('digest assembles correct shape', async () => {
  const fixture = deps();
  const digest = await runDigest({ repoRoot: '/repo', now: NOW, deps: fixture.deps });
  assert.equal(digest.generated_at, NOW.toISOString());
  assert.deepEqual(Object.keys(digest).filter((key) => key !== 'notes').sort(), ['capture', 'generated_at', 'health', 'intake', 'period', 'proposals']);
  assert.deepEqual(digest.capture, { run_id: 'run_1', sessions: 1 });
  assert.deepEqual(digest.intake, { processed: 2, stored: 1, dropped: 0, skipped: 1 });
  assert.deepEqual(digest.health, {
    agents_total: 2,
    flagged: 1,
    flags: ['failed'],
    agents: [
      { label: 'agent.one', running: false, last_exit_status: 1, log_staleness_hours: 30, flags: ['failed'] },
      { label: 'agent.two', running: true, last_exit_status: 0, log_staleness_hours: 1, flags: [] },
    ],
  });
  assert.equal(digest.health.agents.some((agent) => errorSignatureKey in agent), false);
  assert.deepEqual(digest.proposals, { new_drafts: 1, pending: 1, total: 2 });
});

test('--no-intake skips intake', async () => {
  const fixture = deps();
  const digest = await runDigest({ repoRoot: '/repo', now: NOW, noIntake: true, deps: fixture.deps });
  assert.equal(fixture.calls.intake, 0);
  assert.deepEqual(digest.intake, { processed: 0, stored: 0, dropped: 0, skipped: 0 });
});

test('--no-ai calls runAllRules with ai false', async () => {
  const fixture = deps();
  await runDigest({ repoRoot: '/repo', now: NOW, noAi: true, deps: fixture.deps });
  assert.equal(fixture.calls.rules[0].ai, false);
});

test('digest file is written under public/data/loop-engineering', async () => {
  const fixture = deps();
  await runDigest({ repoRoot: '/repo', now: NOW, deps: fixture.deps });
  assert.equal(fixture.calls.path, '/repo/public/data/loop-engineering/digest.json');
});

test('digest history appends one JSON line per run', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'meow-digest-history-'));
  try {
    const fixture = deps({ writeDigest: undefined, appendDigestHistory: undefined });
    const first = await runDigest({ repoRoot, now: NOW, deps: fixture.deps });
    const second = await runDigest({
      repoRoot,
      now: new Date('2026-07-08T12:00:00.000Z'),
      deps: fixture.deps,
    });
    const lines = readFileSync(join(repoRoot, 'public', 'data', 'loop-engineering', 'digest-history.jsonl'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [first, second]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
