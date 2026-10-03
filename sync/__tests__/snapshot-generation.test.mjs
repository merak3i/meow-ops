import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishSnapshot, readSnapshot } from '../snapshot-generation.mjs';

function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-generation-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const rows = [{ session_id: 'one', source: 'codex' }];
const summary = { archive: { total: 1 }, allTime: { sessions: 1 }, sourceHealth: { codex: { state: 'collected' } } };

test('publishes sessions and totals as one validated immutable generation', () => fixture(dir => {
  const manifest = publishSnapshot(dir, { sessions: rows, summary });
  const result = readSnapshot(dir);
  assert.equal(result.generation.id, manifest.current.id);
  assert.deepEqual(result.sessions, rows);
  assert.deepEqual(result.summary, summary);
  assert.equal(result.lastGood, false);
  assert.equal(result.generation.scope, 'local-archive');
}));

test('interruption before pointer promotion leaves the previous generation readable', () => fixture(dir => {
  const first = publishSnapshot(dir, { sessions: rows, summary });
  assert.throws(() => publishSnapshot(dir, { sessions: [], summary: { archive: { total: 0 }, allTime: { sessions: 0 } } }, {
    beforePromote() { throw new Error('simulated disk full'); },
  }), /disk full/);
  assert.equal(readSnapshot(dir).generation.id, first.current.id);
  assert.deepEqual(readSnapshot(dir).sessions, rows);
}));

test('corrupt current payload falls back to the last validated generation with a warning', () => fixture(dir => {
  const first = publishSnapshot(dir, { sessions: rows, summary });
  const second = publishSnapshot(dir, { sessions: rows, summary });
  writeFileSync(join(dir, 'generations', `${second.current.id}.json`), '{}');
  const result = readSnapshot(dir);
  assert.equal(result.generation.id, first.current.id);
  assert.equal(result.lastGood, true);
  assert.equal(result.warning, 'current-generation-invalid');
}));

test('a damaged or missing manifest preserves the independently saved last good pointer', () => fixture(dir => {
  const first = publishSnapshot(dir, { sessions: rows, summary });
  publishSnapshot(dir, { sessions: rows, summary });
  writeFileSync(join(dir, 'snapshot-manifest.json'), '{torn pointer');
  let result = readSnapshot(dir);
  assert.equal(result.generation.id, first.current.id);
  assert.equal(result.lastGood, true);
  rmSync(join(dir, 'snapshot-manifest.json'));
  result = readSnapshot(dir);
  assert.equal(result.generation.id, first.current.id);
  const recovered = publishSnapshot(dir, { sessions: rows, summary });
  assert.equal(recovered.previous.id, first.current.id);
}));

test('invalid exports cannot advance the pointer; traversal identifiers are rejected', () => fixture(dir => {
  publishSnapshot(dir, { sessions: rows, summary });
  const before = readFileSync(join(dir, 'snapshot-manifest.json'), 'utf8');
  for (const sessions of [{}, [null], [{ source: 'codex' }], [...rows, ...rows]]) {
    assert.throws(() => publishSnapshot(dir, { sessions, summary }), /Invalid snapshot/);
  }
  assert.throws(() => publishSnapshot(dir, { sessions: rows, summary: { archive: { total: 0 } } }), /Invalid snapshot/);
  assert.equal(readFileSync(join(dir, 'snapshot-manifest.json'), 'utf8'), before);
  writeFileSync(join(dir, 'snapshot-manifest.json'), JSON.stringify({ schemaVersion: 1, current: { id: '../../outside', sha256: 'a'.repeat(64) } }));
  assert.equal(readSnapshot(dir).lastGood, true);
  rmSync(join(dir, 'snapshot-manifest.previous.json'));
  assert.throws(() => readSnapshot(dir), /No valid snapshot/);
}));
