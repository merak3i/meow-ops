import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLines, classifyCatType } from '../parse-session.mjs';

const SID = '11111111-2222-3333-4444-555555555555';

function lines(arr) { return arr.map((o) => JSON.stringify(o)); }

test('aggregates tokens, prices the model, classifies, and clamps duration', () => {
  const input = lines([
    { sessionId: SID, type: 'user', timestamp: '2026-06-01T10:00:00.000Z',
      cwd: '/Users/x/repos/myapp', gitBranch: 'main',
      message: { role: 'user', content: 'fix the failing billing webhook test' } },
    { sessionId: SID, type: 'assistant', timestamp: '2026-06-01T10:00:30.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        content: [{ type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'Write' }] } },
    { sessionId: SID, type: 'assistant', timestamp: '2026-06-01T10:01:00.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 100 },
        content: [{ type: 'tool_use', name: 'Edit' }] } },
  ]);
  const [s] = parseSessionLines(input, '-Users-x-repos-myapp');
  assert.ok(s);
  assert.equal(s.input_tokens, 1200);
  assert.equal(s.output_tokens, 600);
  assert.equal(s.total_tokens, 1800);
  // sonnet: input 3, output 15 per 1M → 1200*3/1e6 + 600*15/1e6 = 0.0036 + 0.009
  assert.equal(s.estimated_cost_usd, 0.0126);
  assert.equal(s.pricing_source, 'exact');
  assert.equal(s.cat_type, 'builder'); // Edit+Write dominate
  assert.equal(s.duration_seconds, 60);
  assert.equal(s.first_user_message, 'fix the failing billing webhook test');
});

test('a malformed line is skipped, not fatal', () => {
  const input = [
    '{ this is not valid json',
    JSON.stringify({ sessionId: SID, type: 'user', timestamp: '2026-06-01T10:00:00.000Z',
      message: { content: 'hello' } }),
    JSON.stringify({ sessionId: SID, type: 'assistant', timestamp: '2026-06-01T10:00:10.000Z',
      message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } }),
  ];
  const out = parseSessionLines(input, 'proj');
  assert.equal(out.length, 1);
  assert.equal(out[0].input_tokens, 10);
});

test('classifyCatType: empty tools → ghost', () => {
  assert.equal(classifyCatType({}), 'ghost');
  assert.equal(classifyCatType({ Read: 8, Grep: 3 }), 'detective');
});
