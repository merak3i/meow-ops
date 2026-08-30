import { HelpTip } from './HelpTip';

// Scope — Product Law 2. Every figure in the app declares three things: the
// date range it covers, which sources it counts, and whether it came from the
// complete archive or the bounded preview.
//
// This exists because Overview used to render a "Cost — 30 days" card directly
// above six spend cards that silently ignored the date filter and read all-time
// rollups. Both were correct; neither said so.

export type ScopeCompleteness = 'archive' | 'preview' | 'unknown';

export interface ScopeProps {
  /** Human range label, e.g. "30 days", "All time", "This month". */
  range?: string;
  /** Which sources are counted, e.g. "All sources", "Claude only". */
  source?: string;
  completeness?: ScopeCompleteness;
  /** Set when this figure deliberately ignores the global date filter. */
  ignoresDateFilter?: boolean;
}

const COMPLETENESS_LABEL: Record<ScopeCompleteness, string | null> = {
  archive: 'complete archive',
  preview: 'newest 1,000 only',
  unknown: null,
};

export function Scope({ range, source, completeness = 'unknown', ignoresDateFilter = false }: ScopeProps) {
  const parts: string[] = [];
  if (range) parts.push(range);
  if (source) parts.push(source);

  const completenessLabel = COMPLETENESS_LABEL[completeness];
  const warn = completeness === 'preview' || ignoresDateFilter;

  return (
    <span className={warn ? 'mo-scope mo-scope--warn' : 'mo-scope'}>
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 && <span className="mo-scope__dot"> · </span>}
          {part}
        </span>
      ))}
      {completenessLabel && (
        <>
          {parts.length > 0 && <span className="mo-scope__dot"> · </span>}
          {completenessLabel}
          <HelpTip term={completeness === 'preview' ? 'preview' : 'archive'} />
        </>
      )}
      {ignoresDateFilter && (
        <>
          <span className="mo-scope__dot"> · </span>
          fixed periods, not the date filter
        </>
      )}
    </span>
  );
}
