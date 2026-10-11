// Client for /api/github-activity (Vercel function). Repository activity is
// public GitHub metadata, so it is available even when the local helper is not.

let CACHE = null;
const TTL_MS = 60_000;

export async function fetchGithubActivity({ force = false, signal } = {}) {
  if (!force && CACHE && Date.now() - CACHE.at < TTL_MS) return CACHE.data;
  try {
    const response = await fetch('/api/github-activity', { signal: signal ?? AbortSignal.timeout(10_000) });
    if (!response.headers.get('content-type')?.includes('application/json')) return null;
    const data = await response.json();
    if (!data || !Array.isArray(data.repos)) return null;
    CACHE = { at: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}
