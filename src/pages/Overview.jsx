import { useState, useMemo } from 'react';
import { Activity, Zap, DollarSign, FolderKanban, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import StatCard from '../components/StatCard';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import SpendChart from '../components/SpendChart';
import { formatTokens, formatCost } from '../lib/format';
import {
  computeOverviewStats,
  computeSpendBreakdown,
  getToolBreakdownFromSessions,
  buildDailyFromSessions,
} from '../lib/queries';

// ─── Source filter toggle ─────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { id: 'both',   label: 'All' },
  { id: 'claude', label: '◆ Claude' },
  { id: 'codex',  label: '⬡ Codex' },
];

function SourceToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Source</span>
      {SOURCE_OPTIONS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            fontSize: 11,
            padding: '3px 12px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            cursor: 'pointer',
            background: value === id ? 'var(--accent)' : 'transparent',
            color: value === id ? '#000' : 'var(--text-muted)',
            fontWeight: value === id ? 500 : 400,
            transition: 'all 0.15s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Spend card ───────────────────────────────────────────────────────────────
function SpendCard({ label, current, previous, sessions, tokens, highlight }) {
  const pct = previous > 0 ? ((current - previous) / previous) * 100 : null;
  const up = pct !== null && pct >  0.5;
  const dn = pct !== null && pct < -0.5;
  const TrendIcon = up ? TrendingUp : dn ? TrendingDown : Minus;
  const trendColor = up ? '#f87171' : dn ? 'var(--green)' : 'var(--text-muted)';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 300, color: 'var(--green)', lineHeight: 1.2 }}>
        {formatCost(current)}
      </span>
      {sessions != null && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {sessions} sessions · {formatTokens(tokens ?? 0)}
        </span>
      )}
      {pct !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: trendColor, marginTop: 2 }}>
          <TrendIcon size={11} />
          {Math.abs(pct).toFixed(0)}% vs prev period
        </div>
      )}
    </div>
  );
}

function periodLabel(dateRange) {
  if (dateRange === 'all') return 'All time';
  if (dateRange === '1h')  return 'Last hour';
  if (dateRange === '24h') return 'Last 24 h';
  if (dateRange === 7)     return '7 days';
  if (dateRange === 30)    return '30 days';
  if (dateRange === 90)    return '90 days';
  return `${dateRange} days`;
}

