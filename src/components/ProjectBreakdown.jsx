import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { formatTokens, formatCost, relativeTime } from '../lib/format';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <p style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{d.project}</p>
      <p style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Sessions: {d.sessions}</p>
      <p style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Tokens: {formatTokens(d.tokens)}</p>
      <p style={{ color: 'var(--green)', fontSize: 11 }}>Cost: {formatCost(d.cost)}</p>
    </div>
  );
};

export default function ProjectBreakdown({ data, showTable = false }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
      style={{ padding: 20 }}
    >
      <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>By Project</h3>
      <ResponsiveContainer width="100%" height={Math.max(data.length * 40, 120)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0 }}>
          <XAxis
            type="number"
            tickFormatter={(v) => formatTokens(v)}
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="project"
            width={90}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="tokens" fill="oklch(0.488 0.243 264.376)" radius={[0, 4, 4, 0]} barSize={20} />
        </BarChart>
      </ResponsiveContainer>

      {showTable && (
        <table style={{ width: '100%', marginTop: 20, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Project', 'Sessions', 'Tokens', 'Cost', 'Last Active'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.project} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500 }}>{d.project}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{d.sessions}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{formatTokens(d.tokens)}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--green)' }}>{formatCost(d.cost)}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{relativeTime(d.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </motion.div>
  );
}
