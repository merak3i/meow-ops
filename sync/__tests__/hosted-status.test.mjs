import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedSyncOrigins, isHostedSyncRoute, redactSyncStatusForHosted } from '../hosted-status.mjs';

test('hosted origins default to the canonical shell and honour opt-out', () => {
  assert.deepEqual([...hostedSyncOrigins({})], ['https://meow-ops.vercel.app']);
  assert.equal(hostedSyncOrigins({ MEOW_HOSTED_SYNC: '0' }).size, 0);
  const extra = hostedSyncOrigins({ MEOW_HOSTED_SYNC_ORIGINS: 'https://ops.example.com, http://evil.test, https://x.test/path' });
  assert.ok(extra.has('https://ops.example.com'));
  assert.equal(extra.has('http://evil.test'), false);
  assert.equal(extra.has('https://x.test/path'), false);
});

test('only status read and sync trigger are hosted routes', () => {
  assert.equal(isHostedSyncRoute('/sync/status', 'GET'), true);
  assert.equal(isHostedSyncRoute('/sync', 'POST'), true);
  assert.equal(isHostedSyncRoute('/sync/runs/x', 'GET'), false);
  assert.equal(isHostedSyncRoute('/sync/status', 'POST'), false);
  assert.equal(isHostedSyncRoute('/data/sessions.json', 'GET'), false);
});

test('redaction drops summaries, paths and unknown fields', () => {
  const out = redactSyncStatusForHosted({
    ok: true, run_id: 'sync_abc', state: 'failed', phase: 'export_sessions', trigger: 'dashboard',
    started_at: '2026-10-11T00:00:00Z', completed_at: '2026-10-11T00:01:00Z',
    phases: [{ id: 'preflight', status: 'succeeded', detail: '/Users/me/.claude' }],
    failure: { stage: 'export_sessions', code: 'parse_error', summary: 'failed at /Users/me/secret.jsonl' },
    log_path: '/Users/me/.meow-ops/runtime/log', size: 1234,
    artifact: {
      available: true, mtime: 1791700000000, size: 99, sessions: 42, generation: 'gen_1',
      source_counts: { claude: 40, codex: 2, '../x': 1 },
      source_health: { claude: { state: 'collected', sessions: 40, coverage: { roots: ['/Users/me'] } } },
    },
  });
  const text = JSON.stringify(out);
  assert.equal(text.includes('/Users'), false);
  assert.equal(text.includes('secret'), false);
  assert.equal(out.failure.code, 'parse_error');
  assert.equal('summary' in out.failure, false);
  assert.equal('size' in out, false);
  assert.equal('generation' in out.artifact, false);
  assert.deepEqual(out.artifact.source_counts, { claude: 40, codex: 2 });
  assert.deepEqual(out.artifact.source_health, { claude: { state: 'collected', sessions: 40 } });
  assert.deepEqual(out.phases, [{ id: 'preflight', status: 'succeeded' }]);
});
