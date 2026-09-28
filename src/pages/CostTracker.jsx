import { useMemo } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, TrendingUp, CalendarRange } from 'lucide-react';
import ModelBadge from '../components/ModelBadge';
import SpendChart from '../components/SpendChart';
import CursorRequestUsage from '../components/CursorRequestUsage';
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
  const cursorKinds = Array.isArray(cursor?.by_kind) ? cursor.by_kind : [];
  const cursorTotals = cursor?.totals;
  const hermesModels = Array.isArray(hermes?.by_model) ? hermes.by_model : [];
  const hasCursorReport = cursor?.enabled === true && Number(cursorTotals?.events) > 0;
  const hasCursor = cursor?.enabled === true && (cursorModels.length > 0 || hasCursorReport);
  const hasHermes = hermes && hermes.status === 'ok' && hermesModels.length > 0;
  if (!hasCursor && !hasHermes) return null;
  const cursorPeriod = cursor?.period
    && Number.isFinite(Number(cursor.period.startDate))
    && Number.isFinite(Number(cursor.period.endDate))
    ? `${new Date(Number(cursor.period.startDate)).toISOString()} to ${new Date(Number(cursor.period.endDate)).toISOString()}`
    : null;

  const rows = [
    ...cursorModels.map((row) => ({
      key: `cursor:${row.key}`,
      source: 'cursor',
      model: String(row.key ?? 'unknown'),
      tokens: Number(row.total_tokens) || 0,
      cost: Number(row.estimated_cost_usd) || 0,
    })),
    ...hermesModels.map((row) => ({
      key: `hermes:${row.key || `${row.provider || 'unknown'}:${row.model}:${row.billing_mode || ''}`}`,
      source: 'hermes',
      model: String(row.model ?? 'unknown'),
      tokens: Number(row.total_tokens) || 0,
      cost: Number(row.estimated_cost_usd) || 0,
    })),
  ].sort((a, b) => b.cost - a.cost);

  return (
    <section className="mo-section">
      <div className="mo-section__head">
        <Eyebrow>Provider-reported usage</Eyebrow>
        <Scope source="Cursor and Hermes account usage" />
      </div>
      <Card>
        {hasCursorReport && (
          <div aria-label="Cursor Admin API billing summary" style={{ marginBottom: 'var(--sp-4)' }}>
            <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)', lineHeight: 1.6 }}>
              Cursor Admin API returned {Number(cursorTotals.events).toLocaleString()} events{cursorPeriod ? ` for ${cursorPeriod}` : ''}. `chargedCents` totals {formatCost((Number(cursorTotals.charged_cents) || 0) / 100)} across {Number(cursorTotals.charged_cents_events || 0).toLocaleString()} events with that field. Token model cost is {formatCost((Number(cursorTotals.token_model_cost_cents) || 0) / 100)} across {Number(cursorTotals.token_model_cost_events || 0).toLocaleString()} events with token cost; Cursor Token Rate is {formatCost((Number(cursorTotals.cursor_token_fee_cents) || 0) / 100)} across {Number(cursorTotals.cursor_token_fee_events || 0).toLocaleString()} events with that fee; request units total {Number(cursorTotals.requests_cost_units || 0).toLocaleString()} across {Number(cursorTotals.requests_cost_events || 0).toLocaleString()} events with request units.
            </p>
            <p style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)', lineHeight: 1.6 }}>
              API flags: {Number(cursorTotals.chargeable_true_events || 0).toLocaleString()} chargeable, {Number(cursorTotals.chargeable_false_events || 0).toLocaleString()} marked not chargeable, {Number(cursorTotals.chargeable_unknown_events || 0).toLocaleString()} unreported. The API's `chargedCents` amount is totaled independently of `isChargeable`; raw events, emails, and identifiers are not kept in this summary.
            </p>
            {cursorKinds.length > 0 && (
              <div role="region" aria-label="Cursor billing categories" tabIndex={0} style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 'var(--fs-ui)' }}>
                  <thead><tr>
                    <th scope="col" style={{ textAlign: 'left' }}>Billing category</th>
                    <th scope="col">Events</th>
                    <th scope="col">Request units</th>
                    <th scope="col">chargedCents / events</th>
                  </tr></thead>
                  <tbody>{cursorKinds.map((row) => (
                    <tr key={row.key} style={{ borderTop: '1px solid var(--border)' }}>
                      <th scope="row" style={{ textAlign: 'left', fontWeight: 400, paddingBlock: 'var(--sp-2)' }}>{String(row.key ?? 'unknown')}</th>
                      <td className="mo-num" style={{ textAlign: 'center' }}>{Number(row.events || 0).toLocaleString()}</td>
                      <td className="mo-num" style={{ textAlign: 'center' }}>{Number(row.requests_cost_units || 0).toLocaleString()}</td>
                      <td className="mo-num" style={{ textAlign: 'right' }}>{formatCost((Number(row.charged_cents) || 0) / 100)} / {Number(row.charged_cents_events || 0).toLocaleString()}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)', maxWidth: '68ch', lineHeight: 1.6 }}>
          Only usage that could not be matched to a local session appears in the breakdown below.
          These provider figures stay separate from project totals.
        </p>
        <div role="region" aria-label="Provider usage breakdown" tabIndex={0} style={{ display: 'grid', gap: 'var(--sp-2)', overflowX: 'auto' }}>
          {rows.map((row) => (
            <div
              key={row.key}
              style={{
                display: 'grid',
                minWidth: 420,
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
          <div role="region" aria-label="Model cost breakdown" tabIndex={0} style={{ overflowX: 'auto' }}>
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
          </div>
        </Card>
      </section>

      <UnattributedUsage cursor={costSummary?.cursorUsage} hermes={costSummary?.hermesModelUsage} />
      <CursorRequestUsage />

      <p style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
        Session cost estimates use token counts and published prices. Provider reports and Cursor request counts are labeled separately.
        <HelpTip term="cost-estimate" />
      </p>
    </>
  );
}
