import ToolBreakdown from '../components/ToolBreakdown';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';

export default function ByAction({ toolData }) {
  const total = toolData.reduce((a, d) => a + d.call_count, 0);

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>By Action</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <ToolBreakdown data={toolData} title="Tool Distribution" />

        <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.15 }} style={{ padding: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Tool Call Count</h3>
          <ResponsiveContainer width="100%" height={Math.max(toolData.length * 32, 120)}>
            <BarChart data={toolData} layout="vertical">
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="tool_name" width={70} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text-primary)' }}
                itemStyle={{ color: 'var(--text-secondary)' }}
              />
              <Bar dataKey="call_count" name="Calls" fill="oklch(0.75 0.15 195)" radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} style={{ padding: 20 }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>Details</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Tool', 'Calls', '% of Total'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {toolData.map((d) => (
              <tr key={d.tool_name} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500 }}>{d.tool_name}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{d.call_count}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                  {total > 0 ? ((d.call_count / total) * 100).toFixed(1) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
}
