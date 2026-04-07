export default function ModelBadge({ model }) {
  const isOpus = model?.includes('opus');
  const label = isOpus ? 'Opus' : 'Sonnet';
  const color = isOpus ? 'var(--purple)' : 'var(--accent)';

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
      {label}
    </span>
  );
}
