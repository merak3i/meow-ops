const STATUS_SEVERITY = [
  'failed', 'blocked', 'needs-review', 'running', 'covered', 'wired', 'passed',
];

export const STALE_DAYS = 7;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

function statusRank(status) {
  const rank = STATUS_SEVERITY.indexOf(status);
  return rank === -1 ? STATUS_SEVERITY.indexOf('needs-review') : rank;
}

export function isGateStale(gate, now = new Date()) {
  const checkedAt = Date.parse(gate?.lastCheckedAt ?? '');
  return !Number.isFinite(checkedAt) || now.getTime() - checkedAt > STALE_MS;
}

export function effectiveStatus(entity, gates, now = new Date()) {
  const entityStatus = entity.status;
  if (!Array.isArray(gates) || gates.length === 0) {
    return statusRank('needs-review') < statusRank(entityStatus) ? 'needs-review' : entityStatus;
  }
  const worstGate = [...gates].sort((a, b) => statusRank(a.status) - statusRank(b.status))[0];
  const gateStatus = isGateStale(worstGate, now)
    && statusRank(worstGate.status) >= statusRank('needs-review')
    ? 'needs-review'
    : worstGate.status;
  return statusRank(gateStatus) < statusRank(entityStatus) ? gateStatus : entityStatus;
}
