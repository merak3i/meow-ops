import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexGuideEvents } from '../guide-codex-evidence.mjs';
import { parseCodexFile } from '../parse-codex.mjs';

test('one-rollout import covers full conversation, binds metadata and skips instructions/tool payloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-codex-evidence-'));
  try {
    const file = join(dir, 'fixture.jsonl');
    const binding = { session_id: 'fixture', project: 'fixture-project', cwd: '/fixture' };
    const rows = [
      { type: 'session_meta', payload: { id: 'fixture', cwd: '/fixture', base_instructions: 'excluded instructions' } },
      { type: 'response_item', payload: { type: 'function_call_output', output: 'excluded tool output' } },
      ...Array.from({ length: 45 }, (_, i) => ({ type: 'event_msg', timestamp: '2026-09-13T00:00:00Z', payload: { type: 'agent_message', message: `${i}: password=abcdefghijk12345 ${'x'.repeat(2100)}` } })),
    ];
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
    const events = await readCodexGuideEvents(file, binding);
    assert.equal(events.length, 45);
    assert.equal(events[0].metadata.line, 3);
    assert.equal(events.at(-1).metadata.line, 47);
    assert.ok(events.every(event => event.metadata.truncated && event.content.length === 2000));
    assert.doesNotMatch(JSON.stringify(events), /abcdefghijk|excluded instructions|excluded tool/);
    assert.deepEqual(await readCodexGuideEvents(file, { ...binding, session_id: 'other' }), []);
    assert.deepEqual(await readCodexGuideEvents(file, { ...binding, cwd: '/other' }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('modern message records retain archive IDs and legacy echoes are not double-counted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-codex-modern-'));
  try {
    const file = join(dir, 'modern.jsonl');
    const stamp = '2026-09-13T00:00:00Z';
    const rows = [
      { type: 'session_meta', payload: { id: 'fixture', cwd: '/fixture' } },
      ...['developer', 'user', 'assistant'].map(role => ({ type: 'response_item', timestamp: stamp, payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: `${role} text` }] } })),
    ];
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
    const modern = parseCodexFile(file);
    assert.equal(modern.message_count, 2);
    assert.equal(modern.model, null);
    assert.equal(modern.is_ghost, false);
    const events = await readCodexGuideEvents(file, { session_id: 'codex-fixture', project: 'fixture', cwd: '/fixture' });
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.session_id === 'codex-fixture'));
    assert.doesNotMatch(JSON.stringify(events), /developer text/);
    rows.push({ type: 'event_msg', timestamp: stamp, payload: { type: 'user_message', message: 'user text' } });
    rows.push({ type: 'event_msg', timestamp: stamp, payload: { type: 'agent_message', message: 'legacy-only assistant text' } });
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
    assert.equal(parseCodexFile(file).message_count, 2);
    const combined = await readCodexGuideEvents(file, { session_id: 'codex-fixture', project: 'fixture', cwd: '/fixture' });
    assert.equal(combined.length, 3);
    assert.equal(combined.at(-1).content, 'legacy-only assistant text');
    rows.push({ type: 'turn_context', timestamp: stamp, payload: { model: 'gpt-6-astra' } });
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
    assert.equal(parseCodexFile(file).model, 'gpt-6-astra');
    rows.push({ type: 'turn_context', timestamp: stamp, payload: { model: 'gpt-5.6-sol' } });
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
    assert.equal(parseCodexFile(file).model, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
