import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  children?: ReactNode;
  tone?: BadgeTone;
  /** Small leading dot in the tone colour — for status rather than category. */
  dot?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Badge({ children, tone = 'neutral', dot = false, title, className = '', style }: BadgeProps) {
  return (
    <span
      className={`mo-badge mo-badge--${tone} ${className}`.trim()}
      {...(title ? { title } : null)}
      {...(style ? { style } : null)}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{ width: 5, height: 5, borderRadius: 999, background: 'currentColor', flexShrink: 0 }}
        />
      )}
      {children}
    </span>
  );
}
