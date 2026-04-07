const OPTIONS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 'all', label: 'All' },
];

export default function DateFilter({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 6,
            background: value === opt.value ? 'var(--bg-hover)' : 'transparent',
            color: value === opt.value ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            fontWeight: 500,
            transition: 'all 0.3s var(--ease)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
