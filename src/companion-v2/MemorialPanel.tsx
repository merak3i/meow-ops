// MemorialPanel.tsx — collapsed panel listing past companions.

import { useState } from 'react';
import { COMPANION_BREEDS } from '@/lib/companion-breeds';
import type { MemorialEntry } from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MemorialPanelProps {
  entries: MemorialEntry[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MemorialPanel({ entries }: MemorialPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border)',
      borderRadius: 10,
      overflow:     'hidden',
    }}>
      {/* Header / toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width:       '100%',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'space-between',
          padding:     '12px 16px',
          background:  'none',
          border:      'none',
          cursor:      'pointer',
          fontFamily:  'inherit',
          color:       'var(--text-muted)',
        }}
      >
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          🌿 Memorial · {entries.length}
        </span>
        <span style={{ fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Entries */}
      {expanded && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((e) => {
            const breed     = COMPANION_BREEDS[e.breed as keyof typeof COMPANION_BREEDS];
            const lostDate  = new Date(e.lostAt).toLocaleDateString('en-CA');
            return (
              <div
                key={e.id}
                style={{
                  padding:      '8px 10px',
                  background:   'var(--bg-page)',
                  borderRadius: 6,
                  filter:       'grayscale(0.6)',
                  fontSize:     11,
                  color:        'var(--text-muted)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{e.name}</span>
                  <span>{lostDate}</span>
                </div>
                <div style={{ marginTop: 2 }}>
                  {breed?.label ?? e.breed} · {e.daysLived} day{e.daysLived !== 1 ? 's' : ''} · {e.finalLifeStage}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
