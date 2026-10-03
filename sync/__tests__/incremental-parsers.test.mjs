import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexFile } from '../parse-codex.mjs';
import { parseClaudeFile, parseSessionLines } from '../parse-session.mjs';

const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const codexRows = [
  { type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { id: 'fixture', cwd: '/tmp/example' } },
  { type: 'turn_context', payload: { model: 'gpt-5' } },
  { type: 'event_msg', payload: { type: 'user_message', message: 'private fixture question' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'one' } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } } },
];
const claudeRows = [
  { type: 'user', sessionId: 'one', parentUuid: 'parent', timestamp: '2026-10-01T00:00:00Z', message: { content: 'private fixture question' } },
  { type: 'assistant', sessionId: 'one', timestamp: '2026-10-01T00:00:01Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'tool_use', name: 'Read' }] } },
];

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'meow-incremental-parser-'));
  const file = join(root, 'source.jsonl');
  const checkpointDir = join(root, 'cache');
  try { run({ root, file, checkpointDir }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('incremental Codex matches a full parse after cumulative tokens, duplicate tools and model changes', () => fixture(({ file, checkpointDir }) => {
  writeFileSync(file, jsonl(codexRows));
  assert.deepEqual(parseCodexFile(file, { checkpointDir }), parseCodexFile(file));
  appendFileSync(file, jsonl([
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'one' } },
    { type: 'response_item', payload: { type: 'message', role: 'user' } },
    { type: 'response_item', timestamp: '2026-10-01T00:01:00Z', payload: { type: 'message', role: 'assistant' } },
    { type: 'turn_context', payload: { model: 'gpt-4o' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 20, output_tokens: 30 } } } },
  ]));
  const incremental = parseCodexFile(file, { checkpointDir });
  assert.deepEqual(incremental, parseCodexFile(file));
  assert.equal(incremental.total_tokens, 180);
  assert.equal(incremental.tools.exec_command, 1);
  assert.equal(incremental.model, null);
}));

test('incremental Claude matches full aggregation and retains first-record hierarchy across appends', () => fixture(({ file, checkpointDir }) => {
  writeFileSync(file, jsonl(claudeRows));
  parseClaudeFile(file, 'example', { checkpointDir });
  appendFileSync(file, jsonl([
    { ...claudeRows[1], timestamp: '2026-10-01T00:02:00Z' },
    { ...claudeRows[0], sessionId: 'two', parentUuid: 'ignored-later-parent', timestamp: '2026-10-01T00:03:00Z' },
  ]));
  const incremental = parseClaudeFile(file, 'example', { checkpointDir });
  assert.deepEqual(incremental, parseSessionLines(readFileSync(file, 'utf8').trim().split('\n'), 'example'));
  assert.equal(incremental[0].total_tokens, 220);
  assert.equal(incremental[1].parent_session_id, 'parent');
}));

test('disabling snippets invalidates both parser caches and removes prior labels from their cache output', () => {
  const prior = process.env.MEOW_NO_SNIPPETS;
  try {
    for (const [rows, parse] of [[codexRows, parseCodexFile], [claudeRows, (file, options) => parseClaudeFile(file, 'example', options)]]) {
      fixture(({ file, checkpointDir }) => {
        delete process.env.MEOW_NO_SNIPPETS;
        writeFileSync(file, jsonl(rows));
        assert.match(JSON.stringify(parse(file, { checkpointDir })), /private fixture question/);
        process.env.MEOW_NO_SNIPPETS = '1';
        assert.doesNotMatch(JSON.stringify(parse(file, { checkpointDir })), /private fixture question/);
        for (const name of readdirSync(checkpointDir)) assert.doesNotMatch(readFileSync(join(checkpointDir, name), 'utf8'), /private fixture question/);
      });
    }
  } finally {
    if (prior === undefined) delete process.env.MEOW_NO_SNIPPETS;
    else process.env.MEOW_NO_SNIPPETS = prior;
  }
});

test('a moved file is safely reparsed with its new binding instead of reusing a stale path', () => fixture(({ root, file, checkpointDir }) => {
  writeFileSync(file, jsonl(codexRows));
  parseCodexFile(file, { checkpointDir });
  const moved = join(root, 'moved.jsonl');
  renameSync(file, moved);
  const coverage = [];
  const result = parseCodexFile(moved, { checkpointDir, onCoverage: report => coverage.push(report) });
  assert.equal(result.raw_ref, moved);
  assert.equal(coverage[0].mode, 'full');
}));
