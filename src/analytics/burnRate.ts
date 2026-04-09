import type { BurnRateForecast, DailySpend, ForecastPoint } from '@/types/session';

// ─── OLS linear regression ────────────────────────────────────────────────────

interface OLSResult {
  slope:     number;
  intercept: number;
  r_squared: number;
  residuals: number[];
}

function ols(xs: number[], ys: number[]): OLSResult {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r_squared: 0, residuals: [] };

  const xMean = xs.reduce((a, v) => a + v, 0) / n;
  const yMean = ys.reduce((a, v) => a + v, 0) / n;

  let ssxy = 0;
  let ssxx = 0;
  for (let i = 0; i < n; i++) {
    ssxy += ((xs[i] ?? 0) - xMean) * ((ys[i] ?? 0) - yMean);
    ssxx += ((xs[i] ?? 0) - xMean) ** 2;
  }

  const slope     = ssxx === 0 ? 0 : ssxy / ssxx;
  const intercept = yMean - slope * xMean;

  const predicted = xs.map((x) => slope * x + intercept);
  const residuals = ys.map((y, i) => y - (predicted[i] ?? 0));

  const ssTot = ys.reduce((a, y) => a + (y - yMean) ** 2, 0);
  const ssRes = residuals.reduce((a, r) => a + r ** 2, 0);
  const r_squared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r_squared, residuals };
}

// ─── Main forecast ────────────────────────────────────────────────────────────

/**
 * Build a 30-day burn rate forecast from daily spend history.
 *
 * Uses OLS on the most-recent 90 days (or all history if < 90 days)
 * to project forward. Confidence band = ±1σ of residuals.
 */
export function computeBurnRate(history: DailySpend[]): BurnRateForecast {
  if (history.length === 0) {
    return emptyForecast();
  }

  // Sort ascending
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

  // Only regress on last 90 days (more recent = more representative)
  const window = sorted.slice(-90);

  const xs = window.map((_, i) => i);
  const ys = window.map((d) => d.cost);

  const { slope, intercept, r_squared, residuals } = ols(xs, ys);

  // 1-σ band from residual standard deviation
  const sigma = residuals.length > 1
    ? Math.sqrt(residuals.reduce((a, r) => a + r ** 2, 0) / (residuals.length - 1))
    : 0;

  // Rolling 30-day average daily spend
  const last30 = sorted.slice(-30);
  const moving_avg_30d = last30.length > 0
    ? last30.reduce((a, d) => a + d.cost, 0) / last30.length
    : 0;

  // Day-by-day forecast
  const today    = new Date();
  const lastX    = window.length - 1;
  const forecast_days: ForecastPoint[] = [];

  for (let d = 1; d <= 30; d++) {
    const x         = lastX + d;
    const predicted = slope * x + intercept;
    const cost      = Math.max(0, predicted);
    const date      = new Date(today);
    date.setDate(today.getDate() + d);

    forecast_days.push({
      day:   d,
      date:  date.toISOString().slice(0, 10),
      cost,
      upper: Math.max(0, cost + sigma),
      lower: Math.max(0, cost - sigma),
    });
  }

  const forecast_30d = forecast_days.reduce((a, p) => a + p.cost, 0);

  return {
    daily_history:     sorted,
    slope_usd_per_day: slope,
    intercept,
    r_squared,
    forecast_30d,
    moving_avg_30d,
    forecast_days,
    confidence_band: {
      upper: Math.max(0, forecast_30d + sigma * 30),
      lower: Math.max(0, forecast_30d - sigma * 30),
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyForecast(): BurnRateForecast {
  return {
    daily_history:     [],
    slope_usd_per_day: 0,
    intercept:         0,
    r_squared:         0,
    forecast_30d:      0,
    moving_avg_30d:    0,
    forecast_days:     [],
    confidence_band:   { upper: 0, lower: 0 },
  };
}

/**
 * Convert a DailySummaryRow array (from cost-summary.json) to DailySpend[].
 */
export function toDailySpend(
  rows: Array<{
    date: string;
    estimated_cost_usd: number;
    total_tokens: number;
    session_count: number;
  }>,
): DailySpend[] {
  return rows.map((r) => ({
    date:          r.date,
    cost:          r.estimated_cost_usd,
    tokens:        r.total_tokens,
    session_count: r.session_count,
  }));
}
