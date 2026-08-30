// Source metadata. "Source" is the one word for where a session came from —
// the UI previously called the same field source, app and provider in three
// different places on one page.

export interface SourceMeta {
  label: string;
  color: string;
}

export const SOURCE_META: Readonly<Record<string, SourceMeta>> = {
  claude:      { label: 'Claude Code', color: 'var(--accent)' },
  codex:       { label: 'Codex',       color: 'oklch(0.65 0.18 260)' },
  cursor:      { label: 'Cursor',      color: 'var(--cyan)' },
  aider:       { label: 'Aider',       color: 'var(--amber)' },
  antigravity: { label: 'Antigravity', color: 'oklch(0.70 0.17 150)' },
  hermes:      { label: 'Hermes',      color: 'oklch(0.72 0.16 70)' },
};

export function sourceMeta(source: string | null | undefined): SourceMeta {
  const key = String(source ?? 'unknown');
  const known = SOURCE_META[key];
  if (known) return known;
  return {
    label: key.replace(/^\w/, (char) => char.toUpperCase()),
    color: 'var(--text-secondary)',
  };
}

export function sourceLabel(source: string | null | undefined): string {
  return sourceMeta(source).label;
}

/** Options for the source filter, limited to sources with data. */
export function sourceOptions(present: readonly string[]) {
  return [
    { value: 'both', label: 'All sources' },
    ...present.map((source) => ({ value: source, label: sourceMeta(source).label })),
  ];
}

/**
 * Sources that report token counts on disk. Antigravity encrypts its
 * conversation store and Cursor only exposes transcripts, so their tokens and
 * cost are never estimated — they are shown as unavailable instead.
 */
export const SOURCES_WITHOUT_TOKENS: readonly string[] = ['antigravity'];
