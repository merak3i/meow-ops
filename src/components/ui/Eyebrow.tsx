import type { CSSProperties, ReactNode } from 'react';

// Eyebrow — small-caps section label. Now a thin wrapper over `.mo-eyebrow` so
// the ~30 inline uppercase labels scattered across the pages have one place to
// converge on.

export interface EyebrowProps {
  children?: ReactNode;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function Eyebrow({ children, color, className = '', style }: EyebrowProps) {
  return (
    <p className={`mo-eyebrow ${className}`.trim()} style={{ margin: 0, ...(color ? { color } : null), ...style }}>
      {children}
    </p>
  );
}
