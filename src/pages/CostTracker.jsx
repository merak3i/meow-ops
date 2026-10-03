import { useMemo } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, TrendingUp, CalendarRange } from 'lucide-react';
import ModelBadge from '../components/ModelBadge';
import SpendChart from '../components/SpendChart';
import CursorRequestUsage from '../components/CursorRequestUsage';
import { Card, Eyebrow, HelpTip, Scope, StatTile } from '../components/ui';
import { formatCost, formatTokens } from '../lib/format';
import { sourceMeta } from '../lib/sources';
import { computeSpendBreakdown, isDemoData, summarizeCosts } from '../lib/queries';

// Cost — the one place fixed-period spend lives.
//
// Home used to render Today / This Week / This Month / This Year cards that
// silently ignored the date filter sitting directly above them. They moved
// here, where the page can say plainly which figures follow the filter and
// which are calendar periods.

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
  const delta = current != null && previous > 0 ? ((current - previous) / previous) * 100 : null;
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
  const hasCursorReport = Number(cursorTotals?.events) > 0;
  const hasCursor = Boolean(cursor) && (cursorModels.length > 0 || hasCursorReport || cursor.status !== 'skipped');
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
      cost: row.estimated_cost_usd,
      observed: row.observed_cost_usd,
    })),
    ...hermesModels.map((row) => ({
      key: `hermes:${row.key || `${row.provider || 'unknown'}:${row.model}:${row.billing_mode || ''}`}`,
      source: 'hermes',
      model: String(row.model ?? 'unknown'),
      tokens: Number(row.total_tokens) || 0,
      cost: row.estimated_cost_usd,
      observed: row.actual_cost_usd,
    })),
  ].sort((a, b) => (b.observed ?? b.cost ?? 0) - (a.observed ?? a.cost ?? 0));

  return (
    <section className="mo-section">
      <div className="mo-section__head">
        <Eyebrow>Provider-reported usage</Eyebrow>
        <Scope source="Cursor and Hermes account usage" />
      </div>
      <Card>
        {hasCursor && (
          <p role="status" style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-3)' }}>
            Cursor analytics: {cursor.status === 'ok' ? 'latest verified response' : cursor.status === 'cached' ? 'using the verified hourly cache' : cursor.status === 'missing-credential' ? 'team Admin API key unavailable' : 'refresh unavailable'}.
            {cursor.history?.freshness === 'retained' && ' Previously verified usage is retained; it does not establish current usage.'}
            {cursor.history?.last_success_at && ` Last verified: ${new Date(cursor.history.last_success_at).toLocaleString()}.`}
            {' '}Local transcripts do not establish account billing. Per-bot billing is unavailable without an official export that identifies the bot.
          </p>
        )}
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
          Cursor rows contain usage not matched to a local session. Hermes rows contain model usage reported by Hermes and can overlap its sessions.
          These figures stay separate from project totals. Each row labels its estimate and observed charge independently.
        </p>
        <div role="region" aria-label="Provider usage breakdown" tabIndex={0} style={{ display: 'grid', gap: 'var(--sp-2)', overflowX: 'auto' }}>
          {rows.map((row) => (
            <div
              key={row.key}
              style={{
                display: 'grid',
                minWidth: 570,
                gridTemplateColumns: 'minmax(90px, 120px) minmax(0, 1fr) 80px 130px 130px',
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
              <span className="mo-num" style={{ textAlign: 'right', color: 'var(--green)' }}>Estimate: {formatCost(row.cost)}</span>
              <span className="mo-num" style={{ textAlign: 'right' }}>Observed: {formatCost(row.observed)}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

export default function CostTracker({ dailyData = [], modelData = [], stats, costSummary, allSessions = [], dateRange = 30 }) {
  const fromArchive = !isDemoData(allSessions, costSummary) && Boolean(costSummary?.archive?.appendOnly);
  const coverage = costSummary?.allTime ?? summarizeCosts(allSessions);
  const totalCost = costSummary?.allTime ? costSummary.allTime.cost : stats?.totalCost;
  const totalSessions = costSummary?.allTime?.sessions ?? stats?.totalSessions ?? 0;

  const cumulative = useMemo(() => {
    const source = costSummary?.daily_summary ?? dailyData;
    return source.reduce((state, day) => {
      const knownTotal = day.estimated_cost_usd != null
        ? (state.knownTotal ?? 0) + day.estimated_cost_usd
        : state.knownTotal;
      return {
        knownTotal,
        rows: [...state.rows, { ...day, cumulative: knownTotal }],
      };
    }, { knownTotal: null, rows: [] }).rows;
  }, [costSummary, dailyData]);

  // A projection needs estimates for every session in the sampled days.
  const projectedMonthly = useMemo(() => {
    const active = dailyData.filter((day) => day.session_count > 0).slice(-7);
    if (!active.length || active.some((day) => day.estimated_cost_sessions !== day.session_count)) return null;
    return (active.reduce((sum, day) => sum + day.estimated_cost_usd, 0) / active.length) * 30;
  }, [dailyData]);

  const avgDaily = useMemo(() => {
    const active = dailyData.filter((day) => day.session_count > 0);
    if (active.some((day) => day.estimated_cost_sessions !== day.session_count)) return null;
    return active.length
      ? active.reduce((sum, day) => sum + (day.estimated_cost_usd || 0), 0) / active.length
      : null;
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
  const completeness = isDemoData(allSessions, costSummary) ? 'demo' : fromArchive ? 'archive' : 'preview';

  return (
    <>
      <div className="mo-grid mo-grid--4" style={{ marginBottom: 'var(--sp-5)' }}>
        <StatTile
          label="Known estimates"
          value={formatCost(totalCost)}
          scope={<Scope range="All time" source="All sources" completeness={completeness} />}
          sub={coverage.estimated_cost_sessions != null ? `${coverage.estimated_cost_sessions}/${totalSessions} sessions have estimates` : 'Estimate coverage unavailable in this snapshot'}
          icon={DollarSign}
          tone="var(--green)"
          help="cost-estimate"
        />
        <StatTile
          label="Observed charges"
          value={formatCost(coverage.observed_cost_usd)}
          scope={<Scope range="All time" source="Source-reported amounts" completeness={completeness} />}
          sub={coverage.observed_cost_sessions != null ? `${coverage.observed_cost_sessions}/${totalSessions} sessions report charges` : 'Charge coverage unavailable in this snapshot'}
          icon={DollarSign}
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
          scope={<Scope range="Up to 7 active days in selected range, times 30" />}
          icon={CalendarRange}
        />
      </div>
      <p role="note" style={{ marginBottom: 'var(--sp-5)', color: 'var(--text-muted)', fontSize: 'var(--fs-ui)' }}>
        Estimates and observed charges may cover the same sessions; do not add them together.
        {coverage.unavailable_cost_sessions != null && ` ${coverage.unavailable_cost_sessions} sessions have neither amount.`}
        {' '}Missing amounts remain unavailable. Calendar periods and charts below show known estimates only.
      </p>

      <section className="mo-section">
        <div className="mo-section__head">
          <Eyebrow>Calendar periods</Eyebrow>
          <Scope ignoresDateFilter />
        </div>
        <div className="mo-grid mo-grid--3" style={{ marginBottom: 'var(--sp-3)' }}>
          <PeriodCard
            label="Today"
            current={spend.today?.cost}
            previous={null}
            sessions={spend.today?.sessions}
            tokens={spend.today?.tokens}
            highlight
          />
          <PeriodCard
            label="This week"
            current={spend.thisWeek?.cost}
            previous={spend.lastWeek?.cost}
            sessions={spend.thisWeek?.sessions}
            tokens={spend.thisWeek?.tokens}
          />
          <PeriodCard
            label="Last week"
            current={spend.lastWeek?.cost}
            previous={null}
            sessions={spend.lastWeek?.sessions}
            tokens={spend.lastWeek?.tokens}
          />
        </div>
        <div className="mo-grid mo-grid--3">
          <PeriodCard
            label="This month"
            current={spend.thisMonth?.cost}
            previous={spend.lastMonth?.cost}
            sessions={spend.thisMonth?.sessions}
            tokens={spend.thisMonth?.tokens}
          />
          <PeriodCard
            label="Last month"
            current={spend.lastMonth?.cost}
            previous={null}
            sessions={spend.lastMonth?.sessions}
            tokens={spend.lastMonth?.tokens}
          />
          <PeriodCard
            label={`${new Date().getFullYear()} so far`}
            current={spend.thisYear?.cost}
            previous={spend.lastYear?.cost}
            sessions={spend.thisYear?.sessions}
            tokens={spend.thisYear?.tokens}
          />
        </div>
      </section>

      <div className="mo-grid mo-grid--2" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card>
          <div className="mo-section__head">
            <Eyebrow>Known estimates per day</Eyebrow>
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
              <Area type="monotone" dataKey="estimated_cost_usd" name="Estimate" stroke="var(--green)" fill="url(#costGrad)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div className="mo-section__head">
            <Eyebrow>Cumulative known estimates</Eyebrow>
            <Scope range="All time" completeness={isDemoData(allSessions, costSummary) ? 'demo' : costSummary?.archive?.appendOnly ? 'archive' : 'preview'} />
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
        <Scope range="Calendar estimate history" completeness={isDemoData(allSessions, costSummary) ? 'demo' : 'preview'} />
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
                {['Model', 'Sessions', 'Tokens', 'Estimate', 'Observed', 'Estimate share'].map((heading, index) => (
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
                  <td className="mo-num" style={{ padding: '9px 14px', textAlign: 'right' }}>{formatCost(row.observed_cost_usd)}</td>
                  <td className="mo-num" style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {row.cost != null && totalCost > 0 ? `${((row.cost / totalCost) * 100).toFixed(1)}%` : 'Unavailable'}
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
        Estimates use reported estimates or the historical local price table; current rates and invoices have not been verified. Unknown model prices remain unavailable. Provider reports and Cursor request counts are separate.
        <HelpTip term="cost-estimate" />
      </p>
    </>
  );
}
