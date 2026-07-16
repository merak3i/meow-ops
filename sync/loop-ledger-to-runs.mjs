import { readLedger } from './loop-ledger.mjs';
import { isValidLoopRun } from '../src/pages/loop-ops/run-validation.mjs';
import { entityIdForLoopId } from '../src/pages/loop-ops/loop-entity-map.mjs';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function ledgerRunToLoopRun(record) {
  const capturedAt = typeof record?.captured_at === 'string' ? record.captured_at : '';
  const loopId = typeof record?.loop_id === 'string' ? record.loop_id : '';
  const metrics = record?.metrics && typeof record.metrics === 'object' ? record.metrics : {};
  const artifacts = Array.isArray(record?.artifacts) ? record.artifacts : [];
  const sources = Array.isArray(record?.sources) ? record.sources.filter((item) => typeof item === 'string') : [];
  const sessionIds = Array.isArray(record?.session_ids)
    ? record.session_ids.filter((item) => typeof item === 'string')
    : [];
  const entityId = entityIdForLoopId(loopId);

  return {
    id: typeof record?.run_id === 'string' ? record.run_id : '',
    goal: typeof record?.notes === 'string' && record.notes.trim() ? record.notes.trim() : loopId,
    entityIds: entityId ? [entityId] : [],
    state: finiteNumber(metrics.tool_error_count) > 0 ? 'failed' : 'passed',
    startedAt: capturedAt,
    endedAt: capturedAt || null,
    operator: sources.join('+'),
    sessionIds,
    artifacts,
    cost: {
      usd: finiteNumber(metrics.cost_usd_real),
      tokens: finiteNumber(metrics.total_tokens),
    },
    verified: [],
    notVerified: [],
  };
}

export function readLedgerLoopRuns() {
  return readLedger('run')
    .map(ledgerRunToLoopRun)
    .filter(isValidLoopRun)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
