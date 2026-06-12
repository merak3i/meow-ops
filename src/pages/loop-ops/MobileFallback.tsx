// Mobile fallback (spec §7): the canvas collapses into director cards plus a
// searchable assistant list. Same data, same inspector, no React Flow.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { StatusChip } from './StatusChip';
import { LOOP_GROUPS, worstStatus } from './types';
import type { LoopEntity } from './types';

const card: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6,
};

interface MobileFallbackProps {
  entities: LoopEntity[];
  onSelectEntity: (entity: LoopEntity) => void;
}

export function MobileFallback({ entities, onSelectEntity }: MobileFallbackProps) {
  const [query, setQuery] = useState('');
  const assistants = useMemo(() => entities.filter((e) => e.kind === 'assistant'), [entities]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assistants;
    return assistants.filter((a) =>
      a.label.toLowerCase().includes(q) || (a.surfaceKey ?? '').toLowerCase().includes(q));
  }, [assistants, query]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}
      data-testid="loop-mobile-fallback">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {LOOP_GROUPS.map((g) => {
          const inLane = assistants.filter((a) => a.group === g);
          return (
            <div key={g} style={card}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                {g} lane
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{inLane.length} surface{inLane.length === 1 ? '' : 's'}</span>
              <StatusChip status={worstStatus(inLane.map((a) => a.status))} />
            </div>
          );
        })}
      </div>

      <input
        type="search"
        aria-label="Search surfaces"
        placeholder="Search surfaces…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-input)',
          borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)',
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((a) => (
          <button key={a.id} onClick={() => onSelectEntity(a)} style={{
            ...card, cursor: 'pointer', textAlign: 'left', flexDirection: 'row',
            justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}</span>
              <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{a.surfaceKey}</code>
            </span>
            <StatusChip status={a.status} />
          </button>
        ))}
        {filtered.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No surface matches “{query}”.</p>
        )}
      </div>
    </div>
  );
}