// ─── Overview ─────────────────────────────────────────────────────────────────
export default function Overview({
  stats: rawStats,
  sessions: rawSessions = [],  // date-filtered sessions (for display cards)
  allSessions = [],            // ALL sessions, no date filter (for accurate spend cards)
  dailyData,
  toolData: rawToolData,
  costSummary,
  dateRange = 30,
}) {
  const [source, setSource] = useState('both');

  const hasCodex = useMemo(
    () => allSessions.some((s) => s.source === 'codex'),
    [allSessions],
  );

  // Filter both arrays by source
  const filterBySrc = (list) =>
    source === 'both' ? list : list.filter((s) => (s.source || 'claude') === source);

  // Date-filtered + source-filtered sessions (for stat cards / charts)
  const sessions = useMemo(() => filterBySrc(rawSessions), [rawSessions, source]);

  // ALL sessions filtered by source only (for spend breakdown — no date truncation)
  const allSourceSessions = useMemo(() => filterBySrc(allSessions), [allSessions, source]);

  const stats    = useMemo(() => computeOverviewStats(sessions, dateRange),    [sessions, dateRange]);
  const toolData = useMemo(() => getToolBreakdownFromSessions(sessions),       [sessions]);

  // ── Spend breakdown ────────────────────────────────────────────────────────
  // Priority:
  //   1. cost-summary.json when "All sources" is selected — covers 100% of sessions
  //   2. computeSpendBreakdown(allSourceSessions) when source filter is active
  //      — uses ALL sessions (no date cap) filtered by the chosen source
  //
  // We never fall back to the date-filtered `sessions` array for spend cards,
  // because switching date range to "7d" would incorrectly zero out "This Month".
  const localSpend = useMemo(
    () => computeSpendBreakdown(allSourceSessions),
    [allSourceSessions],
  );

  const spend = (source !== 'both' || !costSummary) ? localSpend : {
    today:          costSummary.today,
    thisWeek:       costSummary.thisWeek,
    lastWeek:       costSummary.lastWeek,
    thisMonth:      costSummary.thisMonth,
    lastMonth:      costSummary.lastMonth,
    thisYear:       costSummary.thisYear,
    lastYear:       costSummary.lastYear ?? null,
    allTime:        costSummary.allTime,
    bySource:       costSummary.bySource,
    // History arrays still from localSpend (accurate enough for chart bars,
    // and they respond to source filter changes immediately).
    weeklyHistory:  localSpend.weeklyHistory,
    monthlyHistory: localSpend.monthlyHistory,
  };

  // Daily data for chart — when source filter is active, rebuild from sessions
  // so the bar chart also reflects the filtered view.
  const chartDailyData = useMemo(() => {
    if (source === 'both') return dailyData;
    return buildDailyFromSessions(sessions);
  }, [source, sessions, dailyData]);

  const label = periodLabel(dateRange);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22 }}>Overview</h2>
        {hasCodex && <SourceToggle value={source} onChange={setSource} />}
      </div>

      {/* ── Primary stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard
          label={`Sessions — ${label}`}
          value={stats.periodSessions}
          sub={`${stats.sessionsToday} today`}
          icon={Activity}
          color="var(--accent)"
        />
        <StatCard
          label={`Tokens — ${label}`}
          value={formatTokens(stats.periodTokens)}
          sub={`${formatTokens(stats.tokensToday)} today`}
          icon={Zap}
          color="var(--cyan)"
        />
        <StatCard
          label={`Cost — ${label}`}
          value={formatCost(stats.periodCost)}
          sub={`${formatCost(stats.costToday)} today`}
          icon={DollarSign}
          color="var(--green)"
        />
        <StatCard
          label={`Projects — ${label}`}
          value={stats.periodProjects}
          sub={`${stats.projectsToday} active today · ${stats.healthRatio}% healthy`}
          icon={FolderKanban}
          color="var(--amber)"
        />
      </div>

      {/* ── Spend breakdown cards ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Cost Breakdown
          </p>
          {costSummary?.exportedAt && source === 'both' && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              updated {new Date(costSummary.exportedAt).toLocaleTimeString('en-IN', {
                timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
              })} IST
            </span>
          )}
          {source !== 'both' && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              filtered: {source === 'claude' ? '◆ Claude only' : '⬡ Codex only'}
            </span>
          )}
        </div>

        {/* Row 1: Today / This Week / Last Week */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <SpendCard
            label="Today"
            current={spend.today?.cost ?? 0}
            previous={null}
            sessions={spend.today?.sessions}
            tokens={spend.today?.tokens}
            highlight
          />
          <SpendCard
            label="This Week"
            current={spend.thisWeek?.cost ?? 0}
            previous={spend.lastWeek?.cost ?? 0}
            sessions={spend.thisWeek?.sessions}
            tokens={spend.thisWeek?.tokens}
          />
          <SpendCard
            label="Last Week"
            current={spend.lastWeek?.cost ?? 0}
            previous={null}
            sessions={spend.lastWeek?.sessions}
            tokens={spend.lastWeek?.tokens}
          />
        </div>

        {/* Row 2: This Month / Last Month / This Year */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <SpendCard
            label="This Month"
            current={spend.thisMonth?.cost ?? 0}
            previous={spend.lastMonth?.cost ?? 0}
            sessions={spend.thisMonth?.sessions}
            tokens={spend.thisMonth?.tokens}
          />
          <SpendCard
            label="Last Month"
            current={spend.lastMonth?.cost ?? 0}
            previous={null}
            sessions={spend.lastMonth?.sessions}
            tokens={spend.lastMonth?.tokens}
          />
          <SpendCard
            label={`${new Date().getFullYear()} Total`}
            current={spend.thisYear?.cost ?? 0}
            previous={spend.lastYear?.cost ?? 0}
            sessions={spend.thisYear?.sessions}
            tokens={spend.thisYear?.tokens}
          />
        </div>

        {/* Per-source month breakdown — only in "All" mode with multiple sources */}
        {source === 'both' && spend.bySource && Object.keys(spend.bySource).length > 1 && (
          <div style={{
            marginTop: 12,
            padding: '12px 16px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            display: 'flex',
            gap: 32,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', marginRight: 8 }}>
              This month by source:
            </span>
            {Object.entries(spend.bySource).map(([src, d]) => (
              <div key={src} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: src === 'codex' ? 'oklch(0.65 0.18 260)' : 'var(--accent)' }}>
                  {src === 'codex' ? '⬡ Codex' : '◆ Claude'}
                </span>
                <span style={{ fontSize: 14, fontWeight: 300, color: 'var(--green)' }}>{formatCost(d.cost)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.sessions} sessions</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <DailyChart data={chartDailyData} title="Token Usage (last period)" />
        <ToolBreakdown data={toolData} title="Tool Distribution" />
      </div>

      {/* ── Spend history chart ── */}
      <SpendChart spendData={spend} source={source} />
    </div>
  );
}
