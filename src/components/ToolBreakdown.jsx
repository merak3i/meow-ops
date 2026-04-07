import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';

const COLORS = [
  'oklch(0.488 0.243 264.376)',
  'oklch(0.72 0.17 142)',
  'oklch(0.78 0.15 85)',
  'oklch(0.65 0.2 295)',
  'oklch(0.75 0.15 195)',
  'oklch(0.63 0.2 25)',
  'oklch(0.6 0.15 50)',
  'oklch(0.55 0.18 230)',
];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <p style={{ color: 'var(--text-primary)', fontSize: 12 }}>
        {payload[0].name}: {payload[0].value}
      </p>
    </div>
  );
};

export default function ToolBreakdown({ data, title }) {
  const total = data.reduce((a, d) => a + d.call_count, 0);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.2 }}
      style={{ padding: 20 }}
    >
      <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>{title || 'Tool Usage'}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie
              data={data}
              dataKey="call_count"
              nameKey="tool_name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.slice(0, 8).map((d, i) => (
            <div key={d.tool_name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{d.tool_name}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', fontSize: 11 }}>
                {total > 0 ? ((d.call_count / total) * 100).toFixed(0) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
