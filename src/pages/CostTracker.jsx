import { useMemo } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import StatCard from '../components/StatCard';
import ModelBadge from '../components/ModelBadge';
import { formatCost, formatTokens } from '../lib/format';
import { DollarSign, TrendingUp } from 'lucide-react';

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontSize: 12 }}>{p.name}: {formatCost(p.value)}</p>
      ))}
    </div>
  );
};

export default function CostTracker({ dailyData, modelData, stats, costSummary }) {
  // ── Accurate total cost ────────────────────────────────────────────────────
  // Prefer cost-summary.allTime (covers ALL sessions, no 1000-cap) when
  // available. Fall back to summing from the date-range-filtered stats.
  const accurateTotalCost = costSummary?.allTime?.cost ?? stats.totalCost;
  const accurateTotalSessions = costSummary?.allTime?.sessions ?? stats.totalSessions;

  // ── Cumulative cost line ───────────────────────────────────────────────────
  // Use the full daily_summary (not the date-range slice) if available, so the
  // cumulative line is never truncated by whatever filter is active in the UI.
  const cumulativeSource = costSummary?.daily_summary ?? dailyData;
  const cumulativeData = useMemo(() => {
    return cumulativeSource.reduce((acc, d) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
      acc.push({ ...d, cumulative: prev + (d.estimated_cost_usd || 0) });
      return acc;
    }, []);
  }, [cumulativeSource]);

  // ── Projected monthly ──────────────────────────────────────────────────────
  // Use a trailing 7-day average (only active days) rather than the full
  // date-range average — much more representative of current spending rate.
  const projectedMonthly = useMemo(() => {
    const IST = 'Asia/Kolkata';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: IST });
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: IST });
    const last7 = dailyData.filter((d) => d.date >= sevenDaysAgo && d.date <= today);
    const activeDays = last7.filter((d) => d.estimated_cost_usd > 0);
    if (!activeDays.length) {
      // Fall back to overall average if no recent data
      const avg = dailyData.length > 0
        ? dailyData.reduce((a, d) => a + (d.estimated_cost_usd || 0), 0) / dailyData.length
        : 0;
      return avg * 30;
    }
    const trailing7Total = activeDays.reduce((a, d) => a + (d.estimated_cost_usd || 0), 0);
    const daily7Avg = trailing7Total / activeDays.length;
    return daily7Avg * 30;
  }, [dailyData]);

  // ── Legacy avg daily (for "Avg Daily" card) ────────────────────────────────
  const activeDailyData = dailyData.filter((d) => d.estimated_cost_usd > 0);
  const avgDaily = activeDailyData.length > 0
    ? activeDailyData.reduce((a, d) => a + (d.estimated_cost_usd || 0), 0) / activeDailyData.length
    : 0;

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>Cost Tracker</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard
          label={`Total Cost${costSummary?.allTime ? ' (all time)' : ''}`}
          value={formatCost(accurateTotalCost)}
          sub={`${accurateTotalSessions} sessions total`}
          icon={DollarSign}
          color="var(--green)"
        />
        <StatCard
          label="Avg Daily (active days)"
          value={formatCost(avgDaily)}
          sub="per day with activity"
          icon={TrendingUp}
          color="var(--amber)"
        />
        <StatCard
          label="Projected Monthly"
          value={formatCost(projectedMonthly)}
          sub="based on 7-day trailing avg"
          icon={DollarSign}
          color="var(--red)"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Daily cost */}
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          style={{ padding: 20 }}
        >
          <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Daily Cost</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.72 0.17 142)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="oklch(0.72 0.17 142)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => d.slice(5)}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => '$' + v.toFixed(2)}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="estimated_cost_usd"
                name="Cost"
                stroke="oklch(0.72 0.17 142)"
                fill="url(#costGrad)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Cumulative cost — uses full history, not date-range slice */}
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          style={{ padding: 20 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Cumulative Cost</h3>
            {costSummary?.daily_summary && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>all time</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={cumulativeData}>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => d.slice(5)}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => '$' + v.toFixed(0)}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Total"
                stroke="oklch(0.78 0.15 85)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* By model table */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        style={{ padding: 20 }}
      >
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>By Model</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Model', 'Sessions', 'Tokens', 'Cost', '% of Spend'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modelData.map((d) => (
              <tr key={d.model} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px' }}><ModelBadge model={d.model} /></td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                  {d.sessions}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                  {formatTokens(d.tokens)}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--green)' }}>
                  {formatCost(d.cost)}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                  {stats.totalCost > 0 ? ((d.cost / stats.totalCost) * 100).toFixed(1) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
}
