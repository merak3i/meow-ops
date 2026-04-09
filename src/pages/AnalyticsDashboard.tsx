import { useMemo, useCallback, useState } from 'react';
import { ModuleRegistry, ClientSideRowModelModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

import { computeVelocityMetrics, summariseVelocity } from '@/analytics/velocity';
import { computeEfficiencyRecords, summariseEfficiency } from '@/analytics/efficiency';
import { toDailySpend, computeBurnRate } from '@/analytics/burnRate';
import { formatCost } from '@/lib/format';
import type { Session, DailySummaryRow } from '@/types/session';

// Register AG-Grid modules once
ModuleRegistry.registerModules([ClientSideRowModelModule]);

// ─── Props ────────────────────────────────────────────────────────────────────

interface AnalyticsDashboardProps {
  sessions:     Session[];
  dailySummary: DailySummaryRow[];
}

// ─── Column definitions ───────────────────────────────────────────────────────

const SESSION_COLS = [
  {
    field:       'session_id' as const,
    headerName:  'Session',
    width:       200,
    cellRenderer: ({ value }: { value: string }) => (
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
        {value.slice(0, 16)}…
      </span>
    ),
  },
  { field: 'project' as const,    headerName: 'Project',  flex: 1, minWidth: 140 },
  { field: 'model' as const,      headerName: 'Model',    width: 160 },
  {
    field:      'tokens_per_minute' as const,
    headerName: 'TPM',
    width:      90,
    valueFormatter: ({ value }: { value: number }) => value.toFixed(0),
    sort:       'desc' as const,
  },
  {
    field:      'output_per_minute' as const,
    headerName: 'OPM',
    width:      90,
    valueFormatter: ({ value }: { value: number }) => value.toFixed(0),
  },
  {
    field:      'cost_per_hour' as const,
    headerName: '$/hr',
    width:      80,
    valueFormatter: ({ value }: { value: number }) => `$${value.toFixed(2)}`,
  },
  {
    field:      'success' as const,
    headerName: 'Success',
    width:      80,
    cellRenderer: ({ value }: { value: boolean }) => (
      <span style={{ color: value ? 'var(--green)' : '#f87171', fontSize: 13 }}>
        {value ? '✓' : '✗'}
      </span>
    ),
  },
  {
    field:      'started_at' as const,
    headerName: 'Started',
    width:      140,
    valueFormatter: ({ value }: { value: string }) =>
      new Date(value).toLocaleString('en-IN', {
        timeZone:   'Asia/Kolkata',
        dateStyle:  'short',
        timeStyle:  'short',
      }),
  },
];

const ANOMALY_COLS = [
  { field: 'project' as const,    headerName: 'Project',   flex: 1, minWidth: 140 },
  {
    field:      'sei' as const,
    headerName: 'SEI (out/min)',
    width:      130,
    valueFormatter: ({ value }: { value: number }) => value.toFixed(1),
    sort:       'desc' as const,
  },
  {
    field:      'z_score' as const,
    headerName: 'Z-Score',
    width:      90,
    valueFormatter: ({ value }: { value: number }) => value.toFixed(2),
    cellStyle:  ({ value }: { value: number }) =>
      Math.abs(value) > 2.5
        ? { color: '#f87171', fontWeight: 600 }
        : { color: 'var(--text-secondary)' },
  },
  {
    field:      'is_anomaly' as const,
    headerName: 'Anomaly',
    width:      90,
    cellRenderer: ({ value }: { value: boolean }) => (
      <span style={{ color: value ? '#f87171' : 'var(--text-muted)', fontSize: 12 }}>
        {value ? '⚠ Yes' : '—'}
      </span>
    ),
  },
  {
    field:      'duration_min' as const,
    headerName: 'Duration',
    width:      100,
    valueFormatter: ({ value }: { value: number }) => `${value.toFixed(1)} min`,
  },
  {
    field:      'started_at' as const,
    headerName: 'Started',
    width:      140,
    valueFormatter: ({ value }: { value: string }) =>
      new Date(value).toLocaleString('en-IN', {
        timeZone:   'Asia/Kolkata',
        dateStyle:  'short',
        timeStyle:  'short',
      }),
  },
];

// ─── Stat pill ─────────────────────────────────────────────────────────────────

function Pill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border)',
      borderRadius: 8,
      padding:      '10px 14px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--accent)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Burn rate section ────────────────────────────────────────────────────────

