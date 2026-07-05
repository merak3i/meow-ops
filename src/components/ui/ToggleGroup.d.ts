import type { ReactElement } from 'react';

export interface ToggleGroupOption<T extends string = string> {
  value: T;
  label: string;
}

export function ToggleGroup<T extends string = string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: readonly ToggleGroupOption<T>[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
}): ReactElement;
