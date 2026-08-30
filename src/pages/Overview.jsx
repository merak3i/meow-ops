import { useMemo, useState } from 'react';
import { Activity, ArrowRight, Clock, DollarSign, Zap } from 'lucide-react';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import { Button, Card, Eyebrow, HelpTip, Scope, StatTile, ToggleGroup } from '../components/ui';
import { formatCost, formatDuration, formatTokens } from '../lib/format';
import { sourceMeta, sourceOptions } from '../lib/sources';
import {
  buildDailyFromSessions,
  computeOverviewStats,
  getProjectBreakdown,
  getToolBreakdownFromSessions,
} from '../lib/queries';

// Home — one screen that answers "what happened, and what did it cost".
//
// This page used to be ten stacked sections rendering cost in roughly fifteen
// places, six of which quietly ignored the date filter and read all-time
// rollups instead. Fixed-period spend now lives on Usage → Cost, where it is
// labelled as fixed-period. Everything on this screen obeys the date filter,
// and every figure states its scope.

function rangeLabel(dateRange) {
  if (dateRange === 'all') return 'All time';
  if (dateRange === '1h') return 'Last hour';
  if (dateRange === '24h') return 'Last 24 hours';
  return `Last ${dateRange} days`;
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

// ─── Where the tokens went, by source ────────────────────────────────────────

function SourceRows({ sessions, totalTokens }) {
  const rows = useMemo(() => {
    const acc = new Map();
    for (const session of sessions) {
      const key = session.source || 'claude';
      const row = acc.get(key) ?? { source: key, sessions: 0, tokens: 0, cost: 0, ghosts: 0 };
      row.sessions += 1;
      row.tokens += session.total_tokens || 0;
      row.cost += session.estimated_cost_usd || 0;
      if (session.is_ghost) row.ghosts += 1;
      acc.set(key, row);
    }
    return [...acc.values()].sort((a, b) => b.tokens - a.tokens);
  }, [sessions]);

  if (rows.length < 2) return null;

  return (
    <section className="mo-section">
      <div className="mo-section__head">
        <Eyebrow>By source</Eyebrow>
      </div>
      <Card>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          {rows.map((row) => {
            const meta = sourceMeta(row.source);
            const share = pct(row.tokens, totalTokens);
            const ghostRate = pct(row.ghosts, row.sessions);
            return (
              <div
                key={row.source}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(96px, 130px) minmax(0, 1fr) 76px 74px 78px',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  fontSize: 'var(--fs-ui)',
                }}
              >
                <span style={{ color: meta.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {meta.label}
                </span>
                <div style={{ height: 5, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${share}%`, background: meta.color, borderRadius: 4 }} />
                </div>
                <span className="mo-num" style={{ textAlign: 'right' }}>{formatTokens(row.tokens)}</span>
                <span className="mo-num" style={{ textAlign: 'right', color: 'var(--green)' }}>{formatCost(row.cost)}</span>
                <span
                  className="mo-num"
                  title={`${row.ghosts} of ${row.sessions} sessions produced no output`}
                  style={{ textAlign: 'right', color: ghostRate > 15 ? 'var(--red)' : 'var(--text-muted)' }}
                >
                  {ghostRate.toFixed(0)}% ghost
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}

// ─── Top projects ────────────────────────────────────────────────────────────

function TopProjects({ sessions, onNavigate }) {
  const rows = useMemo(
    () => getProjectBreakdown(sessions).slice(0, 5),
    [sessions],
  );
  if (rows.length === 0) return null;
  const peak = rows[0]?.tokens || 1;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <Eyebrow>Top projects</Eyebrow>
        <Button variant="ghost" size="sm" onClick={() => onNavigate('today', 'sessions')}>
          All projects <ArrowRight size={12} aria-hidden="true" />
        </Button>
      </div>
      <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        {rows.map((row) => (
          <div
            key={row.project}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 64px 66px',
              gap: 'var(--sp-3)',
              alignItems: 'center',
              fontSize: 'var(--fs-ui)',
            }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.project}>
              {row.project}
            </span>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct(row.tokens, peak)}%`, background: 'var(--data-1)', borderRadius: 3 }} />
            </div>
            <span className="mo-num" style={{ textAlign: 'right', color: 'var(--green)' }}>{formatCost(row.cost)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Token budget ────────────────────────────────────────────────────────────
// Only rendered once a budget exists. An empty budget widget on every load was
// prompting for configuration nobody asked for.

function parseTokens(input) {
  const value = String(input).trim().toUpperCase();
  const scale = value.endsWith('B') ? 1e9 : value.endsWith('M') ? 1e6 : value.endsWith('K') ? 1e3 : 1;
  return (parseFloat(value) || 0) * scale;
}

function BudgetRow({ label, used, limit, color }) {
  const share = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const over = limit > 0 && used > limit;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-meta)', marginBottom: 5 }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="mo-num" style={{ color: over ? 'var(--red)' : 'var(--text-secondary)' }}>
          {formatTokens(used)} of {formatTokens(limit)}
          {over ? ` · ${formatTokens(used - limit)} over` : ''}
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${share}%`, background: over ? 'var(--red)' : color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function BudgetPanel({ sourceStats, tokenBudget, onBudgetChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const tracked = Object.entries(tokenBudget ?? {})
    .filter(([source, limits]) => (limits.week > 0 || limits.month > 0) && sourceStats?.[source])
    .map(([source, limits]) => ({ source, limits, usage: sourceStats[source] }));

  if (tracked.length === 0) {
    if (!editing) {
      return (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
            <div>
              <Eyebrow>Token budget</Eyebrow>
              <p style={{ marginTop: 4, fontSize: 'var(--fs-ui)', color: 'var(--text-muted)' }}>
                Set a monthly ceiling and this becomes a burn gauge.
              </p>
            </div>
            <Button size="sm" onClick={() => setEditing(true)}>Set a budget</Button>
          </div>
        </Card>
      );
    }
    return (
      <Card>
        <Eyebrow>Monthly token budget for Claude Code</Eyebrow>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }}
            placeholder="e.g. 10B"
            aria-label="Monthly token budget"
            style={{
              flex: 1, padding: '6px 10px', background: 'var(--bg-page)',
              border: '1px solid var(--border-input)', borderRadius: 'var(--r-sm)',
              color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 'var(--fs-body)',
            }}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              const limit = parseTokens(draft);
              if (limit > 0) {
                onBudgetChange({ ...tokenBudget, claude: { ...tokenBudget.claude, month: limit } });
              }
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <Eyebrow>Token budget</Eyebrow>
        <Scope range="Calendar week and month" source="fixed periods" />
      </div>
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {tracked.map(({ source, limits, usage }) => {
          const meta = sourceMeta(source);
          return (
            <div key={source} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--fs-ui)', color: meta.color }}>{meta.label}</span>
              {limits.week > 0 && (
                <BudgetRow label="This week" used={usage.weekTokens} limit={limits.week} color={meta.color} />
              )}
              {limits.month > 0 && (
                <BudgetRow label="This month" used={usage.monthTokens} limit={limits.month} color={meta.color} />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Home ────────────────────────────────────────────────────────────────────

export default function Overview({
  sessions: rangeSessions = [],
  allSessions = [],
  dailyData,
  costSummary,
  dateRange = 30,
  sourceStats,
  tokenBudget,
  onBudgetChange,
  onNavigate,
}) {
  const [source, setSource] = useState('both');

  const presentSources = useMemo(() => {
    const seen = new Set(allSessions.map((session) => session.source || 'claude'));
    return [...seen].sort();
  }, [allSessions]);

  const sessions = useMemo(
    () => (source === 'both' ? rangeSessions : rangeSessions.filter((s) => (s.source || 'claude') === source)),
    [rangeSessions, source],
  );

  // All-time rollups only apply when nothing is filtered out; otherwise the
  // in-memory range is the honest source.
  const stats = useMemo(() => {
    const local = computeOverviewStats(sessions, dateRange);
    if (source !== 'both') return local;

    if (typeof dateRange === 'number' && dailyData?.length) {
      const complete = dailyData.reduce((acc, day) => {
        acc.sessions += day.session_count || 0;
        acc.tokens += day.total_tokens || 0;
        acc.cost += day.estimated_cost_usd || 0;
        acc.duration += day.total_duration_seconds || 0;
        acc.ghosts += day.ghost_count || 0;
        return acc;
      }, { sessions: 0, tokens: 0, cost: 0, duration: 0, ghosts: 0 });
      return {
        ...local,
        periodSessions: complete.sessions,
        periodTokens: complete.tokens,
        periodCost: complete.cost,
        periodDuration: complete.duration,
        ghostCount: complete.ghosts,
        sessionsToday: costSummary?.today?.sessions ?? local.sessionsToday,
        costToday: costSummary?.today?.cost ?? local.costToday,
      };
    }

    if (dateRange === 'all' && costSummary?.allTime) {
      const complete = costSummary.allTime;
      return {
        ...local,
        periodSessions: complete.sessions || 0,
        periodTokens: complete.tokens || 0,
        periodCost: complete.cost || 0,
        periodDuration: complete.duration_seconds || 0,
        ghostCount: complete.ghost_count || 0,
        sessionsToday: costSummary.today?.sessions ?? local.sessionsToday,
        costToday: costSummary.today?.cost ?? local.costToday,
      };
    }

    return local;
  }, [sessions, dateRange, costSummary, source, dailyData]);

  const chartData = useMemo(
    () => (source === 'both' ? dailyData : buildDailyFromSessions(sessions)),
    [source, sessions, dailyData],
  );
  const toolData = useMemo(() => getToolBreakdownFromSessions(sessions), [sessions]);

  // Rollup-backed figures cover every session ever parsed. Anything computed
  // from the in-memory array is capped at the compatibility preview.
  const fromArchive = source === 'both'
    && (dateRange === 'all' ? Boolean(costSummary?.allTime) : Boolean(dailyData?.length));

  const range = rangeLabel(dateRange);
  const sourceScope = source === 'both' ? 'All sources' : sourceMeta(source).label;
  const completeness = fromArchive ? 'archive' : 'preview';
  const scope = <Scope range={range} source={sourceScope} completeness={completeness} />;

  const ghostRate = pct(stats.ghostCount ?? 0, stats.periodSessions);

  return (
    <>
      {presentSources.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--sp-4)' }}>
          <ToggleGroup
            value={source}
            onChange={setSource}
            options={sourceOptions(presentSources)}
            size="sm"
            ariaLabel="Filter by source"
          />
        </div>
      )}

      <div className="mo-grid mo-grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        <StatTile
          label="Sessions"
          value={stats.periodSessions.toLocaleString()}
          scope={scope}
          sub={`${stats.sessionsToday} today`}
          icon={Activity}
        />
        <StatTile
          label="Tokens"
          value={formatTokens(stats.periodTokens)}
          scope={scope}
          icon={Zap}
          tone="var(--cyan)"
        />
        <StatTile
          label="Cost"
          value={formatCost(stats.periodCost)}
          scope={scope}
          sub={`${formatCost(stats.costToday)} today`}
          icon={DollarSign}
          tone="var(--green)"
          help="cost-estimate"
        />
        <StatTile
          label="Time"
          value={formatDuration(stats.periodDuration || 0)}
          scope={scope}
          sub={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {ghostRate.toFixed(0)}% ghost
              <HelpTip term="ghost-rate" />
            </span>
          }
          icon={Clock}
        />
      </div>

      <SourceRows sessions={sessions} totalTokens={stats.periodTokens} />

      <div className="mo-grid mo-grid--2" style={{ marginBottom: 'var(--sp-5)' }}>
        <DailyChart data={chartData} title={`Tokens per day — ${range.toLowerCase()}`} />
        <ToolBreakdown data={toolData} title="Tools your agents reached for" />
      </div>

      <div className="mo-grid mo-grid--2">
        <TopProjects sessions={sessions} onNavigate={onNavigate} />
        <BudgetPanel
          sourceStats={sourceStats}
          tokenBudget={tokenBudget}
          onBudgetChange={onBudgetChange}
        />
      </div>
    </>
  );
}
