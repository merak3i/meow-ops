export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'Unavailable';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return 'Unavailable';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(2);
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 60) return '<1m';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

const OPERATOR_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: OPERATOR_TIME_ZONE, month: 'short', day: 'numeric',
  });
}

// Operator-local datetime, with the timezone visible.
export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    timeZone: OPERATOR_TIME_ZONE,
    timeZoneName: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// UTC datetime — e.g. "2026-04-09 01:49 UTC"
export function formatDateTimeUTC(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// Kept under its original export name for existing grouping callers.
export function toISTDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: OPERATOR_TIME_ZONE });
}

export function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
