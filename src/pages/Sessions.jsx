import { useState, useMemo } from 'react';
import SessionTable from '../components/SessionTable';
import { toISTDate, formatDate } from '../lib/format';

// Build the last N day labels in IST for the toggle.
function buildDayOptions(sessions) {
  // Collect unique IST days that actually have sessions, most recent first.
  const daySet = new Set();
  for (const s of sessions) {
    const d = toISTDate(s.ended_at || s.started_at);
    if (d) daySet.add(d);
  }
  return ['all', ...[...daySet].sort((a, b) => b.localeCompare(a)).slice(0, 10)];
}

function dayLabel(day) {
  if (day === 'all') return 'All';
  const today    = toISTDate(new Date().toISOString());
  const yesterday = toISTDate(new Date(Date.now() - 86_400_000).toISOString());
  if (day === today)     return 'Today';
  if (day === yesterday) return 'Yesterday';
  // e.g. "7 Apr"
  return formatDate(day + 'T00:00:00');
}

export default function Sessions({ sessions }) {
  const [activeDay, setActiveDay] = useState('all');

  const dayOptions = useMemo(() => buildDayOptions(sessions), [sessions]);

  const filtered = useMemo(() => {
    if (activeDay === 'all') return sessions;
    return sessions.filter((s) => {
      const d = toISTDate(s.ended_at || s.started_at);
      return d === activeDay;
    });
  }, [sessions, activeDay]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 22 }}>Sessions</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Day-wise toggle */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {dayOptions.map((day) => (
          <button
            key={day}
            onClick={() => setActiveDay(day)}
            style={{
              fontSize: 12,
              padding: '5px 14px',
              borderRadius: 20,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              background: activeDay === day ? 'var(--accent)' : 'transparent',
              color: activeDay === day ? '#000' : 'var(--text-muted)',
              fontWeight: activeDay === day ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {dayLabel(day)}
          </button>
        ))}
      </div>

      <SessionTable sessions={filtered} />
    </div>
  );
}
