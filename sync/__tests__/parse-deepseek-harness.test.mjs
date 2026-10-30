import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseDeepSeekFile } from '../parse-deepseek-harness.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'deepseek', 'synthetic-session.jsonl');

test('synthetic DeepSeek event stream becomes a canonical session without retaining message content', () => {
  const session = parseDeepSeekFile(FIXTURE, { sessionId: 'fixture-session' });

  assert.ok(session);
  assert.equal(session.session_id, 'fixture-session');
  assert.equal(session.source, 'deepseek');
  assert.equal(session.project, 'deepseek-harness');
  assert.equal(session.model, null);
  assert.equal(session.started_at, '2026-01-01T00:00:00.000Z');
  assert.equal(session.ended_at, '2026-01-01T00:00:05.000Z');
  assert.equal(session.duration_seconds, 5);
  assert.equal(session.user_message_count, 1);
  assert.equal(session.assistant_message_count, 1);
  assert.equal(session.message_count, 2);
  assert.equal(session.input_tokens, 1000);
  assert.equal(session.output_tokens, 200);
  assert.equal(session.cache_read_tokens, 100);
  assert.equal(session.cache_creation_tokens, 20);
  assert.equal(session.total_tokens, 1320);
  assert.deepEqual(session.tools, { synthetic_tool: 1 });
  assert.equal(session.estimated_cost_usd, null);
  assert.equal(session.pricing_source, 'unavailable');
  assert.doesNotMatch(JSON.stringify(session), /fixture-assistant/);
});

test('DeepSeek JSONL checkpoints match a fresh parse after appended messages', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-deepseek-parser-'));
  const file = join(root, 'source.jsonl');
  const checkpointDir = join(root, 'checkpoints');
  try {
    writeFileSync(file, readFileSync(FIXTURE, 'utf8'));
    parseDeepSeekFile(file, { sessionId: 'fixture-session', checkpointDir });
    const appended = {
      type: 'assistant/message',
      data: {
        model: 'deepseek-chat',
        message: { id: 'fixture-assistant-2', role: 'assistant', content: [] },
        usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
      },
    };
    appendFileSync(file, `${JSON.stringify(appended)}\n`);

    const incremental = parseDeepSeekFile(file, { sessionId: 'fixture-session', checkpointDir });
    const full = parseDeepSeekFile(file, { sessionId: 'fixture-session' });
    assert.deepEqual(incremental, full);
    assert.equal(incremental.assistant_message_count, 2);
    assert.equal(incremental.input_tokens, 1500);
    assert.equal(incremental.output_tokens, 250);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown DeepSeek model names do not receive a guessed price', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-deepseek-model-'));
  const file = join(root, 'source.jsonl');
  try {
    writeFileSync(file, `${JSON.stringify({ type: 'assistant/message', data: { model: 'deepseek-reasoner', message: { role: 'assistant', content: [] }, usage: { inputTokens: 100, outputTokens: 10 } } })}\n`);
    const session = parseDeepSeekFile(file, { sessionId: 'fixture-reasoner' });
    assert.ok(session);
    assert.equal(session.model, 'deepseek-reasoner');
    assert.equal(session.estimated_cost_usd, null);
    assert.equal(session.pricing_source, 'unknown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('DeepSeek exact model keys use only the matching price row', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-deepseek-exact-model-'));
  const file = join(root, 'source.jsonl');
  try {
    const row = {
      type: 'assistant/message',
      data: {
        model: 'deepseek-chat',
        message: { role: 'assistant', content: [] },
        usage: { inputTokens: 1000, outputTokens: 200 },
      },
    };
    writeFileSync(file, `${JSON.stringify(row)}\n`);
    const session = parseDeepSeekFile(file, { sessionId: 'fixture-chat' });
    assert.ok(session);
    assert.equal(session.model, 'deepseek-chat');
    assert.equal(session.estimated_cost_usd, 0.00049);
    assert.equal(session.pricing_source, 'exact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a session that switches models keeps every model and picks the dominant one', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { scanDeepSeekSessions } = await import('../parse-deepseek-harness.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'meow-ds-models-'));
  try {
    const lines = [
      { type: 'user/message', time: 1793300000, data: { message: { role: 'user' } } },
      { type: 'assistant/message', time: 1793300010, data: { model: 'deepseek-v4-flash', usage: { inputTokens: 5, outputTokens: 2 }, message: { role: 'assistant' } } },
      { type: 'assistant/message', time: 1793300020, data: { model: 'kimi-k3', usage: { inputTokens: 5, outputTokens: 2 }, message: { role: 'assistant' } } },
      { type: 'assistant/message', time: 1793300030, data: { response: { model: 'kimi-k3' }, usage: { inputTokens: 5, outputTokens: 2 }, message: { role: 'assistant' } } },
    ];
    writeFileSync(join(dir, 'run.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const [session] = scanDeepSeekSessions(dir);
    assert.equal(session.model, 'kimi-k3');
    assert.deepEqual(session.models_used, ['kimi-k3', 'deepseek-v4-flash']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
