import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, Eyebrow, ToggleGroup } from './ui';
import { formatCost } from '../lib/format';

// Spend history bars. The per-source footer this used to carry moved to Home,
// where source share is shown once for every source rather than hardcoding
// Claude and Codex.

const VIEWS = [
  { value: 'weekly', label: '8 weeks' },
  { value: 'monthly', label: '6 months' },
];

function SpendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="mo-card" style={{ padding: '8px 12px' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-meta)', marginBottom: 3 }}>{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: 'var(--green)', fontSize: 'var(--fs-body)' }}>
          {formatCost(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function SpendChart({ spendData }) {
  const [view, setView] = useState('weekly');
  if (!spendData) return null;

  const data = (view === 'weekly' ? spendData.weeklyHistory : spendData.monthlyHistory) ?? [];

  return (
    <Card>
      <div className="mo-section__head">
        <Eyebrow>Spend history</Eyebrow>
        <ToggleGroup value={view} onChange={setView} options={VIEWS} size="sm" ariaLabel="History window" />
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} barSize={view === 'weekly' ? 18 : 28}>
          <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(value) => (value === 0 ? '$0' : formatCost(value))}
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<SpendTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="cost" radius={[3, 3, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.label} fill={entry.isCurrent ? 'var(--green)' : 'color-mix(in oklch, var(--green) 35%, transparent)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
