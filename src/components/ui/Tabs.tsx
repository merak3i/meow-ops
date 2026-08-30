import type { ReactNode } from 'react';

// Tabs — the mechanism that lets 16 nav routes collapse to 5. Sub-surfaces
// that used to be their own sidebar entry become a tab here, and the tab id
// rides in the hash (#/usage/cost) so deep links and browser back still work.

export interface TabItem {
  id: string;
  label: string;
  /** Optional trailing count, e.g. pending proposals. */
  count?: number;
  hint?: string;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  /** Rendered flush-right on the tab rail — filters, toggles, actions. */
  actions?: ReactNode;
}

export function Tabs({ items, value, onChange, ariaLabel, actions }: TabsProps) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.id === value);
    const next = items[(index + delta + items.length) % items.length];
    if (next) onChange(next.id);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
      <div className="mo-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} style={{ flex: 1, minWidth: 0 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="mo-tab"
            aria-selected={item.id === value}
            tabIndex={item.id === value ? 0 : -1}
            {...(item.hint ? { title: item.hint } : null)}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="mo-tab__count">{item.count}</span>
            )}
          </button>
        ))}
      </div>
      {actions && <div style={{ display: 'flex', gap: 'var(--sp-2)', paddingBottom: 'var(--sp-2)' }}>{actions}</div>}
    </div>
  );
}
