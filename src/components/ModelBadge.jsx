export default function ModelBadge({ model }) {
  const normalized = String(model || '').toLowerCase();
  const label = model || 'Not exposed';
  const color = normalized.includes('claude') || normalized.includes('opus') || normalized.includes('sonnet')
    ? 'var(--purple)'
    : normalized.includes('gpt') || normalized.includes('codex')
      ? 'oklch(0.72 0.14 160)'
      : normalized.includes('grok')
        ? 'var(--cyan)'
        : normalized.includes('gemini')
          ? 'oklch(0.70 0.17 260)'
          : 'var(--text-muted)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 100,
        background: 'var(--bg-hover)',
        color,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span title={label} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </span>
  );
}
