import { useState, useMemo } from 'react';
import { Activity, Zap, DollarSign, FolderKanban, TrendingUp, TrendingDown, Minus, SquareCode, Code2, Pencil, Check, X } from 'lucide-react';
import StatCard from '../components/StatCard';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import SpendChart from '../components/SpendChart';
import { Eyebrow } from '../components/ui/Eyebrow';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { formatTokens, formatCost } from '../lib/format';
import {
  computeOverviewStats,
  computeSpendBreakdown,
  getToolBreakdownFromSessions,
  buildDailyFromSessions,
} from '../lib/queries';

// ─── Source filter toggle ─────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { value: 'both',   label: 'All' },
  { value: 'claude', label: '◆ Claude' },
  { value: 'codex',  label: '⬡ Codex' },
];

function SourceToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source</span>
      <ToggleGroup
        value={value}
        onChange={onChange}
        options={SOURCE_OPTIONS}
        size="sm"
        ariaLabel="Session source"
      />
    </div>
  );
}

// ─── Source comparison panel ──────────────────────────────────────────────────
function SourceComparisonPanel({ allSessions }) {
  const stats = useMemo(() => {
    const acc = {
      claude: { sessions: 0, cost: 0, tokens: 0, ghosts: 0 },
      codex:  { sessions: 0, cost: 0, tokens: 0, ghosts: 0 },
    };
    allSessions.forEach(s => {
      const src = s.source === 'codex' ? 'codex' : 'claude';
      acc[src].sessions++;
      acc[src].cost   += s.estimated_cost_usd || 0;
      acc[src].tokens += s.total_tokens || 0;
      if (s.is_ghost) acc[src].ghosts++;
    });
    return acc;
  }, [allSessions]);

  const total = stats.claude.sessions + stats.codex.sessions;
  if (total === 0 || stats.codex.sessions === 0) return null;

  const rows = [
    { key: 'claude', label: 'Claude',  sigil: '◆', color: 'var(--accent)',          icon: SquareCode },
    { key: 'codex',  label: 'Codex',   sigil: '⬡', color: 'oklch(0.65 0.18 260)', icon: Code2      },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <Eyebrow style={{ marginBottom: 10 }}>Source Breakdown</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {rows.map(({ key, label, sigil, color, icon: Icon }) => {
          const s   = stats[key];
          const pct = total > 0 ? (s.sessions / total) * 100 : 0;
          const avgCost = s.sessions > 0 ? s.cost / s.sessions : 0;
          const ghostRate = s.sessions > 0 ? (s.ghosts / s.sessions) * 100 : 0;
          return (
            <div key={key} style={{
              background: 'var(--bg-card)',
              border: `1px solid var(--border)`,
              borderRadius: 10,
              padding: '14px 16px',
              borderTop: `2px solid ${color}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Icon size={14} color={color} />
                <span style={{ fontSize: 13, fontWeight: 500, color }}>
                  {sigil} {label}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {pct.toFixed(1)}% of sessions
                </span>
              </div>

              {/* Share bar */}
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color,
                  borderRadius: 2, transition: 'width 0.5s ease' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Sessions',  value: s.sessions.toLocaleString() },
                  { label: 'Tokens',    value: formatTokens(s.tokens) },
                  { label: 'Total Cost',value: formatCost(s.cost), accent: 'var(--green)' },
                  { label: 'Avg/Session',value: formatCost(avgCost) },
                  { label: 'Ghost Rate', value: `${ghostRate.toFixed(1)}%`,
                    accent: ghostRate > 15 ? 'var(--red)' : 'var(--text-muted)' },
                ].map(({ label: lbl, value, accent }) => (
                  <div key={lbl}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase',
                      letterSpacing: '0.08em', marginBottom: 2 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: 300, color: accent ?? 'var(--text-primary)' }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Token quota helpers ──────────────────────────────────────────────────────
function fmtTok(n) {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function parseTok(str) {
  const s = String(str).trim().toUpperCase();
  if (s.endsWith('B')) return parseFloat(s) * 1e9;
  if (s.endsWith('M')) return parseFloat(s) * 1e6;
  if (s.endsWith('K')) return parseFloat(s) * 1e3;
  return parseFloat(s) || 0;
}

// Per-period (week or month) quota row for Overview cards
function QuotaBand({ period, used, budget, color, srcKey, onSetBudget }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');

  const hasBudget = budget > 0;
  const pct       = hasBudget ? Math.min(100, (used / budget) * 100) : 0;
  const remaining = hasBudget ? budget - used : 0;
  const isOver    = hasBudget && used > budget;

  function commit() {
    const v = parseTok(draft);
    if (v > 0) onSetBudget(srcKey, period, v);
    setEditing(false);
  }

  const periodLabel = period === 'week' ? 'This Week' : 'This Month';

  return (
    <div style={{
      background: 'var(--bg-page)',
      border: `1px solid ${isOver ? 'rgba(248,113,113,0.3)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {periodLabel}
        </span>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
              placeholder="e.g. 10B"
              style={{
                width: 64, fontSize: 11, background: 'var(--bg-card)',
                border: '1px solid var(--accent)', borderRadius: 4,
                color: 'var(--text-primary)', padding: '2px 6px', outline: 'none',
              }}
            />
            <button onClick={commit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: 0 }}>
              <Check size={12} />
            </button>
            <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setDraft(hasBudget ? fmtTok(budget) : ''); setEditing(true); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 10,
            }}
          >
            <Pencil size={10} />
            {hasBudget ? `limit: ${fmtTok(budget)}` : 'set limit'}
          </button>
        )}
      </div>

      {/* Tokens used — large number */}
      <div style={{ fontSize: 22, fontWeight: 300, color: isOver ? '#f87171' : color, lineHeight: 1.1, marginBottom: 6 }}>
        {fmtTok(used)}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>tokens</span>
      </div>

      {hasBudget ? (
        <>
          {/* Progress bar */}
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 3, marginBottom: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: isOver ? '#f87171' : color,
              borderRadius: 3, transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>{pct.toFixed(0)}% of {fmtTok(budget)}</span>
            <span style={{ color: isOver ? '#f87171' : 'var(--green)', fontWeight: 500 }}>
              {isOver ? `${fmtTok(used - budget)} over budget` : `${fmtTok(remaining)} left`}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No limit set — click pencil to add one
        </div>
      )}
    </div>
  );
}

// ─── Token quota panel per connected model/source ─────────────────────────────
function TokenQuotaPanel({ sourceStats, tokenBudget, onBudgetChange }) {
  if (!sourceStats || !tokenBudget) return null;
  const { claude, codex } = sourceStats;
  const totalSess = claude.sessions + codex.sessions;
  if (totalSess === 0) return null;

  const anyBudget = Object.values(tokenBudget).some(b => b.week > 0 || b.month > 0);
  // Show if multi-source OR if user has set any budget
  if (!anyBudget && codex.sessions === 0) return null;

  function handleSet(src, period, value) {
    onBudgetChange({ ...tokenBudget, [src]: { ...tokenBudget[src], [period]: value } });
  }

  const sources = [
    { key: 'claude', label: 'Claude', sigil: '◆', color: 'var(--accent)',          ...claude },
    { key: 'codex',  label: 'Codex',  sigil: '⬡', color: 'oklch(0.65 0.18 260)',   ...codex },
  ].filter(s => s.sessions > 0);

  return (
    <div style={{ marginBottom: 24 }}>
      <Eyebrow style={{ marginBottom: 10 }}>Token Quota</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sources.length}, 1fr)`, gap: 12 }}>
        {sources.map(({ key, label, sigil, color, weekTokens, monthTokens, weekSessions, monthSessions }) => {
          const budget = tokenBudget[key] || { week: 0, month: 0 };
          return (
            <div key={key} style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '14px 16px',
              borderTop: `2px solid ${color}`,
            }}>
              {/* Source header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color }}>{sigil} {label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {weekSessions} sessions this week · {monthSessions} this month
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <QuotaBand
                  period="week" used={weekTokens} budget={budget.week}
                  color={color} srcKey={key} onSetBudget={handleSet}
                />
                <QuotaBand
                  period="month" used={monthTokens} budget={budget.month}
                  color={color} srcKey={key} onSetBudget={handleSet}
                />
              </div>
            </div>
          );
        })}
      </div>
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
  sourceStats,
  tokenBudget,
  onBudgetChange,
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

      {/* ── Source comparison (only when Codex data exists) ── */}
      {source === 'both' && <SourceComparisonPanel allSessions={allSessions} />}

      {/* ── Token quota per source ── */}
      {sourceStats && tokenBudget && onBudgetChange && (
        <TokenQuotaPanel
          sourceStats={sourceStats}
          tokenBudget={tokenBudget}
          onBudgetChange={onBudgetChange}
        />
      )}

      {/* ── Spend breakdown cards ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Eyebrow>Cost Breakdown</Eyebrow>
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
