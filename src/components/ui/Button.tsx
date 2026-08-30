import type { CSSProperties, ReactNode } from 'react';

// Button — replaces ~118 bare <button> elements that each re-declared padding,
// border, radius, cursor and a pair of onMouseEnter/onMouseLeave handlers to
// fake hover. Hover and focus now come from the cascade, so keyboard users get
// a focus ring they never had.

export interface ButtonProps {
  children?: ReactNode;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Square padding for icon-only buttons. Requires `label`. */
  icon?: boolean;
  block?: boolean;
  disabled?: boolean;
  /** Accessible name. Required when `icon` is set, since there is no text. */
  label?: string;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
  style?: CSSProperties;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  icon = false,
  block = false,
  disabled = false,
  label,
  title,
  type = 'button',
  className = '',
  style,
  onClick,
}: ButtonProps) {
  const classes = [
    'mo-btn',
    variant !== 'default' && `mo-btn--${variant}`,
    size !== 'md' && `mo-btn--${size}`,
    icon && 'mo-btn--icon',
    block && 'mo-btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      {...(label ? { 'aria-label': label } : null)}
      {...(title ?? label ? { title: title ?? label } : null)}
      {...(style ? { style } : null)}
    >
      {children}
    </button>
  );
}
