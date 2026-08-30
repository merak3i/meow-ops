import type { ReactNode } from 'react';

// PageHeader — every surface opens the same way: what this is, one line of
// what it answers, and its actions on the right. Previously three pages had no
// title at all (Agent Ops rendered a bare stats row) and the rest each invented
// their own heading size.

export interface PageHeaderProps {
  title: string;
  /** One sentence. What question does this surface answer? */
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mo-pageheader">
      <div style={{ minWidth: 0 }}>
        <h1 className="mo-pageheader__title">{title}</h1>
        {description && <p className="mo-pageheader__desc">{description}</p>}
      </div>
      {actions && <div className="mo-pageheader__actions">{actions}</div>}
    </header>
  );
}
