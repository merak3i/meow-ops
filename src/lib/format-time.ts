/**
 * Compact relative-time formatter for nameplate chips ("5m ago", "2h ago", "3d ago").
 * Accepts ISO strings or Date-like inputs and a `now` epoch so callers can tick
 * a single shared clock instead of spawning an interval per display.
 */
export function formatRelativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const ageSec = Math.max(0, Math.floor((now - then) / 1000));
  if (ageSec < 45)    return 'just now';
  if (ageSec < 90)    return '1m ago';
  if (ageSec < 3600)  return `${Math.round(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
  return `${Math.round(ageSec / 86400)}d ago`;
}

/** Age in minutes for decay curves. Returns Infinity if missing/invalid. */
export function ageMinutes(iso: string | null | undefined, now: number): number {
  if (!iso) return Infinity;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return Math.max(0, (now - then) / 60_000);
}
