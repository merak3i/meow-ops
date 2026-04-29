// Eyebrow — small-caps section label used as a kicker above grouped content.
// Replaces the ~10 inline <p style={{ fontSize: 11, textTransform: 'uppercase',
// letterSpacing: 1, color: 'var(--text-muted)' }}> blocks scattered across
// Overview / Sidebar / page sections.

export function Eyebrow({ children, color, className = '', style = {} }) {
  return (
    <p
      className={className}
      style={{
        fontSize: 11,
        color: color ?? 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 1,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
