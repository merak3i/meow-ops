import { useState, useMemo } from 'react';
import { Activity, Zap, DollarSign, FolderKanban, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import StatCard from '../components/StatCard';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import SpendChart from '../components/SpendChart';
import { formatTokens, formatCost } from '../lib/format';
import { computeOverviewStats, computeSpendBreakdown, getToolBreakdownFromSessions } from '../lib/queries';

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
            transition: 'all 0.15s',
            fontWeight: value === id ? 500 : 400,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Spend mini-card ─────────────────────────────────────────────────────────
function SpendCard({ label, current, previous }) {
  const pct = previous > 0
    ? ((current - previous) / previous) * 100
    : null;
  const up = pct !== null && pct > 0.5;
  const dn = pct !== null && pct < -0.5;
  const TrendIcon = up ? TrendingUp : dn ? TrendingDown : Minus;
  const trendColor = up ? 'var(--red, #f87171)' : dn ? 'var(--green)' : 'var(--text-muted)';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 300, color: 'var(--green)' }}>
        {formatCost(current)}
      </span>
      {pct !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: trendColor }}>
          <TrendIcon size={12} />
          {Math.abs(pct).toFixed(0)}% vs prev period
        </div>
      )}
    </div>
  );
}

function periodLabel(dateRange) {
  if (dateRange === 'all') return 'All time';
  if (dateRange === 7)  return '7 days';
  if (dateRange === 30) return '30 days';
  if (dateRange === 90) return '90 days';
  return `${dateRange} days`;
}

export default function Overview({
  stats: rawStats,
  sessions: rawSessions = [],
  allSessions: rawAllSessions = [],
  dailyData,
  toolData: rawToolData,
  spendData: rawSpendData,
  dateRange = 30,
}) {
  const [source, setSource] = useState('both');

  // Detect if any Codex sessions exist — only show toggle when both sources present.
  const hasCodex = useMemo(
    () => rawAllSessions.some((s) => s.source === 'codex'),
    [rawAllSessions],
  );

  // Filter sessions by source.
  const filterBySrc = (list) =>
    source === 'both' ? list : list.filter((s) => (s.source || 'claude') === source);

  const sessions    = useMemo(() => filterBySrc(rawSessions),    [rawSessions,    source]);
  const allSessions = useMemo(() => filterBySrc(rawAllSessions), [rawAllSessions, source]);

  // Recompute stats and spend breakdown when source filter changes.
  const stats    = useMemo(() => computeOverviewStats(sessions, dateRange),   [sessions, dateRange]);
  const toolData = useMemo(() => getToolBreakdownFromSessions(sessions),       [sessions]);
  const spendData = useMemo(() => computeSpendBreakdown(allSessions),          [allSessions]);

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

      {/* ── Spend breakdown mini-cards ── */}
      <div style={{ marginBottom: 24 }}>
        <p style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          Spend breakdown
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <SpendCard label="This week"  current={spendData.thisWeek}  previous={spendData.lastWeek}  />
          <SpendCard label="Last week"  current={spendData.lastWeek}  previous={null}               />
          <SpendCard label="This month" current={spendData.thisMonth} previous={spendData.lastMonth} />
          <SpendCard label="Last month" current={spendData.lastMonth} previous={null}               />
        </div>
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <DailyChart data={dailyData} title="Token Usage (last period)" />
        <ToolBreakdown data={toolData} title="Tool Distribution" />
      </div>

      {/* ── Spend history chart ── */}
      <SpendChart spendData={spendData} source={source} />
    </div>
  );
}
