import { useMemo } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, TrendingUp, CalendarRange } from 'lucide-react';
import ModelBadge from '../components/ModelBadge';
import SpendChart from '../components/SpendChart';
import { Card, Eyebrow, HelpTip, Scope, StatTile } from '../components/ui';
import { formatCost, formatTokens } from '../lib/format';
import { sourceMeta } from '../lib/sources';
import { computeSpendBreakdown } from '../lib/queries';

// Cost — the one place fixed-period spend lives.
//
// Home used to render Today / This Week / This Month / This Year cards that
// silently ignored the date filter sitting directly above them. They moved
// here, where the page can say plainly which figures follow the filter and
// which are calendar periods.

const IST = 'Asia/Kolkata';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="mo-card" style={{ padding: '8px 12px' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-meta)', marginBottom: 3 }}>{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color, fontSize: 'var(--fs-ui)' }}>
          {entry.name}: {formatCost(entry.value)}
        </p>
      ))}
    </div>
  );
}

const axis = { fill: 'var(--text-muted)', fontSize: 10 };

function PeriodCard({ label, current, previous, sessions, tokens, highlight }) {
  const delta = previous > 0 ? ((current - previous) / previous) * 100 : null;
  const moved = delta !== null && Math.abs(delta) > 0.5;
  const up = moved && delta > 0;

  return (
    <Card style={highlight ? { borderColor: 'var(--accent)' } : undefined}>
      <span className="mo-eyebrow">{label}</span>
      <div className="mo-num" style={{ fontSize: 22, fontWeight: 300, color: 'var(--green)', marginTop: 5 }}>
        {formatCost(current)}
      </div>
      <div style={{ marginTop: 4, fontSize: 'var(--fs-meta)', color: 'var(--text-muted)', display: 'flex', gap: 'var(--sp-2)' }}>
        {sessions != null && <span>{sessions} sessions · {formatTokens(tokens ?? 0)}</span>}
        {moved && (
          <span style={{ marginLeft: 'auto', color: up ? 'var(--red)' : 'var(--green)' }}>
            {up ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
    </Card>
  );
}

// Usage a provider reported at the account level that could not be matched to
// a local session. Shown separately so it is never folded into project totals.
function UnattributedUsage({ cursor, hermes }) {
  const cursorModels = Array.isArray(cursor?.unmatched?.by_model) ? cursor.unmatched.by_model : [];
  const hermesModels = Array.isArray(hermes?.by_model) ? hermes.by_model : [];
  const hasCursor = cursor?.enabled === true && cursorModels.length > 0;
  const hasHermes = hermes && hermes.status === 'ok' && hermesModels.length > 0;
  if (!hasCursor && !hasHermes) return null;

  const rows = [
    ...cursorModels.map((row) => ({
      key: `cursor:${row.key}`,
      source: 'cursor',
      model: String(row.key ?? 'unknown'),
      tokens: Number(row.total_tokens) || 0,
      cost: Number(row.estimated_cost_usd) || 0,
    })),
    ...hermesModels.map((row) => ({
      key: `hermes:${row.model}`,
      source: 'hermes',
      model: String(row.model ?? 'unknown'),
      tokens: Number(row.total_tokens) || 0,
      cost: Number(row.estimated_cost_usd) || 0,
    })),
  ].sort((a, b) => b.cost - a.cost);

  return (
    <section className="mo-section">
      <div className="mo-section__head">
        <Eyebrow>Reported by provider, not matched to a session</Eyebrow>
        <Scope source="Cursor and Hermes account usage" />
      </div>
      <Card>
        <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)', maxWidth: '68ch', lineHeight: 1.6 }}>
          These providers report usage at the account level without a session identifier, so it is
          counted here and never attributed to a project or a local session.
        </p>
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {rows.map((row) => (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(90px, 120px) minmax(0, 1fr) 80px 72px',
                gap: 'var(--sp-3)',
                fontSize: 'var(--fs-ui)',
                alignItems: 'center',
              }}
            >
              <span style={{ color: sourceMeta(row.source).color }}>{sourceMeta(row.source).label}</span>
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.model}
              </span>
              <span className="mo-num" style={{ textAlign: 'right' }}>{formatTokens(row.tokens)}</span>
              <span className="mo-num" style={{ textAlign: 'right', color: 'var(--green)' }}>{formatCost(row.cost)}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

export default function CostTracker({ dailyData = [], modelData = [], stats, costSummary, allSessions = [], dateRange = 30 }) {
  const fromArchive = Boolean(costSummary?.allTime);
  const totalCost = costSummary?.allTime?.cost ?? stats?.totalCost ?? 0;
  const totalSessions = costSummary?.allTime?.sessions ?? stats?.totalSessions ?? 0;

  const cumulative = useMemo(() => {
    const source = costSummary?.daily_summary ?? dailyData;
    return source.reduce((rows, day) => {
      const previous = rows.length > 0 ? rows[rows.length - 1].cumulative : 0;
      rows.push({ ...day, cumulative: previous + (day.estimated_cost_usd || 0) });
      return rows;
    }, []);
  }, [costSummary, dailyData]);

  // Trailing 7 active days rather than the whole range: a 90-day filter should
  // not drag the projection down with months you were not working.
  const projectedMonthly = useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: IST });
    // eslint-disable-next-line react-hooks/purity -- Projection intentionally uses the current wall-clock date.
    const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: IST });
    const recent = dailyData.filter((day) => day.date >= weekAgo && day.date <= today);
    const active = recent.filter((day) => day.estimated_cost_usd > 0);
    if (active.length === 0) {
      const mean = dailyData.length
        ? dailyData.reduce((sum, day) => sum + (day.estimated_cost_usd || 0), 0) / dailyData.length
        : 0;
      return mean * 30;
    }
    return (active.reduce((sum, day) => sum + (day.estimated_cost_usd || 0), 0) / active.length) * 30;
  }, [dailyData]);

  const avgDaily = useMemo(() => {
    const active = dailyData.filter((day) => day.estimated_cost_usd > 0);
    return active.length
      ? active.reduce((sum, day) => sum + (day.estimated_cost_usd || 0), 0) / active.length
      : 0;
  }, [dailyData]);

  const spend = useMemo(() => {
    if (costSummary?.thisMonth) {
      const local = computeSpendBreakdown(allSessions);
      return {
        today: costSummary.today,
        thisWeek: costSummary.thisWeek,
        lastWeek: costSummary.lastWeek,
        thisMonth: costSummary.thisMonth,
        lastMonth: costSummary.lastMonth,
        thisYear: costSummary.thisYear,
        lastYear: costSummary.lastYear ?? null,
        bySource: costSummary.bySource,
        // History arrays are only computed locally; the rollup does not carry them.
        weeklyHistory: local.weeklyHistory,
        monthlyHistory: local.monthlyHistory,
      };
    }
    return computeSpendBreakdown(allSessions);
  }, [costSummary, allSessions]);

  const rangeLabel = dateRange === 'all' ? 'All time' : dateRange === '1h' ? 'Last hour'
    : dateRange === '24h' ? 'Last 24 hours' : `Last ${dateRange} days`;
  const completeness = fromArchive ? 'archive' : 'preview';

  return (
    <>
      <div className="mo-grid mo-grid--3" style={{ marginBottom: 'var(--sp-5)' }}>
        <StatTile
          label="Total spend"
          value={formatCost(totalCost)}
          scope={<Scope range="All time" source="All sources" completeness={completeness} />}
          sub={`${totalSessions.toLocaleString()} sessions`}
          icon={DollarSign}
          tone="var(--green)"
          help="cost-estimate"
        />
        <StatTile
          label="Per active day"
          value={formatCost(avgDaily)}
          scope={<Scope range={rangeLabel} source="Days with any activity" />}
          icon={TrendingUp}
          tone="var(--amber)"
        />
        <StatTile
          label="Projected month"
          value={formatCost(projectedMonthly)}
          scope={<Scope range="Trailing 7 active days, times 30" />}
          icon={CalendarRange}
        />
      </div>

      <section className="mo-section">
        <div className="mo-section__head">
          <Eyebrow>Calendar periods</Eyebrow>
          <Scope ignoresDateFilter />
        </div>
        <div className="mo-grid mo-grid--3" style={{ marginBottom: 'var(--sp-3)' }}>
          <PeriodCard
            label="Today"
            current={spend.today?.cost ?? 0}
            previous={null}
            sessions={spend.today?.sessions}
            tokens={spend.today?.tokens}
            highlight
          />
          <PeriodCard
            label="This week"
            current={spend.thisWeek?.cost ?? 0}
            previous={spend.lastWeek?.cost ?? 0}
            sessions={spend.thisWeek?.sessions}
            tokens={spend.thisWeek?.tokens}
          />
          <PeriodCard
            label="Last week"
            current={spend.lastWeek?.cost ?? 0}
            previous={null}
            sessions={spend.lastWeek?.sessions}
            tokens={spend.lastWeek?.tokens}
          />
        </div>
        <div className="mo-grid mo-grid--3">
          <PeriodCard
            label="This month"
            current={spend.thisMonth?.cost ?? 0}
            previous={spend.lastMonth?.cost ?? 0}
            sessions={spend.thisMonth?.sessions}
            tokens={spend.thisMonth?.tokens}
          />
          <PeriodCard
            label="Last month"
            current={spend.lastMonth?.cost ?? 0}
            previous={null}
            sessions={spend.lastMonth?.sessions}
            tokens={spend.lastMonth?.tokens}
          />
          <PeriodCard
            label={`${new Date().getFullYear()} so far`}
            current={spend.thisYear?.cost ?? 0}
            previous={spend.lastYear?.cost ?? 0}
            sessions={spend.thisYear?.sessions}
            tokens={spend.thisYear?.tokens}
          />
        </div>
      </section>

      <div className="mo-grid mo-grid--2" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card>
          <div className="mo-section__head">
            <Eyebrow>Cost per day</Eyebrow>
            <Scope range={rangeLabel} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--green)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={axis} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `$${v.toFixed(2)}`} tick={axis} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="estimated_cost_usd" name="Cost" stroke="var(--green)" fill="url(#costGrad)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div className="mo-section__head">
            <Eyebrow>Cumulative</Eyebrow>
            <Scope range="All time" completeness={costSummary?.daily_summary ? 'archive' : 'preview'} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cumulative}>
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={axis} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `$${v.toFixed(0)}`} tick={axis} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="cumulative" name="Total" stroke="var(--amber)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <section className="mo-section">
        <SpendChart spendData={spend} />
      </section>

      <section className="mo-section">
        <div className="mo-section__head">
          <Eyebrow>By model</Eyebrow>
          <Scope range="All time" completeness={completeness} />
        </div>
        <Card pad={false}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-ui)' }}>
            <thead>
              <tr>
                {['Model', 'Sessions', 'Tokens', 'Cost', 'Share'].map((heading, index) => (
                  <th
                    key={heading}
                    className="mo-eyebrow"
                    style={{ padding: '10px 14px', textAlign: index === 0 ? 'left' : 'right' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelData.map((row) => (
                <tr key={row.model} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '9px 14px' }}><ModelBadge model={row.model} /></td>
                  <td className="mo-num" style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)' }}>{row.sessions}</td>
                  <td className="mo-num" style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)' }}>{formatTokens(row.tokens)}</td>
                  <td className="mo-num" style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--green)' }}>{formatCost(row.cost)}</td>
                  <td className="mo-num" style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {totalCost > 0 ? ((row.cost / totalCost) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <UnattributedUsage cursor={costSummary?.cursorUsage} hermes={costSummary?.hermesModelUsage} />

      <p style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
        Every figure here is estimated from token counts and published prices.
        <HelpTip term="cost-estimate" />
      </p>
    </>
  );
}
