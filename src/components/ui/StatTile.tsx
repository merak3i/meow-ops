import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { HelpTip } from './HelpTip';
import type { GlossaryTerm } from '../../lib/glossary';

// StatTile — the one KPI recipe. Replaces StatCard plus the four bespoke
// variants Overview grew (SpendCard, TimeCard, QuotaBand header, source rows),
// each with its own font sizes and trend colouring.
//
// `scope` is not optional by convention: a number without a stated range is
// the bug this refactor exists to remove.

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Stated range/source for this figure. Rendered under the value. */
  scope?: ReactNode;
  /** Secondary line, e.g. "12 today". */
  sub?: ReactNode;
  icon?: LucideIcon;
  /** Tints the value. Use sparingly — cost green, over-budget red. */
  tone?: string;
  /** Percentage change vs the previous comparable period. */
  deltaPct?: number | null;
  /** For cost, up is bad. For throughput, up is good. */
  deltaGoodWhen?: 'up' | 'down';
  help?: GlossaryTerm;
  highlight?: boolean;
}

export function StatTile({
  label,
  value,
  scope,
  sub,
  icon: Icon,
  tone,
  deltaPct = null,
  deltaGoodWhen = 'down',
  help,
  highlight = false,
}: StatTileProps) {
  const moved = deltaPct !== null && Math.abs(deltaPct) > 0.5;
  const up = moved && deltaPct !== null && deltaPct > 0;
  const good = moved && (deltaGoodWhen === 'up' ? up : !up);
  const deltaColor = !moved ? 'var(--text-muted)' : good ? 'var(--green)' : 'var(--red)';

  return (
    <div
      className="mo-card mo-card--pad"
      style={highlight ? { borderColor: 'var(--accent)' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--sp-2)' }}>
        <span className="mo-eyebrow">{label}</span>
        {help && <HelpTip term={help} />}
        {Icon && (
          <Icon
            size={13}
            aria-hidden="true"
            style={{ marginLeft: 'auto', color: tone ?? 'var(--text-muted)', flexShrink: 0 }}
          />
        )}
      </div>

      <div
        className="mo-num"
        style={{ fontSize: 'var(--fs-metric)', fontWeight: 300, lineHeight: 1.1, color: tone ?? 'var(--text-primary)' }}
      >
        {value}
      </div>

      {scope && <div style={{ marginTop: 5 }}>{scope}</div>}

      {(sub || moved) && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            fontSize: 'var(--fs-meta)',
            color: 'var(--text-muted)',
          }}
        >
          {sub}
          {moved && deltaPct !== null && (
            <span style={{ color: deltaColor, marginLeft: sub ? 'auto' : 0 }}>
              {up ? '↑' : '↓'} {Math.abs(deltaPct).toFixed(0)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
