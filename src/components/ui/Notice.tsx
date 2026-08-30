import type { ReactNode } from 'react';

// Notice — a single inline banner. Product Law 4: if the local helper is off,
// say so once at the top of the surface with the exact command, rather than
// letting five separate panels each render their own offline state.

export interface NoticeProps {
  children: ReactNode;
  /** Shell command that resolves the condition. */
  command?: string;
  action?: ReactNode;
}

export function Notice({ children, command, action }: NoticeProps) {
  return (
    <div className="mo-notice" role="status">
      <span style={{ flex: 1, minWidth: '20ch' }}>{children}</span>
      {command && <code>{command}</code>}
      {action}
    </div>
  );
}
