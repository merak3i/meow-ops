import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCursorMetadata, readCursorLocalMetadata } from '../cursor-local-metadata.mjs';

const session = { session_id: 'cursor-conversation-a', composer_id: 'conversation-a', source: 'cursor', model: null, total_tokens: 0, usage_available: false, estimated_cost_usd: 0, started_at: '2026-09-13T00:00:00.000Z' };
const request = (bubble, model, extra = {}) => ({ composer_id: 'conversation-a', bubble_id: bubble, type: 1, model_name: model, ...extra });

test('reports mixed requested models without inventing response model, tokens or billing', () => {
  const result = summarizeCursorMetadata([session], [], [request('one', 'composer-2.5'), request('two', 'grok-4.6'), request('three', 'grok-4.6')]);
  assert.deepEqual(result.report.by_model, [{ model: 'grok-4.6', requests: 2, sessions: 1 }, { model: 'composer-2.5', requests: 1, sessions: 1 }]);
  assert.equal(result.sessions[0].model, null);
  assert.equal(result.sessions[0].total_tokens, 0);
  assert.equal(result.sessions[0].usage_available, false);
  assert.equal(result.sessions[0].estimated_cost_usd, 0);
});

test('deduplicates requests, excludes simulated and unmatched rows, leaves auto unresolved', () => {
  const result = summarizeCursorMetadata([session], [], [request('one', 'grok-4.6'), request('one', 'grok-4.6'), request('two', 'auto'), request('three', 'default'), request('four', 'composer-2.5', { simulated: 1 }), request('five', 'composer-2.5', { composer_id: 'unmatched' }), request('six', 'composer-2.5', { type: 2 })]);
  assert.equal(result.report.requests_with_model, 1);
  assert.equal(result.report.unresolved_requests, 2);
});

test('replaces filesystem modification dates with exact matched message timestamps', () => {
  const result = summarizeCursorMetadata([session], [{ composer_id: 'conversation-a', headers: [{ createdAt: '2026-08-01T10:00:30Z' }, { createdAt: 'invalid' }, { createdAt: '2026-08-01T10:00:00Z' }] }], []);
  assert.equal(result.sessions[0].started_at, '2026-08-01T10:00:00.000Z');
  assert.equal(result.sessions[0].duration_seconds, 30);
  assert.equal(result.sessions[0].timestamp_source, 'cursor-message-metadata');
  assert.equal(session.started_at, '2026-09-13T00:00:00.000Z');
});

test('preserves independently authoritative usage and other sources', () => {
  const paid = { ...session, model: 'verified-model', usage_available: true, total_tokens: 123, estimated_cost_usd: 0.01 };
  const other = { ...session, source: 'codex' };
  const result = summarizeCursorMetadata([paid, other], [], [request('one', 'grok-4.6')]);
  assert.equal(result.sessions[0].model, 'verified-model');
  assert.equal(result.sessions[0].total_tokens, 123);
  assert.equal(result.sessions[1], other);
});

test('missing or unreadable databases retain transcripts and expose no private errors', () => {
  const missing = readCursorLocalMetadata([session], { dbPath: '/nonexistent/cursor-test.db' });
  assert.equal(missing.report.status, 'not-found');
  const unreadable = readCursorLocalMetadata([session], { dbPath: import.meta.filename, query: () => { throw new Error('secret private database contents'); } });
  assert.equal(unreadable.report.status, 'unreadable');
  assert.equal(unreadable.sessions[0], session);
  assert.ok(!JSON.stringify(unreadable).includes('secret private'));
});

test('reader only queries exact valid identifiers and projects non-content metadata', () => {
  const queries = [];
  const result = readCursorLocalMetadata([session, { ...session, composer_id: "bad'); DROP TABLE cursorDiskKV; --" }], {
    dbPath: import.meta.filename,
    query: (_path, sql) => {
      queries.push(sql);
      if (sql.includes('fullConversationHeadersOnly')) return [{ composer_id: 'conversation-a', headers: JSON.stringify([{ type: 1, bubbleId: 'one' }, { type: 2, bubbleId: 'reply' }]) }];
      return [request('one', 'grok-4.6')];
    },
  });
  assert.equal(result.report.requests_with_model, 1);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(sql => !sql.includes('DROP TABLE') && !sql.includes('modelConfig') && !sql.includes('$.text') && !sql.includes('EncryptionKey')));
  assert.ok(!queries[1].includes("'reply'"));
});
