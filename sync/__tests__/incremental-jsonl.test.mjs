import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJsonlWithCheckpoint } from '../incremental-jsonl.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'meow-jsonl-checkpoint-'));
  const file = join(root, 'source.jsonl');
  const checkpointDir = join(root, 'cache');
  const coverage = [];
  const read = (version = 'test-v1') => readJsonlWithCheckpoint(file, {
    checkpointDir, version, createState: () => ({ count: 0, text: '' }),
    reduceEntry: (state, row) => { state.count++; state.text += row.text || ''; },
    finish: state => ({ ...state }), onCoverage: report => coverage.push(report),
  });
  try { run({ root, file, checkpointDir, coverage, read }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('unchanged files reuse a private checkpoint and appended lines process only new bytes', () => fixture(({ file, checkpointDir, coverage, read }) => {
  writeFileSync(file, '{"text":"one"}\n');
  assert.deepEqual(read(), { count: 1, text: 'one' });
  assert.deepEqual(read(), { count: 1, text: 'one' });
  assert.equal(coverage.at(-1).mode, 'cached');
  assert.equal(coverage.at(-1).bytesRead, 0);
  appendFileSync(file, '{"text":"two"}\n');
  assert.deepEqual(read(), { count: 2, text: 'onetwo' });
  assert.equal(coverage.at(-1).mode, 'incremental');
  assert.equal(coverage.at(-1).parsedBytes, Buffer.byteLength('{"text":"two"}\n'));
  assert.equal(coverage.at(-1).bytesRead, statSync(file).size);
  assert.equal(statSync(checkpointDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(checkpointDir, readdirSync(checkpointDir)[0])).mode & 0o777, 0o600);
}));

test('a growing source rewritten in the middle rebuilds instead of retaining stale records', () => fixture(({ file, coverage, read }) => {
  const lines = Array.from({ length: 2000 }, () => '{"text":"a"}\n');
  writeFileSync(file, lines.join(''));
  assert.equal(read().text, 'a'.repeat(2000));
  // Same inode, same first and last 4096 old bytes, different middle, and growth.
  lines[1000] = '{"text":"b"}\n';
  writeFileSync(file, lines.join('') + '{"text":"c"}\n');
  assert.deepEqual(read(), { count: 2001, text: 'a'.repeat(1000) + 'b' + 'a'.repeat(999) + 'c' });
  assert.equal(coverage.at(-1).mode, 'full');
  assert.equal(coverage.at(-1).parsedBytes, statSync(file).size);
  read();
  assert.equal(coverage.at(-1).mode, 'cached');
  assert.equal(coverage.at(-1).bytesRead, 0);
}));

test('prefix verification stays correct across read buffers and an uncommitted tail', () => fixture(({ file, coverage, read }) => {
  const largeText = 'a'.repeat((1 << 20) + 31);
  writeFileSync(file, JSON.stringify({ text: largeText }) + '\n{"text":"tail');
  assert.deepEqual(read(), { count: 1, text: largeText });
  appendFileSync(file, '"}\n');
  assert.deepEqual(read(), { count: 2, text: largeText + 'tail' });
  assert.equal(coverage.at(-1).mode, 'incremental');
  assert.equal(coverage.at(-1).parsedBytes, Buffer.byteLength('{"text":"tail"}\n'));
  assert.equal(coverage.at(-1).bytesRead, statSync(file).size);
}));

test('legacy sampled checkpoints rebuild once before using the unchanged-file fast path', () => fixture(({ file, checkpointDir, coverage, read }) => {
  writeFileSync(file, '{"text":"current"}\n');
  read();
  const cacheFile = join(checkpointDir, readdirSync(checkpointDir)[0]);
  const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
  const legacy = {
    version: saved.version, file: saved.file, offset: saved.offset,
    fingerprint: 'sampled-prefix-and-tail', state: saved.state,
    output: { count: 99, text: 'stale' }, coverage: saved.coverage,
  };
  const digest = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
  writeFileSync(cacheFile, JSON.stringify({ ...legacy, digest }));
  assert.deepEqual(read(), { count: 1, text: 'current' });
  assert.equal(coverage.at(-1).mode, 'full');
  read();
  assert.equal(coverage.at(-1).mode, 'cached');
  assert.equal(coverage.at(-1).bytesRead, 0);
}));

test('partial lines and split UTF-8 bytes resume without loss or double counting', () => fixture(({ file, coverage, read }) => {
  const row = Buffer.from('{"text":"cat🐈"}\n');
  writeFileSync(file, row.subarray(0, row.length - 4));
  assert.deepEqual(read(), { count: 0, text: '' });
  assert.ok(coverage.at(-1).pendingBytes > 0);
  appendFileSync(file, row.subarray(row.length - 4));
  assert.deepEqual(read(), { count: 1, text: 'cat🐈' });
  assert.equal(coverage.at(-1).pendingBytes, 0);
  appendFileSync(file, '{"text":"tail"}');
  assert.deepEqual(read(), { count: 2, text: 'cat🐈tail' });
  appendFileSync(file, '\n');
  assert.deepEqual(read(), { count: 2, text: 'cat🐈tail' });
}));

test('shrink, replacement, same-size edits, config changes and corrupt checkpoints rebuild safely', () => fixture(({ file, root, checkpointDir, coverage, read }) => {
  writeFileSync(file, '{"text":"original"}\n');
  read();
  writeFileSync(file, '{"text":"new"}\n');
  assert.deepEqual(read(), { count: 1, text: 'new' });
  assert.equal(coverage.at(-1).mode, 'full');
  const replacement = join(root, 'replacement');
  writeFileSync(replacement, '{"text":"alt"}\n');
  renameSync(replacement, file);
  assert.deepEqual(read(), { count: 1, text: 'alt' });
  writeFileSync(file, '{"text":"mod"}\n');
  assert.deepEqual(read(), { count: 1, text: 'mod' });
  read('changed-config');
  assert.equal(coverage.at(-1).mode, 'full');
  const cacheFile = join(checkpointDir, readdirSync(checkpointDir)[0]);
  writeFileSync(cacheFile, '{bad');
  assert.deepEqual(read('changed-config'), { count: 1, text: 'mod' });
  assert.equal(coverage.at(-1).mode, 'full');
  const damaged = JSON.parse(readFileSync(cacheFile, 'utf8'));
  damaged.output.count = 999;
  writeFileSync(cacheFile, JSON.stringify(damaged));
  assert.deepEqual(read('changed-config'), { count: 1, text: 'mod' });
  assert.equal(coverage.at(-1).mode, 'full');
}));

test('coverage counts malformed committed rows without exposing content and errors are sanitized', () => fixture(({ file, coverage, read }) => {
  writeFileSync(file, '{private broken line}\n{"text":"ok"}\n');
  assert.deepEqual(read(), { count: 1, text: 'ok' });
  assert.equal(coverage.at(-1).malformedLines, 1);
  assert.doesNotMatch(JSON.stringify(coverage), /private broken|source\.jsonl/);
  rmSync(file);
  assert.throws(() => read(), error => error.code === 'source_read_failed' && !error.message.includes(file));
  assert.equal(coverage.at(-1).stage, 'stat');
}));
