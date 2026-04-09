export function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function formatCost(usd) {
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(2);
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 60) return '<1m';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

const IST = 'Asia/Kolkata';

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: IST, month: 'short', day: 'numeric',
  });
}

// IST datetime — e.g. "9 Apr, 07:21 AM IST"
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ist = d.toLocaleString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return ist + ' IST';
}

// UTC datetime — e.g. "2026-04-09 01:49 UTC"
export function formatDateTimeUTC(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// IST date only for day grouping — "YYYY-MM-DD" in IST
export function toISTDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: IST });
}

export function relativeTime(iso) {
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