function BurnRatePanel({ dailySummary }: { dailySummary: DailySummaryRow[] }) {
  const forecast = useMemo(
    () => computeBurnRate(toDailySpend(dailySummary)),
    [dailySummary],
  );

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Burn Rate Forecast
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Pill
          label="30-day Forecast"
          value={formatCost(forecast.forecast_30d)}
          sub={`band: ${formatCost(forecast.confidence_band.lower)}–${formatCost(forecast.confidence_band.upper)}`}
        />
        <Pill
          label="30-day Moving Avg"
          value={formatCost(forecast.moving_avg_30d * 30)}
          sub="rolling avg × 30"
        />
        <Pill
          label="Trend slope"
          value={`${forecast.slope_usd_per_day >= 0 ? '+' : ''}${formatCost(forecast.slope_usd_per_day)}/day`}
          sub={`R² = ${(forecast.r_squared * 100).toFixed(0)}%`}
        />
        <Pill
          label="Regression fit"
          value={`${(forecast.r_squared * 100).toFixed(1)}%`}
          sub={forecast.r_squared > 0.7 ? 'Good fit' : forecast.r_squared > 0.4 ? 'Moderate' : 'Noisy data'}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type TabId = 'velocity' | 'efficiency';

export default function AnalyticsDashboard({ sessions, dailySummary }: AnalyticsDashboardProps) {
  const [tab, setTab] = useState<TabId>('velocity');

  const velocityMetrics = useMemo(() => computeVelocityMetrics(sessions), [sessions]);
  const velocitySummary = useMemo(() => summariseVelocity(velocityMetrics), [velocityMetrics]);

  const efficiencyRecords = useMemo(() => computeEfficiencyRecords(sessions), [sessions]);
  const efficiencySummary = useMemo(() => summariseEfficiency(efficiencyRecords), [efficiencyRecords]);

  const defaultColDef = useMemo(
    () => ({
      resizable:  true,
      sortable:   true,
      filter:     true,
      cellStyle:  { fontSize: 12, fontFamily: 'JetBrains Mono, monospace' },
    }),
    [],
  );

  const onGridReady = useCallback(() => {}, []);

  const TABS: { id: TabId; label: string }[] = [
    { id: 'velocity',   label: 'Velocity' },
    { id: 'efficiency', label: 'Efficiency' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22 }}>Analytics</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                fontSize:     11,
                padding:      '4px 14px',
                borderRadius: 4,
                border:       '1px solid var(--border)',
                cursor:       'pointer',
                background:   tab === id ? 'var(--accent)' : 'transparent',
                color:        tab === id ? '#000' : 'var(--text-muted)',
                fontWeight:   tab === id ? 500 : 400,
                transition:   'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Burn rate always visible */}
      {dailySummary.length > 0 && <BurnRatePanel dailySummary={dailySummary} />}

      {/* ── Velocity tab ────────────────────────────────────────────────────── */}
      {tab === 'velocity' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <Pill label="Avg TPM"      value={velocitySummary.avg_tokens_per_minute.toFixed(0)} sub="tokens/min" />
            <Pill label="P95 TPM"      value={velocitySummary.p95_tokens_per_minute.toFixed(0)} sub="95th percentile" />
            <Pill label="Avg Cost/hr"  value={formatCost(velocitySummary.avg_cost_per_hour)} />
            <Pill
              label="Success Rate"
              value={`${(velocitySummary.session_success_rate * 100).toFixed(0)}%`}
              sub={`${velocityMetrics.filter((m) => m.success).length} / ${velocityMetrics.length}`}
            />
          </div>

          <div
            className="ag-theme-quartz-dark"
            style={{
              height:  540,
              width:   '100%',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <AgGridReact
              rowData={velocityMetrics}
              columnDefs={SESSION_COLS}
              defaultColDef={defaultColDef}
              onGridReady={onGridReady}
              rowHeight={36}
              headerHeight={36}
              pagination
              paginationPageSize={20}
              paginationPageSizeSelector={[10, 20, 50, 100]}
            />
          </div>
        </>
      )}

      {/* ── Efficiency tab ───────────────────────────────────────────────────── */}
      {tab === 'efficiency' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <Pill label="Mean SEI"      value={efficiencySummary.mean_sei.toFixed(1)}  sub="output tokens/min" />
            <Pill label="P95 SEI"       value={efficiencySummary.p95_sei.toFixed(1)} />
            <Pill
              label="Anomalies"
              value={String(efficiencySummary.anomaly_count)}
              sub={`${(efficiencySummary.anomaly_rate * 100).toFixed(1)}% of sessions`}
            />
            <Pill label="Std Dev SEI"   value={efficiencySummary.std_sei.toFixed(1)} sub="|z| > 2.5 flagged" />
          </div>

          <div
            className="ag-theme-quartz-dark"
            style={{
              height:  540,
              width:   '100%',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <AgGridReact
              rowData={efficiencyRecords}
              columnDefs={ANOMALY_COLS}
              defaultColDef={defaultColDef}
              onGridReady={onGridReady}
              rowHeight={36}
              headerHeight={36}
              pagination
              paginationPageSize={20}
              paginationPageSizeSelector={[10, 20, 50, 100]}
            />
          </div>
        </>
      )}
    </div>
  );
}
