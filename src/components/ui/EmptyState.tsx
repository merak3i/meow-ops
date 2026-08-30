import type { ReactNode } from 'react';

// EmptyState — every empty surface must offer the next action. The audit found
// messages like "No local or demo usage data loaded." that told the user a fact
// and left them there; `command` or `action` is how that stops happening.

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** Exact shell command to run. Rendered selectable so it can be copied. */
  command?: string;
  action?: ReactNode;
}

export function EmptyState({ title, body, command, action }: EmptyStateProps) {
  return (
    <div className="mo-empty">
      <p className="mo-empty__title">{title}</p>
      {body && <p className="mo-empty__body">{body}</p>}
      {command && <code className="mo-empty__cmd">{command}</code>}
      {action}
    </div>
  );
}
