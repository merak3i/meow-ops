import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeEternal } from '../eternal-stats.mjs';

test('eternal totals cover more than the browser preview and expose no rows', () => {
  const sessions = Array.from({ length: 1806 }, (_, i) => ({ session_id: `private-${i}`, estimated_cost_usd: 1, total_tokens: 2, is_ghost: i < 40 }));
  const stats = summarizeEternal({ sessions, updatedAt: '2026-09-13T00:00:00Z' });
  assert.equal(stats.totalSessions, 1806);
  assert.equal(stats.totalSpend, 1806);
  assert.equal(stats.totalTokens, 3612);
  assert.equal(stats.ghostCount, 40);
  assert.equal(stats.scope, 'archive');
  assert.equal(JSON.stringify(stats).includes('private-'), false);
});

test('unavailable archives stay unavailable and malformed amounts cannot poison totals', () => {
  assert.equal(summarizeEternal({ sessions: [], updatedAt: null }), null);
  const stats = summarizeEternal({ updatedAt: '2026-09-13', sessions: [{ total_tokens: NaN, estimated_cost_usd: -1 }, { total_tokens: '10', estimated_cost_usd: Infinity }] });
  assert.equal(stats.totalSpend, 0);
  assert.equal(stats.totalTokens, 0);
});
