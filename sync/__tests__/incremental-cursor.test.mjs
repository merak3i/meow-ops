import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCursorTranscript } from '../parse-cursor.mjs';

const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'meow-cursor-incremental-'));
  const file = join(root, 'conversation.jsonl');
  const checkpointDir = join(root, 'checkpoints');
  try { run({ file, checkpointDir }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('Cursor appends and partial lines match a full parse without rereading unchanged transcripts', () => fixture(({ file, checkpointDir }) => {
  const coverage = [];
  const options = { checkpointDir, parentComposerId: 'parent', projectSlug: 'fixture', onCoverage: report => coverage.push(report) };
  writeFileSync(file, jsonl([{ role: 'user', timestamp: '2026-10-03T00:00:00Z', content: 'private fixture question' }]));
  const first = parseCursorTranscript(file, options);
  assert.equal(first.parent_session_id, 'cursor-parent');
  assert.deepEqual(parseCursorTranscript(file, options), first);
  assert.equal(coverage.at(-1).mode, 'cached');
  assert.equal(coverage.at(-1).bytesRead, 0);
  const tail = JSON.stringify({ role: 'assistant', timestamp: '2026-10-03T00:01:00Z', content: [{ type: 'tool_use', name: 'read_file' }] }) + '\n';
  appendFileSync(file, tail.slice(0, 20));
  assert.equal(parseCursorTranscript(file, options).message_count, 1);
  assert.ok(coverage.at(-1).pendingBytes > 0);
  appendFileSync(file, tail.slice(20));
  const result = parseCursorTranscript(file, options);
  assert.deepEqual(result, parseCursorTranscript(file, { ...options, checkpointDir: undefined }));
  assert.equal(result.message_count, 2);
  assert.equal(result.tools.Read, 1);
  assert.equal(result.model, null);
  assert.equal(result.usage_available, false);
}));

test('Cursor cache invalidates when binding or snippet privacy changes', () => fixture(({ file, checkpointDir }) => {
  const prior = process.env.MEOW_NO_SNIPPETS;
  try {
    delete process.env.MEOW_NO_SNIPPETS;
    writeFileSync(file, jsonl([{ role: 'user', content: 'private fixture question' }]));
    assert.match(JSON.stringify(parseCursorTranscript(file, { checkpointDir })), /private fixture question/);
    const rebound = parseCursorTranscript(file, { checkpointDir, parentComposerId: 'new-parent', projectSlug: 'new-project' });
    assert.equal(rebound.parent_session_id, 'cursor-new-parent');
    process.env.MEOW_NO_SNIPPETS = '1';
    assert.equal(parseCursorTranscript(file, { checkpointDir }).session_title, null);
    for (const name of readdirSync(checkpointDir)) assert.doesNotMatch(readFileSync(join(checkpointDir, name), 'utf8'), /private fixture question/);
  } finally {
    if (prior === undefined) delete process.env.MEOW_NO_SNIPPETS;
    else process.env.MEOW_NO_SNIPPETS = prior;
  }
}));

test('timestamp-less Cursor appends refresh the filesystem fallback and unreadable sources report failure', () => fixture(({ file, checkpointDir }) => {
  writeFileSync(file, jsonl([{ role: 'user' }]));
  parseCursorTranscript(file, { checkpointDir, stat: statSync(file) });
  appendFileSync(file, jsonl([{ role: 'assistant' }]));
  const options = { checkpointDir, stat: statSync(file) };
  assert.deepEqual(parseCursorTranscript(file, options), parseCursorTranscript(file, { ...options, checkpointDir: undefined }));
  rmSync(file);
  const coverage = [];
  assert.equal(parseCursorTranscript(file, { checkpointDir, onCoverage: report => coverage.push(report) }), null);
  assert.equal(coverage[0].mode, 'failed');
}));
