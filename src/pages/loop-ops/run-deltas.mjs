const METRICS = [
  ['cost_usd_real', 'real cost'],
  ['total_tokens', 'tokens'],
  ['tool_error_count', 'tool errors'],
];

function validDelta(value) {
  return value && typeof value === 'object'
    && Number.isFinite(value.before)
    && Number.isFinite(value.after)
    && Number.isFinite(value.delta_pct);
}

export function deltaTone(deltaPct) {
  if (deltaPct < 0) return 'improving';
  if (deltaPct > 0) return 'worsening';
  return 'neutral';
}

export function formatSignedPercent(deltaPct) {
  const prefix = deltaPct > 0 ? '+' : '';
  return `${prefix}${deltaPct.toFixed(2)}%`;
}

export function selectRunDeltas(comparison) {
  if (!comparison || typeof comparison !== 'object' || !comparison.deltas || typeof comparison.deltas !== 'object') return [];
  return METRICS.flatMap(([metric, label]) => {
    const delta = comparison.deltas[metric];
    return validDelta(delta) ? [{ metric, label, deltaPct: delta.delta_pct, tone: deltaTone(delta.delta_pct) }] : [];
  });
}
