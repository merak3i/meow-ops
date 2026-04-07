import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 6 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontSize: 12, lineHeight: 1.6 }}>
          {p.name}: {(p.value / 1000).toFixed(1)}K
        </p>
      ))}
    </div>
  );
};

export default function DailyChart({ data, title }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.15 }}
      style={{ padding: 20 }}
    >
      <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>{title || 'Token Usage'}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="gradInput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.488 0.243 264.376)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="oklch(0.488 0.243 264.376)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradOutput" x1="0" y1="0" x2="0" y2="1">
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
            tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'}
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="total_input_tokens" name="Input" stroke="oklch(0.488 0.243 264.376)" fill="url(#gradInput)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="total_output_tokens" name="Output" stroke="oklch(0.72 0.17 142)" fill="url(#gradOutput)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
