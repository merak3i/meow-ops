import { useMemo } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { motion } from 'framer-motion';
import { formatTokens, formatCost } from '../lib/format';

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      {/* Show full date in tooltip including year so "all time" view is unambiguous */}
      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontSize: 12 }}>
          {p.name}:{' '}
          {typeof p.value === 'number' && p.value > 999 ? formatTokens(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

const CostTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontSize: 12 }}>
          {p.name}: {formatCost(p.value)}
        </p>
      ))}
    </div>
  );
};

// Choose an X-axis tick formatter that includes the year when the data spans
// multiple calendar years (i.e., "all time" range is selected).
function makeTickFormatter(dailyData) {
  if (!dailyData?.length) return (d) => d.slice(5);

  const years = new Set(dailyData.map((d) => d.date?.slice(0, 4)));
  if (years.size > 1) {
    // "2025-12-31" → "Dec '25"
    return (d) => {
      const dt = new Date(d + 'T00:00:00');
      const mon = dt.toLocaleDateString('en-US', { month: 'short' });
      const yr  = String(dt.getFullYear()).slice(2);
      return `${mon} '${yr}`;
    };
  }
  // Same year: just show MM-DD
  return (d) => d.slice(5);
}

export default function ByDay({ dailyData, dateRange }) {
  const tickFormatter = useMemo(() => makeTickFormatter(dailyData), [dailyData]);

  // For "all time" with many months, only tick every ~4 weeks to avoid overlap.
  const tickInterval = useMemo(() => {
    if (!dailyData?.length) return 'preserveStartEnd';
    if (dateRange === 'all' && dailyData.length > 60) return Math.floor(dailyData.length / 12);
    if (dailyData.length > 30) return Math.floor(dailyData.length / 10);
    return 0; // show every day
  }, [dailyData, dateRange]);

  if (!dailyData?.length) {
    return (
      <div>
        <h2 style={{ fontSize: 22, marginBottom: 24 }}>By Day</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', paddingTop: 80 }}>
          No session data for this period.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>By Day</h2>

      {/* Token usage — input vs output */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        style={{ padding: 20, marginBottom: 16 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Token Usage Over Time</h3>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 2, background: 'oklch(0.488 0.243 264.376)', display: 'inline-block', borderRadius: 2 }} />
              Input
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 2, background: 'oklch(0.72 0.17 142)', display: 'inline-block', borderRadius: 2 }} />
              Output
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={dailyData}>
            <defs>
              <linearGradient id="gInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.488 0.243 264.376)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="oklch(0.488 0.243 264.376)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gOutput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.72 0.17 142)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="oklch(0.72 0.17 142)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              interval={tickInterval}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => formatTokens(v)}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="total_input_tokens"  name="Input"  stroke="oklch(0.488 0.243 264.376)" fill="url(#gInput)"  strokeWidth={1.5} />
            <Area type="monotone" dataKey="total_output_tokens" name="Output" stroke="oklch(0.72 0.17 142)"       fill="url(#gOutput)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Daily cost */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.05 }}
        style={{ padding: 20, marginBottom: 16 }}
      >
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Daily Cost (USD)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={dailyData}>
            <defs>
              <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.78 0.15 85)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="oklch(0.78 0.15 85)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              interval={tickInterval}
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
            <Tooltip content={<CostTooltip />} />
            <Area type="monotone" dataKey="estimated_cost_usd" name="Cost" stroke="oklch(0.78 0.15 85)" fill="url(#gCost)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Sessions per day */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
        style={{ padding: 20 }}
      >
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Sessions Per Day</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyData}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              interval={tickInterval}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey="session_count"
              name="Sessions"
              fill="oklch(0.488 0.243 264.376)"
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
}
