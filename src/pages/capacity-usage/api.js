const DEV = import.meta.env.DEV;
const API_BASE = DEV ? '/api/superadmin-usage' : 'http://localhost:7337/superadmin-usage';

async function fetchJson(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

export async function fetchCapacityUsageData() {
  const stamp = Date.now();
  const urls = DEV
    ? [`/data/superadmin-usage.json?t=${stamp}`, `/data/demo-superadmin-usage.json?t=${stamp}`]
    : [
        `${API_BASE}/data?t=${stamp}`,
        `/data/superadmin-usage.json?t=${stamp}`,
        `/data/demo-superadmin-usage.json?t=${stamp}`,
      ];

  let lastError = null;
  for (const url of urls) {
    try {
      return await fetchJson(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('usage data unavailable');
}

export async function fetchCapacityUsageStatus() {
  try {
    return await fetchJson(`${API_BASE}/status?t=${Date.now()}`);
  } catch {
    return { ok: false };
  }
}

export async function postCapacityUsageSync() {
  try {
    return await fetchJson(`${API_BASE}/sync`, { method: 'POST' });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
