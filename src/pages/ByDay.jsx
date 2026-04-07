import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { formatTokens, formatCost } from '../lib/format';

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontSize: 12 }}>{p.name}: {typeof p.value === 'number' && p.value > 999 ? formatTokens(p.value) : p.value}</p>
      ))}
    </div>
  );
};

export default function ByDay({ dailyData }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>By Day</h2>

      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }} style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Token Usage Over Time</h3>
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
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => formatTokens(v)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={55} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="total_input_tokens" name="Input" stroke="oklch(0.488 0.243 264.376)" fill="url(#gInput)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="total_output_tokens" name="Output" stroke="oklch(0.72 0.17 142)" fill="url(#gOutput)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.1 }} style={{ padding: 20 }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Sessions Per Day</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyData}>
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="session_count" name="Sessions" fill="oklch(0.488 0.243 264.376)" radius={[4, 4, 0, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
}
