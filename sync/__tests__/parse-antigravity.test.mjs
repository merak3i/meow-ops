import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAntigravityTranscript } from '../parse-antigravity.mjs';

// Build a transcript.jsonl shaped like a real Antigravity brain log.
function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'ag-'));
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, file };
}

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
