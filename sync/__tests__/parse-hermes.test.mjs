import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHermesMessageEvidenceRows, parseHermesRows } from '../parse-hermes.mjs';

test('Hermes rows become canonical sessions with real usage and tools', () => {
  const [session] = parseHermesRows([
    {
      id: 'hermes-1', source: 'cli', model: 'deepseek-v4-pro', parent_session_id: null,
      started_at: 1_784_410_000, ended_at: 1_784_410_120, message_count: 8,
      tool_call_count: 3, input_tokens: 1_000, output_tokens: 200,
      cache_read_tokens: 50, cache_write_tokens: 25, cwd: '/work/meow-ops',
      git_branch: 'main', git_repo_root: '/work/meow-ops', title: 'Build learning control',
      estimated_cost_usd: 0.12,
    },
  ], [
    { session_id: 'hermes-1', tool_name: 'terminal', calls: 2 },
    { session_id: 'hermes-1', tool_name: 'read_file', calls: 1 },
  ]);

  assert.equal(session.source, 'hermes');
  assert.equal(session.project, 'meow-ops');
  assert.equal(session.model, 'deepseek-v4-pro');
  assert.equal(session.total_tokens, 1_275);
  assert.equal(session.estimated_cost_usd, 0.12);
  assert.deepEqual(session.tools, { Bash: 2, Read: 1 });
  assert.equal(session.duration_seconds, 120);
  assert.equal(session.session_title, 'Build learning control');
  assert.equal(session.usage_available, true);
});

test('Hermes parser preserves unavailable usage instead of inventing it', () => {
  const [session] = parseHermesRows([{
    id: 'hermes-2', source: 'cron', started_at: 1_784_410_000, ended_at: null,
    message_count: 1, tool_call_count: 0, cwd: null, title: 'Scheduled check',
  }], []);

  assert.equal(session.usage_available, false);
  assert.equal(session.model, null);
  assert.equal(session.total_tokens, 0);
  assert.equal(session.project, 'hermes');
});

test('Hermes messages become private evidence events without internal reasoning fields', () => {
  const [event] = parseHermesMessageEvidenceRows([{
    id: 42, session_id: 'hermes-1', role: 'assistant', content: 'Updated the learning state.',
    tool_name: 'write_file', tool_call_id: 'call-1', tool_calls: '[{"name":"write_file"}]',
    timestamp: 1_784_410_060, token_count: 55, observed: 1, compacted: 0,
    cwd: '/work/meow-ops', git_repo_root: '/work/meow-ops', reasoning: 'not archived',
  }], '/tmp/hermes.db');

  assert.equal(event.project, 'meow-ops');
  assert.equal(event.event_type, 'message_assistant');
  assert.equal(event.content, 'Updated the learning state.');
  assert.equal(event.metadata.tool_name, 'Write');
  assert.equal(event.metadata.token_count, 55);
  assert.equal('reasoning' in event.metadata, false);
  assert.equal(event.raw_ref, '/tmp/hermes.db#messages:42');
});
