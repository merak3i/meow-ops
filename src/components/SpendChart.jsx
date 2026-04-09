import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'framer-motion';
import { formatCost } from '../lib/format';

const ACCENT   = 'oklch(0.72 0.17 142)';   // green — matches Cost stat card
const DIM      = 'oklch(0.72 0.17 142 / 0.35)';
const CODEX_C  = 'oklch(0.65 0.18 260)';   // blue-purple for Codex bars
const CODEX_DIM = 'oklch(0.65 0.18 260 / 0.35)';

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
      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 13 }}>
          {formatCost(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function SpendChart({ spendData, source = 'both' }) {
  const [view, setView] = useState('weekly'); // 'weekly' | 'monthly'

  if (!spendData) return null;

  const data = view === 'weekly' ? spendData.weeklyHistory : spendData.monthlyHistory;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.2 }}
      style={{ padding: 20 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Spend History</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {['weekly', 'monthly'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: view === v ? 'var(--accent)' : 'transparent',
                color: view === v ? '#000' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {v === 'weekly' ? '8 weeks' : '6 months'}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barSize={view === 'weekly' ? 18 : 28}>
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => v === 0 ? '$0' : formatCost(v)}
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="cost" radius={[3, 3, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.label}
                fill={entry.isCurrent ? ACCENT : DIM}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Source breakdown for this month — only shown in "All" mode */}
      {source === 'both' && spendData.bySource && Object.keys(spendData.bySource).length > 1 && (
        <div style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 24,
        }}>
          {Object.entries(spendData.bySource).map(([src, d]) => (
            <div key={src} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: src === 'codex' ? CODEX_C : ACCENT,
              }}>
                {src === 'codex' ? '⬡ Codex' : '◆ Claude'}
              </span>
              <span style={{ fontSize: 16, fontWeight: 300, color: 'var(--text-primary)' }}>
                {formatCost(d.cost)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {d.sessions} sessions this month
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
