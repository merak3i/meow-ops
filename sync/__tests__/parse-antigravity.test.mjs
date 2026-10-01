import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { antigravityCoverage, parseAntigravityTranscript, scanAntigravitySessions } from '../parse-antigravity.mjs';
import { databaseStepTime } from '../antigravity-database.mjs';

// Build a transcript.jsonl shaped like a real Antigravity brain log.
function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'ag-'));
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, file };
}

function timestampMetadata(time) {
  let value = BigInt(Date.parse(time) / 1000);
  const seconds = [];
  do {
    const byte = Number(value & 127n);
    value >>= 7n;
    seconds.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from([10, seconds.length + 1, 8, ...seconds]).toString('hex');
}

test('native scan recovers database steps missing from the readable log without writing the database', () => {
  const root = mkdtempSync(join(tmpdir(), 'ag-database-'));
  const logs = join(root, 'brain', 'example', '.system_generated', 'logs');
  mkdirSync(logs, { recursive: true });
  mkdirSync(join(root, 'conversations'));
  const file = join(root, 'conversations', 'example.db');
  writeFileSync(join(logs, 'transcript.jsonl'), JSON.stringify({
    step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT',
    created_at: '2026-06-08T10:00:00Z', content: 'private fixture',
  }) + '\n');
  appendFileSync(join(logs, 'transcript.jsonl'), JSON.stringify({
    step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT',
    created_at: '2026-06-08T10:00:00Z', content: 'private fixture updated',
  }) + '\n');
  execFileSync('sqlite3', [file, `CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB);
    INSERT INTO steps VALUES(0,14,X'${timestampMetadata('2026-06-08T10:00:00Z')}'),
    (1,8,X'${timestampMetadata('2026-06-08T10:00:05Z')}'),
    (2,15,X'${timestampMetadata('2026-06-08T10:00:20Z')}');`]);
  const modified = statSync(file).mtimeMs;
  try {
    const [session] = scanAntigravitySessions(root);
    assert.equal(session.message_count, 3);
    assert.equal(session.user_message_count, 1);
    assert.equal(session.assistant_message_count, 2);
    assert.equal(session.duration_seconds, 20);
    assert.equal(session.tools.Read, 1);
    assert.equal(session.sync_coverage.recovered_steps, 2);
    assert.equal(session.usage_available, false);
    assert.equal(session.model, null);
    assert.equal(statSync(file).mtimeMs, modified);
    assert.equal(antigravityCoverage(root, [session]).recovered_steps, 2);
    rmSync(join(root, 'brain'), { recursive: true, force: true });
    const [databaseOnly] = scanAntigravitySessions(root);
    assert.equal(databaseOnly.message_count, 3);
    assert.equal(databaseOnly.first_user_message, null);
    assert.equal(databaseOnly.raw_ref, file);
    writeFileSync(join(root, 'conversations', 'unreadable.pb'), 'opaque fixture');
    assert.equal(antigravityCoverage(root, [databaseOnly]).unreadable_stores, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('database timestamps reject truncated or unsupported metadata', () => {
  assert.equal(databaseStepTime('0a0b08'), null);
  assert.equal(databaseStepTime('invalid'), null);
  assert.equal(databaseStepTime('1000'), null);
  assert.equal(databaseStepTime(timestampMetadata('2026-06-08T10:00:00Z')), '2026-06-08T10:00:00.000Z');
});

test('parses time, tools, project, and snippet; usage is NOT fabricated', () => {
  const { dir, file } = writeTranscript([
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-06-08T10:00:00Z',
      content: '<USER_REQUEST>\nrefactor the auth module\n</USER_REQUEST>' },
    { step_index: 1, source: 'MODEL', type: 'VIEW_FILE', created_at: '2026-06-08T10:00:05Z',
      tool_calls: [{ name: 'view_file', args: { AbsolutePath: '"/Users/x/repos/myapp/src/auth.ts"' } }] },
    { step_index: 2, source: 'MODEL', type: 'RUN_COMMAND', created_at: '2026-06-08T10:01:00Z',
      tool_calls: [{ name: 'run_command', args: {} }] },
    { step_index: 3, source: 'MODEL', type: 'CODE_ACTION', created_at: '2026-06-08T10:02:00Z',
      tool_calls: [{ name: 'write_to_file', args: { AbsolutePath: '"/Users/x/repos/myapp/src/auth.ts"' } }] },
  ]);
  try {
    const s = parseAntigravityTranscript(file, 'abc-123');
    assert.ok(s);
    assert.equal(s.session_id, 'antigravity-abc-123');
    assert.equal(s.source, 'antigravity');
    // Time is real: 10:00:00 → 10:02:00 = 120s
    assert.equal(s.duration_seconds, 120);
    // Tools normalized to canonical buckets
    assert.equal(s.tools.Read, 1);
    assert.equal(s.tools.Bash, 1);
    assert.equal(s.tools.Write, 1);
    // Project derived from the most-referenced path
    assert.equal(s.project, 'myapp');
    assert.equal(s.first_user_message, 'refactor the auth module');
    // Usage is explicitly unavailable — never a fabricated number
    assert.equal(s.usage_available, false);
    assert.equal(s.estimated_cost_usd, 0);
    assert.equal(s.total_tokens, 0);
    assert.equal(s.model, null);
    assert.equal(s.pricing_source, 'unavailable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for an empty transcript', () => {
  const { dir, file } = writeTranscript([]);
  try {
    assert.equal(parseAntigravityTranscript(file, 'empty'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed transcript warnings do not expose the session identifier', () => {
  const { dir, file } = writeTranscript([
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-06-08T10:00:00Z', content: 'request' },
    { step_index: 1, source: 'MODEL', type: 'GENERIC', created_at: '2026-06-08T10:00:02Z' },
  ]);
  appendFileSync(file, '{malformed\n{"step_index":2,"source":"MODEL","type":"GENERIC","created_at":"2026-06-08T10:00:04Z"}\n');
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  try {
    const session = parseAntigravityTranscript(file, 'private-session-id');
    assert.ok(session);
    assert.equal(session.message_count, 3);
    assert.equal(session.assistant_message_count, 2);
    assert.equal(session.ended_at, '2026-06-08T10:00:04Z');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /skipped 1 malformed line/);
    assert.equal(warnings[0].includes('private-session-id'), false);
  } finally {
    console.warn = originalWarn;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MEOW_NO_SNIPPETS suppresses the captured prompt', () => {
  const prev = process.env.MEOW_NO_SNIPPETS;
  process.env.MEOW_NO_SNIPPETS = '1';
  const { dir, file } = writeTranscript([
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-06-08T10:00:00Z',
      content: '<USER_REQUEST>secret prompt</USER_REQUEST>' },
    { step_index: 1, source: 'MODEL', type: 'VIEW_FILE', created_at: '2026-06-08T10:00:05Z',
      tool_calls: [{ name: 'view_file', args: {} }] },
    { step_index: 2, source: 'MODEL', type: 'GENERIC', created_at: '2026-06-08T10:00:09Z' },
  ]);
  try {
    const s = parseAntigravityTranscript(file, 'no-snip');
    assert.equal(s.first_user_message, null);
    assert.equal(s.session_title, null);
  } finally {
    if (prev === undefined) delete process.env.MEOW_NO_SNIPPETS; else process.env.MEOW_NO_SNIPPETS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
