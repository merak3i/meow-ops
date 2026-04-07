import { useState } from 'react';
import { motion } from 'framer-motion';
import ModelBadge from './ModelBadge';
import { getCatMeta } from '../lib/cat-classifier';
import { formatTokens, formatDuration, formatDateTime, formatCost } from '../lib/format';

export default function SessionTable({ sessions }) {
  const [sortField, setSortField] = useState('started_at');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...sessions].sort((a, b) => {
    const av = a[sortField], bv = b[sortField];
    if (typeof av === 'number') return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const toggleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const headerStyle = (field) => ({
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
  });

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
            <th style={headerStyle('cat_type')}>Cat</th>
            <th style={headerStyle('project')} onClick={() => toggleSort('project')}>Project</th>
            <th style={headerStyle('model')} onClick={() => toggleSort('model')}>Model</th>
            <th style={headerStyle('duration_seconds')} onClick={() => toggleSort('duration_seconds')}>Duration</th>
            <th style={headerStyle('total_tokens')} onClick={() => toggleSort('total_tokens')}>Tokens</th>
            <th style={headerStyle('estimated_cost_usd')} onClick={() => toggleSort('estimated_cost_usd')}>Cost</th>
            <th style={headerStyle('started_at')} onClick={() => toggleSort('started_at')}>Date</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 100).map((s, i) => {
            const cat = getCatMeta(s.cat_type);
            return (
              <tr
                key={s.session_id}
                style={{
                  transition: 'background 0.2s',
                  opacity: s.is_ghost ? 0.4 : 1,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <td style={cellStyle}>
                  <span title={cat.label}>{cat.icon}</span>
                </td>
                <td style={{ ...cellStyle, color: 'var(--text-primary)', fontWeight: 500 }}>{s.project}</td>
                <td style={cellStyle}><ModelBadge model={s.model} /></td>
                <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{formatDuration(s.duration_seconds)}</td>
                <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{formatTokens(s.total_tokens)}</td>
                <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--green)' }}>{formatCost(s.estimated_cost_usd)}</td>
                <td style={{ ...cellStyle, color: 'var(--text-secondary)', fontSize: 12 }}>{formatDateTime(s.started_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </motion.div>
  );
}
