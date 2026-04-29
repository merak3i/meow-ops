// ToggleGroup — segmented control. Single primitive for the two near-identical
// segmented controls in the codebase: DateFilter (date range) and SourceToggle
// (Claude / Codex / All) on the Overview page. Both pass an `options` array
// of { value, label } and a `value` / `onChange` pair. `size` lets the
// SourceToggle stay compact next to the page header.

export function ToggleGroup({ value, onChange, options, size = 'md', ariaLabel }) {
  const sm = size === 'sm';
  const padX = sm ? 12 : 14;
  const padY = sm ? 3  : 6;
  const fontSize = sm ? 11 : 12;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--bg-card)',
        borderRadius: 8,
        padding: 3,
        border: '1px solid var(--border)',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              padding: `${padY}px ${padX}px`,
              border: 'none',
              borderRadius: 6,
              background: active ? 'var(--bg-hover)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize,
              fontFamily: 'inherit',
              fontWeight: 500,
              transition: 'all 0.3s var(--ease)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
