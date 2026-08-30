import type { CSSProperties, ReactNode } from 'react';

// Card — the single surface recipe. Before this, `.card` was used 23 times
// while 32 other files re-declared `background: var(--bg-card); border: 1px
// solid var(--border); border-radius: 10|12` inline, which is why radii and
// shadows drifted across pages.

export interface CardProps {
  children?: ReactNode;
  /** `pad` adds the standard 16px inset. Turn off for tables and canvases. */
  pad?: boolean;
  /** Removes the shadow — for cards nested inside another card. */
  flat?: boolean;
  /** Page-coloured surface, for wells inside a card. */
  inset?: boolean;
  /** Adds hover affordance. Pair with onClick or a wrapping link. */
  interactive?: boolean;
  /** Coloured 2px top rule, used to key a card to a source or status. */
  accent?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export function Card({
  children,
  pad = true,
  flat = false,
  inset = false,
  interactive = false,
  accent,
  className = '',
  style,
  onClick,
}: CardProps) {
  const classes = [
    'mo-card',
    pad && 'mo-card--pad',
    flat && 'mo-card--flat',
    inset && 'mo-card--inset',
    (interactive || onClick) && 'mo-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{ ...(accent ? { borderTop: `2px solid ${accent}` } : null), ...style }}
      {...(onClick ? { onClick, role: 'button', tabIndex: 0 } : null)}
    >
      {children}
    </div>
  );
}
