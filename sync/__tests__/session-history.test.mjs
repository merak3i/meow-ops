import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  querySessionHistory,
  readSessionHistory,
  updateSessionHistory,
} from '../session-history.mjs';

function fixture(id, overrides = {}) {
  return {
    session_id: id,
    project: 'meow-ops',
    source: 'codex',
    model: 'gpt-5',
    started_at: '2026-07-15T10:00:00.000Z',
    ended_at: '2026-07-15T11:00:00.000Z',
    total_tokens: 100,
    estimated_cost_usd: 1,
    duration_seconds: 3600,
    ...overrides,
  };
}

test('archive appends only new or changed revisions and never drops missing sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-history-'));
  try {
    const first = updateSessionHistory([fixture('a'), fixture('b')], {
      dir,
      updatedAt: '2026-07-16T00:00:00.000Z',
    });
    assert.equal(first.appended, 2);
    assert.equal(first.total, 2);

    const unchanged = updateSessionHistory([fixture('a'), fixture('b')], {
      dir,
      updatedAt: '2026-07-16T01:00:00.000Z',
    });
    assert.equal(unchanged.appended, 0);

    const changed = updateSessionHistory([fixture('a', { total_tokens: 250 })], {
      dir,
      updatedAt: '2026-07-16T02:00:00.000Z',
    });
    assert.equal(changed.appended, 1);
    assert.equal(changed.total, 2, 'session b remains retained when absent from a later scan');

    const revisions = readFileSync(join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(revisions.length, 3);
    const current = readSessionHistory({ dir });
    assert.equal(current.length, 2);
    assert.equal(current.find((row) => row.session_id === 'a').total_tokens, 250);
    assert.ok(current.some((row) => row.session_id === 'b'));

    unlinkSync(join(dir, 'current.json'));
    const recovered = readSessionHistory({ dir });
    assert.equal(recovered.length, 2, 'derived index can be rebuilt from the append-only log');
    assert.equal(recovered.find((row) => row.session_id === 'a').total_tokens, 250);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('query filters the complete archive before applying cursor pagination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-query-'));
  try {
    updateSessionHistory([
      fixture('a', { project: 'alpha', source: 'codex', model: 'gpt-5', ended_at: '2026-07-16T12:00:00Z' }),
      fixture('b', { project: 'alpha', source: 'claude', model: 'opus', ended_at: '2026-07-15T12:00:00Z' }),
      fixture('c', { project: 'beta', source: 'codex', model: 'gpt-5', ended_at: '2026-07-14T12:00:00Z' }),
    ], { dir });

    const first = querySessionHistory({ dir, limit: 1, project: 'alpha' });
    assert.equal(first.total, 2);
    assert.deepEqual(first.items.map((row) => row.session_id), ['a']);
    assert.ok(first.nextCursor);
    assert.deepEqual(first.facets.projects, ['alpha', 'beta']);

    const second = querySessionHistory({ dir, limit: 1, project: 'alpha', cursor: first.nextCursor });
    assert.deepEqual(second.items.map((row) => row.session_id), ['b']);
    assert.equal(second.nextCursor, null);

    const filtered = querySessionHistory({
      dir,
      source: 'codex',
      model: 'gpt-5',
      from: '2026-07-15',
      to: '2026-07-16',
    });
    assert.deepEqual(filtered.items.map((row) => row.session_id), ['a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cursor pagination remains stable when newer sessions arrive between pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-cursor-'));
  try {
    updateSessionHistory([
      fixture('a', { ended_at: '2026-07-16T12:00:00Z' }),
      fixture('b', { ended_at: '2026-07-15T12:00:00Z' }),
    ], { dir });
    const first = querySessionHistory({ dir, limit: 1 });
    assert.deepEqual(first.items.map((row) => row.session_id), ['a']);

    updateSessionHistory([
      fixture('new', { ended_at: '2026-07-17T12:00:00Z' }),
    ], { dir });
    const second = querySessionHistory({ dir, limit: 1, cursor: first.nextCursor });
    assert.deepEqual(second.items.map((row) => row.session_id), ['b']);
    assert.equal(second.total, 2, 'the cursor remains bound to the original archive snapshot');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cursor snapshot preserves ordering when an unseen session timestamp changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-snapshot-'));
  try {
    updateSessionHistory([
      fixture('a', { ended_at: '2026-07-16T12:00:00Z' }),
      fixture('b', { ended_at: '2026-07-15T12:00:00Z' }),
      fixture('c', { ended_at: '2026-07-14T12:00:00Z' }),
    ], { dir, updatedAt: '2026-07-16T13:00:00Z' });
    const first = querySessionHistory({ dir, limit: 1 });
    assert.deepEqual(first.items.map((row) => row.session_id), ['a']);

    updateSessionHistory([
      fixture('b', { ended_at: '2026-07-17T12:00:00Z' }),
    ], { dir, updatedAt: '2026-07-17T13:00:00Z' });
    const second = querySessionHistory({ dir, limit: 1, cursor: first.nextCursor });
    assert.deepEqual(second.items.map((row) => row.session_id), ['b']);
    assert.equal(second.total, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive rejects content-bearing fields, unsafe indexes, and worktree storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-privacy-'));
  try {
    for (const key of ['cwd', 'session_title', 'first_user_message']) {
      assert.throws(
        () => updateSessionHistory([fixture('unsafe', { metadata: { [key]: 'secret' } })], { dir }),
        /forbidden-key/,
      );
    }

    updateSessionHistory([fixture('safe')], { dir });
    writeFileSync(join(dir, 'current.json'), JSON.stringify({
      schemaVersion: 1,
      sessions: [fixture('unsafe-index', { metadata: { cwd: '/private/secret' } })],
    }));
    assert.deepEqual(readSessionHistory({ dir }).map((row) => row.session_id), ['safe']);
    assert.equal(statSync(join(dir, 'sessions.jsonl')).mode & 0o777, 0o600);

    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    assert.throws(() => updateSessionHistory([fixture('blocked')], {
      dir: join(repo, 'archive'),
    }), /worktree-guard/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('requested pages are bounded but archive retention is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-limit-'));
  try {
    updateSessionHistory(Array.from({ length: 650 }, (_, i) => fixture(String(i), {
      ended_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    })), { dir, warningThreshold: 100 });
    const result = querySessionHistory({ dir, limit: 100_000, warningThreshold: 100 });
    assert.equal(result.items.length, 500);
    assert.equal(result.archive.total, 650);
    assert.equal(result.archive.warningThreshold, 100);
    assert.equal(result.archive.thresholdExceeded, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
