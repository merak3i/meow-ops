import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { parseCursorTranscript, scanCursorSessions } from '../parse-cursor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECTS = join(HERE, '..', '__fixtures__', 'cursor', 'projects');
const PARENT_ID = '11111111-1111-4111-8111-111111111111';
const SUB_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_FILE = join(
  PROJECTS,
  'demo-app',
  'agent-transcripts',
  PARENT_ID,
  `${PARENT_ID}.jsonl`,
);

test('parses parent and subagent transcripts without fabricating usage', () => {
  const sessions = scanCursorSessions(PROJECTS);
  const parent = sessions.find((session) => session.composer_id === PARENT_ID);
  const sub = sessions.find((session) => session.composer_id === SUB_ID);

  assert.ok(parent, 'expected parent session');
  assert.ok(sub, 'expected subagent session');
  assert.equal(parent.source, 'cursor');
  assert.equal(parent.is_subagent, false);
  assert.equal(parent.entrypoint, 'cursor');
  assert.equal(sub.is_subagent, true);
  assert.equal(sub.parent_session_id, `cursor-${PARENT_ID}`);
  assert.equal(parent.tools.Read, 1);
  assert.equal(parent.tools.Agent, 1);
  assert.equal(sub.tools.Grep, 1);
  assert.equal(parent.first_user_message, 'Refactor the login form validation.');

  for (const session of [parent, sub]) {
    assert.equal(session.model, null);
    assert.equal(session.usage_available, false);
    assert.equal(session.pricing_source, 'unavailable');
    assert.equal(session.total_tokens, 0);
    assert.equal(session.estimated_cost_usd, 0);
  }
});

test('never treats a nested Task model argument as the parent model', () => {
  const session = parseCursorTranscript(PARENT_FILE, { composerId: PARENT_ID, projectSlug: 'demo-app' });
  assert.ok(session);
  assert.equal(session.model, null);
  assert.notEqual(session.model, 'fast');
  assert.notEqual(session.model, 'gpt-4o');
});

test('returns null for an empty transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-empty-'));
  const file = join(dir, 'empty.jsonl');
  writeFileSync(file, '');
  try {
    assert.equal(parseCursorTranscript(file, { composerId: 'empty' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips malformed lines and still counts tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-bad-'));
  const file = join(dir, 'aaaaaaa1-1111-4111-8111-111111111111.jsonl');
  writeFileSync(file, [
    '{not-json',
    JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: 'List files' }] },
      createdAt: '2026-08-02T12:00:00.000Z',
    }),
    JSON.stringify({
      role: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Glob', input: { glob: '*' } }] },
      createdAt: '2026-08-02T12:00:05.000Z',
    }),
  ].join('\n'));
  try {
    const session = parseCursorTranscript(file);
    assert.ok(session);
    assert.equal(session.tools.Glob, 1);
    assert.equal(session.message_count, 2);
    assert.equal(session.model, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanCursorSessions no-ops on a missing directory', () => {
  assert.deepEqual(scanCursorSessions(join(tmpdir(), 'cursor-missing-does-not-exist')), []);
});

test('MEOW_NO_SNIPPETS suppresses captured prompt text', () => {
  const prev = process.env.MEOW_NO_SNIPPETS;
  process.env.MEOW_NO_SNIPPETS = '1';
  const dir = mkdtempSync(join(tmpdir(), 'cursor-snip-'));
  mkdirSync(join(dir, 'agent-transcripts'), { recursive: true });
  const file = join(dir, 'agent-transcripts', 'bbbbbbb1-1111-4111-8111-111111111111.jsonl');
  writeFileSync(file, `${JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: 'secret prompt' }] },
    createdAt: '2026-08-02T12:00:00.000Z',
  })}\n`);
  try {
    const [session] = scanCursorSessions(dir);
    assert.equal(session.first_user_message, null);
    assert.equal(session.session_title, null);
  } finally {
    if (prev === undefined) delete process.env.MEOW_NO_SNIPPETS;
    else process.env.MEOW_NO_SNIPPETS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
