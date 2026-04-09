import type { Session, EfficiencyRecord } from '@/types/session';

// Sessions with < 30s duration are excluded — they distort SEI massively.
const MIN_DURATION_SECONDS = 30;

// Z-score threshold for anomaly detection (±2.5σ)
const Z_THRESHOLD = 2.5;

// ─── SEI computation ──────────────────────────────────────────────────────────

/**
 * Session Efficiency Index = output_tokens / duration_minutes.
 *
 * Higher SEI → more output generated per minute of session time.
 * Anomalies (|z| > 2.5) may indicate runaway sessions or test spikes.
 */
export function computeEfficiencyRecords(sessions: Session[]): EfficiencyRecord[] {
  const eligible = sessions.filter((s) => s.duration_seconds >= MIN_DURATION_SECONDS);

  if (eligible.length === 0) return [];

  // First pass: compute raw SEI values
  const rawSEI = eligible.map((s) => ({
    session: s,
    sei:     s.output_tokens / (s.duration_seconds / 60),
    duration_min: s.duration_seconds / 60,
  }));

  // Population statistics for z-score normalisation
  const seiValues = rawSEI.map((r) => r.sei);
  const mean      = seiValues.reduce((a, v) => a + v, 0) / seiValues.length;
  const variance  = seiValues.reduce((a, v) => a + (v - mean) ** 2, 0) / seiValues.length;
  const std       = Math.sqrt(variance);

  return rawSEI.map(({ session, sei, duration_min }) => ({
    session_id:   session.session_id,
    sei,
    z_score:      std > 0 ? (sei - mean) / std : 0,
    is_anomaly:   std > 0 && Math.abs((sei - mean) / std) > Z_THRESHOLD,
    project:      session.project,
    started_at:   session.started_at,
    duration_min,
  }));
}

// ─── Aggregated stats ─────────────────────────────────────────────────────────

export interface EfficiencySummary {
  mean_sei:       number;
  std_sei:        number;
  anomaly_count:  number;
  anomaly_rate:   number;   // 0–1
  p95_sei:        number;
  p50_sei:        number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function summariseEfficiency(records: EfficiencyRecord[]): EfficiencySummary {
  if (records.length === 0) {
    return { mean_sei: 0, std_sei: 0, anomaly_count: 0, anomaly_rate: 0, p95_sei: 0, p50_sei: 0 };
  }

  const seis   = records.map((r) => r.sei);
  const sorted = [...seis].sort((a, b) => a - b);
  const mean   = seis.reduce((a, v) => a + v, 0) / seis.length;
  const std    = Math.sqrt(seis.reduce((a, v) => a + (v - mean) ** 2, 0) / seis.length);
  const anomalies = records.filter((r) => r.is_anomaly);

  return {
    mean_sei:      mean,
    std_sei:       std,
    anomaly_count: anomalies.length,
    anomaly_rate:  anomalies.length / records.length,
    p95_sei:       percentile(sorted, 0.95),
    p50_sei:       percentile(sorted, 0.50),
  };
}

// ─── Per-project efficiency ───────────────────────────────────────────────────

export interface ProjectEfficiency {
  project:       string;
  mean_sei:      number;
  anomaly_count: number;
  session_count: number;
}

export function efficiencyByProject(records: EfficiencyRecord[]): ProjectEfficiency[] {
  const map = new Map<string, EfficiencyRecord[]>();

  for (const r of records) {
    const bucket = map.get(r.project) ?? [];
    bucket.push(r);
    map.set(r.project, bucket);
  }

  return Array.from(map.entries())
    .map(([project, rows]) => ({
      project,
      mean_sei:      rows.reduce((a, r) => a + r.sei, 0) / rows.length,
      anomaly_count: rows.filter((r) => r.is_anomaly).length,
      session_count: rows.length,
    }))
    .sort((a, b) => b.mean_sei - a.mean_sei);
}
