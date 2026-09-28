import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseCodexFile } from '../parse-codex.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '..', '__fixtures__', 'codex');

function fixturePath(name) {
  return join(FIXTURES_DIR, name);
}

test('fixture: partial markdown/json stream with trailing malformed line is tolerated', () => {
  const s = parseCodexFile(fixturePath('rollout-partial-markdown-jsonl.jsonl'));
  assert.ok(s);
  assert.equal(s.model, 'gpt-5');
  assert.equal(s.first_user_message, 'Render safely: ```json {"incomplete": true');
  assert.equal(s.total_tokens, 30);
  assert.equal(s.message_count, 2);
});

test('fixture: tool-call transitions are counted once and clearly by tool name', () => {
  const s = parseCodexFile(fixturePath('rollout-tool-transitions.jsonl'));
  assert.ok(s);
  assert.deepEqual(s.tools, {
    exec_command: 1,
    apply_patch: 1,
    tool_search_call: 1,
    web_search_call: 1,
  });
  // OpenAI's input_tokens (120) is INCLUSIVE of cached_input_tokens (30), so
  // the cached subset is split out (priced at the cheaper cache-read rate) and
  // only the non-cached remainder counts as input. Total = 90 + 45 + 30 = 165,
  // NOT 195 — adding cached on top of input was a double-count.
  assert.equal(s.input_tokens, 90);
  assert.equal(s.output_tokens, 45);
  assert.equal(s.cache_read_tokens, 30);
  assert.equal(s.total_tokens, 165);
});

test('fixture: turn_aborted still yields consistent token and tool state', () => {
  const s = parseCodexFile(fixturePath('rollout-turn-aborted.jsonl'));
  assert.ok(s);
  // input_tokens 40 includes the 10 cached; non-cached input = 30.
  assert.equal(s.input_tokens, 30);
  assert.equal(s.output_tokens, 15);
  assert.equal(s.cache_read_tokens, 10);
  assert.equal(s.total_tokens, 55);
  assert.equal(s.tools.exec_command, 1);
  assert.equal(s.message_count, 2);
  assert.equal(s.duration_seconds, 5);
});

test('fixture set: every rollout parses to a sane session shape (schema drift guard)', () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.jsonl'));
  assert.ok(files.length > 0, 'expected at least one jsonl fixture');

  for (const file of files) {
    const s = parseCodexFile(fixturePath(file));
    assert.ok(s, `${file}: parser returned null`);
    assert.equal(typeof s.session_id, 'string', `${file}: session_id`);
    assert.equal(typeof s.project, 'string', `${file}: project`);
    assert.ok(s.model === null || typeof s.model === 'string', `${file}: model`);
    assert.equal(typeof s.message_count, 'number', `${file}: message_count`);
    assert.equal(typeof s.total_tokens, 'number', `${file}: total_tokens`);
    assert.ok(Number.isFinite(s.total_tokens), `${file}: total_tokens should be finite`);
    assert.ok(s.total_tokens >= 0, `${file}: total_tokens should be non-negative`);
    assert.ok(s.tools && typeof s.tools === 'object', `${file}: tools`);
  }
});

test('parser preserves a UTF-8 character split across read chunks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-codex-parser-'));
  try {
    const filePath = join(directory, 'rollout-stream-boundary.jsonl');
    const chunkBytes = 1 << 20;
    const prefix = '{"type":"session_meta","payload":{"id":"stream-fixture","cwd":"/tmp/stream","base_instructions":{"text":"GPT-5"},"padding":"';
    const paddingBytes = chunkBytes - 2 - Buffer.byteLength(prefix);
    const sessionMeta = `${prefix}${'x'.repeat(paddingBytes)}🐈"}}`;
    const lines = [
      sessionMeta,
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-09-27T00:00:00.000Z',
        payload: { type: 'user_message', message: 'hello' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-09-27T00:00:01.000Z',
        payload: { type: 'agent_message', message: 'world' },
      }),
    ];
    writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

    const session = parseCodexFile(filePath);

    assert.ok(session);
    assert.equal(session.session_id, 'stream-fixture');
    assert.equal(session.model, 'gpt-5');
    assert.equal(session.message_count, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
