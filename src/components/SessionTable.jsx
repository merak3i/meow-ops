import { useState } from 'react';
import { motion } from 'framer-motion';
import ModelBadge from './ModelBadge';
import { getCatMeta } from '../lib/cat-classifier';
import { formatTokens, formatDuration, formatDateTime, formatDateTimeUTC, relativeTime, formatCost } from '../lib/format';

export default function SessionTable({ sessions }) {
  // Default sort: ended_at desc — shows most recently active sessions first.
  // Long-running sessions that started weeks ago but are still active today
  // rank at the top instead of being buried by their old started_at.
  const [sortField, setSortField] = useState('ended_at');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...sessions].sort((a, b) => {
    const av = a[sortField] ?? '';
    const bv = b[sortField] ?? '';
    if (typeof av === 'number') return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const toggleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const Th = ({ field, label, children }) => (
    <th
      onClick={() => toggleSort(field)}
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 500,
        color: sortField === field ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: 1,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {children || label}
      {sortField === field && (
        <span style={{ marginLeft: 4, opacity: 0.6 }}>{sortAsc ? '↑' : '↓'}</span>
      )}
    </th>
  );

  const cellStyle = {
    padding: '10px 12px',
    fontSize: 13,
    borderTop: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
      style={{ overflow: 'auto' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <Th field="cat_type">Cat</Th>
            <Th field="project">Project</Th>
            <Th field="model">Model</Th>
            <Th field="duration_seconds">Duration</Th>
            <Th field="total_tokens">Tokens</Th>
            <Th field="estimated_cost_usd">Cost</Th>
            <Th field="ended_at">Last Active</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 100).map((s) => {
            const cat = getCatMeta(s.cat_type);
            const activityTs = s.ended_at || s.started_at;
            return (
              <tr
                key={s.session_id}
                style={{ transition: 'background 0.2s', opacity: s.is_ghost ? 0.4 : 1 }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <td style={cellStyle}>
                  <span title={cat.label}>{cat.icon}</span>
                </td>
                <td style={{ ...cellStyle, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {s.project}
                  {s.source === 'codex' && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'oklch(0.65 0.18 260)', opacity: 0.8 }}>
                      ⬡ Codex
                    </span>
                  )}
                </td>
                <td style={cellStyle}><ModelBadge model={s.model} /></td>
                <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                  {formatDuration(s.duration_seconds)}
                </td>
                <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                  {formatTokens(s.total_tokens)}
                </td>
                <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--green)' }}>
                  {formatCost(s.estimated_cost_usd)}
                </td>
                {/* Timestamp: IST (primary) + UTC + relative time */}
                <td style={{ ...cellStyle, fontSize: 12 }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {formatDateTime(activityTs)}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                    {formatDateTimeUTC(activityTs)} · {relativeTime(activityTs)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </motion.div>
  );
}
