import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  querySessionHistory,
  readSessionHistory,
  readSessionHistorySnapshot,
  recoverIncompleteSessionHistory,
  updateSessionHistory,
} from '../session-history.mjs';
import { publishSnapshot, readSnapshot } from '../snapshot-generation.mjs';

test('published generation survives later revisions and a damaged unpublished tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-published-history-'));
  try {
    updateSessionHistory([fixture('a'), fixture('b')], { dir });
    const before = readSessionHistorySnapshot({ dir });
    const dataDir = join(dir, 'data');
    publishSnapshot(dataDir, { sessions: before.sessions, summary: {
      allTime: { sessions: 2 }, archive: { total: 2, version: before.archiveVersion, snapshotBytes: before.snapshotBytes },
    } });
    updateSessionHistory([fixture('new'), fixture('a', { total_tokens: 999 })], { dir });
    appendFileSync(join(dir, 'sessions.jsonl'), '{invalid unpublished revision}\n');
    const snapshot = readSnapshot(dataDir);
    const scope = { dir, expectedVersion: snapshot.summary.archive.version, snapshotBytes: snapshot.summary.archive.snapshotBytes, limit: 1 };
    const page = querySessionHistory(scope);
    const next = querySessionHistory({ ...scope, cursor: page.nextCursor });
    assert.equal(page.total, snapshot.summary.allTime.sessions);
    assert.equal(page.items[0].total_tokens, 100);
    assert.deepEqual([...page.items, ...next.items].map(row => row.session_id), ['a', 'b']);
    assert.equal(page.archiveVersion, before.archiveVersion);
    assert.throws(() => querySessionHistory({ ...scope, snapshotBytes: before.snapshotBytes - 1 }), { code: 'stale_archive_snapshot' });
    assert.throws(() => querySessionHistory({ dir, snapshotBytes: 0 }), { code: 'invalid_archive_snapshot' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
    for (const key of ['cwd', 'raw_ref', 'session_title', 'first_user_message']) {
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

    const linkedRepo = join(dir, 'repo-link');
    symlinkSync(repo, linkedRepo, 'dir');
    assert.throws(() => updateSessionHistory([fixture('linked-blocked')], {
      dir: join(linkedRepo, 'archive'),
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

test('replays committed revisions after an interrupted index publication without writing on read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-recovery-'));
  try {
    updateSessionHistory([fixture('a')], { dir, updatedAt: '2026-07-16T00:00:00Z' });
    const indexBefore = readFileSync(join(dir, 'current.json'), 'utf8');
    appendFileSync(join(dir, 'sessions.jsonl'), JSON.stringify({
      archived_at: '2026-07-17T00:00:00Z', session: fixture('recovered'),
    }) + '\n');
    const snapshot = readSessionHistorySnapshot({ dir });
    assert.equal(snapshot.sessions.length, 2);
    assert.equal(snapshot.updatedAt, '2026-07-17T00:00:00Z');
    assert.equal(readFileSync(join(dir, 'current.json'), 'utf8'), indexBefore);

    updateSessionHistory([fixture('new')], { dir });
    assert.deepEqual(readSessionHistory({ dir }).map(row => row.session_id).sort(), ['a', 'new', 'recovered']);
    unlinkSync(join(dir, 'current.json'));
    assert.equal(readSessionHistory({ dir }).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an incomplete append preserves the last committed snapshot and blocks further writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-torn-tail-'));
  try {
    updateSessionHistory([fixture('a'), fixture('b')], { dir });
    const log = join(dir, 'sessions.jsonl');
    appendFileSync(log, '{"archived_at":"incomplete');
    const before = readFileSync(log);
    const first = querySessionHistory({ dir, limit: 1 });
    assert.equal(first.total, 2);
    assert.equal(first.archive.incompleteTailBytes, Buffer.byteLength('{"archived_at":"incomplete'));
    assert.equal(querySessionHistory({ dir, limit: 1, cursor: first.nextCursor }).total, 2);
    assert.throws(() => updateSessionHistory([fixture('c')], { dir }), /incomplete append/);
    assert.deepEqual(readFileSync(log), before);
    unlinkSync(join(dir, 'current.json'));
    assert.equal(readSessionHistory({ dir }).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recovery saves torn bytes before resuming the append log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-recover-tail-'));
  try {
    updateSessionHistory([fixture('a')], { dir });
    const log = join(dir, 'sessions.jsonl');
    const torn = Buffer.from('{"archived_at":"private-incomplete');
    appendFileSync(log, torn);
    const repaired = recoverIncompleteSessionHistory({ dir });
    assert.equal(repaired.recovered, true);
    assert.equal(repaired.bytes, torn.length);
    assert.deepEqual(readFileSync(repaired.recoveryFile), torn);
    assert.equal(querySessionHistory({ dir }).archive.incompleteTailBytes, 0);
    updateSessionHistory([fixture('b')], { dir });
    assert.deepEqual(readSessionHistory({ dir }).map(row => row.session_id).sort(), ['a', 'b']);
    assert.equal(readdirSync(join(dir, 'recovery')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('automatic recovery refuses hard-linked logs and preserves oversized torn bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-recover-guard-'));
  const history = join(dir, 'history');
  const linked = join(dir, 'linked.jsonl');
  try {
    mkdirSync(history);
    updateSessionHistory([fixture('a')], { dir: history });
    const log = join(history, 'sessions.jsonl');
    appendFileSync(log, 'torn');
    linkSync(log, linked);
    const before = readFileSync(log);
    assert.throws(() => recoverIncompleteSessionHistory({ dir: history }), /linked archive log/);
    assert.deepEqual(readFileSync(log), before);
    unlinkSync(linked);
    appendFileSync(log, 'x'.repeat(16));
    const large = readFileSync(log);
    assert.throws(() => recoverIncompleteSessionHistory({ dir: history, maxBytes: 12 }), /recovery limit/);
    assert.deepEqual(readFileSync(log), large);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed committed revisions and log truncation fail closed instead of losing history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-corruption-'));
  try {
    updateSessionHistory([fixture('a')], { dir });
    const log = join(dir, 'sessions.jsonl');
    const before = readFileSync(log);
    appendFileSync(log, '{broken}\n');
    assert.throws(() => readSessionHistory({ dir }), /invalid revision/);
    assert.throws(() => updateSessionHistory([fixture('b')], { dir }), /invalid revision/);
    writeFileSync(log, before.subarray(0, before.length - 1));
    assert.throws(() => readSessionHistory({ dir }), /shorter than/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive version guards a frozen pagination snapshot and rejects a changed restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-version-'));
  try {
    updateSessionHistory([fixture('a'), fixture('b')], { dir, updatedAt: '2026-07-16T00:00:00Z' });
    const first = querySessionHistory({ dir, limit: 1 });
    assert.match(first.archiveVersion, /^[a-f0-9]{64}$/);
    assert.equal(readSessionHistorySnapshot({ dir }).archiveVersion, first.archiveVersion);
    assert.equal(readSessionHistorySnapshot({ dir }).snapshotBytes, statSync(join(dir, 'sessions.jsonl')).size);
    updateSessionHistory([fixture('a'), fixture('b')], { dir, updatedAt: '2026-07-17T00:00:00Z' });
    assert.equal(querySessionHistory({ dir }).archiveVersion, first.archiveVersion, 'a no-change sync keeps its version');
    updateSessionHistory([fixture('new')], { dir });
    const second = querySessionHistory({ dir, limit: 1, cursor: first.nextCursor, expectedVersion: first.archiveVersion });
    assert.equal(second.total, 2);
    assert.equal(second.archiveVersion, first.archiveVersion);
    assert.throws(() => querySessionHistory({ dir, expectedVersion: first.archiveVersion }), {
      code: 'stale_archive_snapshot',
    });
    assert.throws(() => querySessionHistory({ dir, cursor: 'malformed' }), {
      code: 'invalid_session_cursor',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same native ID from different harnesses remains two identities through replay and pagination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-source-identity-'));
  try {
    updateSessionHistory([
      fixture('same-id', { source: 'claude' }),
      fixture('same-id', { source: 'codex' }),
    ], { dir });
    const first = querySessionHistory({ dir, limit: 1 });
    assert.equal(first.total, 2);
    const second = querySessionHistory({ dir, limit: 1, cursor: first.nextCursor, expectedVersion: first.archiveVersion });
    assert.deepEqual([...first.items, ...second.items].map(row => row.source), ['claude', 'codex']);
    unlinkSync(join(dir, 'current.json'));
    assert.equal(readSessionHistory({ dir }).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy indexes rebuild source identities from the log but still detect truncation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-legacy-identity-'));
  try {
    updateSessionHistory([fixture('same-id', { source: 'claude' }), fixture('same-id', { source: 'codex' })], { dir });
    const indexFile = join(dir, 'current.json');
    const index = JSON.parse(readFileSync(indexFile, 'utf8'));
    index.schemaVersion = 1;
    index.sessions = index.sessions.slice(0, 1);
    writeFileSync(indexFile, JSON.stringify(index));
    assert.equal(readSessionHistory({ dir }).length, 2);
    const logFile = join(dir, 'sessions.jsonl');
    writeFileSync(logFile, readFileSync(logFile).subarray(0, index.logBytes - 1));
    assert.throws(() => readSessionHistory({ dir }), /shorter than/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
