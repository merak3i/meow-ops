import type { Session, VelocityMetrics } from '@/types/session';

// Sessions under 10 seconds are noise — ignore them for rate calculations.
const MIN_DURATION_SECONDS = 10;

/**
 * Compute per-session velocity metrics from a session array.
 * All division guards against zero-duration sessions.
 */
export function computeVelocityMetrics(sessions: Session[]): VelocityMetrics[] {
  return sessions.map((s) => {
    const durSec  = Math.max(s.duration_seconds, MIN_DURATION_SECONDS);
    const durMin  = durSec / 60;
    const durHr   = durSec / 3600;

    return {
      session_id:        s.session_id,
      tokens_per_minute: s.total_tokens / durMin,
      output_per_minute: s.output_tokens / durMin,
      cost_per_hour:     s.estimated_cost_usd / durHr,
      success:           !s.is_ghost && s.message_count >= 5,
      started_at:        s.started_at,
      project:           s.project,
      model:             s.model,
    };
  });
}

// ─── Aggregated stats ─────────────────────────────────────────────────────────

export interface VelocitySummary {
  avg_tokens_per_minute:  number;
  avg_output_per_minute:  number;
  avg_cost_per_hour:      number;
  session_success_rate:   number;   // 0–1
  p95_tokens_per_minute:  number;
  p50_tokens_per_minute:  number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function summariseVelocity(metrics: VelocityMetrics[]): VelocitySummary {
  if (metrics.length === 0) {
    return {
      avg_tokens_per_minute: 0,
      avg_output_per_minute: 0,
      avg_cost_per_hour:     0,
      session_success_rate:  0,
      p95_tokens_per_minute: 0,
      p50_tokens_per_minute: 0,
    };
  }

  const tpm = metrics.map((m) => m.tokens_per_minute);
  const sorted = [...tpm].sort((a, b) => a - b);

  const sum = (arr: number[]) => arr.reduce((a, v) => a + v, 0);
  const avg = (arr: number[]) => sum(arr) / arr.length;

  return {
    avg_tokens_per_minute:  avg(tpm),
    avg_output_per_minute:  avg(metrics.map((m) => m.output_per_minute)),
    avg_cost_per_hour:      avg(metrics.map((m) => m.cost_per_hour)),
    session_success_rate:   metrics.filter((m) => m.success).length / metrics.length,
    p95_tokens_per_minute:  percentile(sorted, 0.95),
    p50_tokens_per_minute:  percentile(sorted, 0.50),
  };
}

// ─── Project-level rollup ──────────────────────────────────────────────────────

export interface ProjectVelocity {
  project:              string;
  session_count:        number;
  avg_tokens_per_minute: number;
  success_rate:         number;
}

export function velocityByProject(metrics: VelocityMetrics[]): ProjectVelocity[] {
  const map = new Map<string, VelocityMetrics[]>();

  for (const m of metrics) {
    const bucket = map.get(m.project) ?? [];
    bucket.push(m);
    map.set(m.project, bucket);
  }

  return Array.from(map.entries())
    .map(([project, rows]) => ({
      project,
      session_count:         rows.length,
      avg_tokens_per_minute: rows.reduce((a, r) => a + r.tokens_per_minute, 0) / rows.length,
      success_rate:          rows.filter((r) => r.success).length / rows.length,
    }))
    .sort((a, b) => b.avg_tokens_per_minute - a.avg_tokens_per_minute);
}
