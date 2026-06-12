import type { CSSProperties } from 'react';
import type { LoopStatus } from './types';

// Operational status colors, not decorative — one CSS var per status (index.css).
const STATUS_VAR: Record<LoopStatus, string> = {
  covered: 'var(--loop-covered)',
  wired: 'var(--loop-wired)',
  running: 'var(--loop-running)',
  blocked: 'var(--loop-blocked)',
  failed: 'var(--loop-failed)',
  passed: 'var(--loop-passed)',
  'needs-review': 'var(--loop-needs-review)',
};

const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase',
  color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};

export function StatusChip({ status }: { status: LoopStatus }) {
  return (
    <span style={chipStyle} data-status={status}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: STATUS_VAR[status],
        flexShrink: 0,
      }} />
      {status}
    </span>
  );
}
