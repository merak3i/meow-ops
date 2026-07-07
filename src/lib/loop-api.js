// Local-first Loop Engineering fetchers. These talk only to the helper on the
// user's machine and intentionally have no demo-data fallback.

const LOCAL_SYNC_URLS = [
  import.meta.env.VITE_LOCAL_SYNC_URL,
  'http://127.0.0.1:7337',
  'http://localhost:7337',
].filter(Boolean);

const LOCAL_SYNC_HEADERS = { 'x-meow-ops-local': '1' };
const EMPTY_SUMMARY = { counts_by_status: {}, open_per_loop: {}, total: 0 };

let LOOP_API_BASE = null;
let LOOP_API_PROBE = null;

function withCacheBust(url) {
  return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
}

async function fetchJson(url, init) {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...LOCAL_SYNC_HEADERS, 'Content-Type': 'application/json' },
      mode: 'cors',
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: data?.error || `HTTP ${response.status}` };
    }
    return data;
  } catch {
    return null;
  }
}

async function resolveLoopApiBase(force = false) {
  if (!force && LOOP_API_BASE) return LOOP_API_BASE;
  if (!force && LOOP_API_PROBE) return LOOP_API_PROBE;

  LOOP_API_PROBE = (async () => {
    for (const base of LOCAL_SYNC_URLS) {
      const summary = await fetchJson(withCacheBust(`${base}/loop-eng/summary`), {
        headers: LOCAL_SYNC_HEADERS,
        mode: 'cors',
      });
      if (summary) {
        LOOP_API_BASE = base;
        return base;
      }
    }
    LOOP_API_BASE = null;
    return null;
  })();

  try {
    return await LOOP_API_PROBE;
  } finally {
    LOOP_API_PROBE = null;
  }
}

async function fetchLoopJson(path) {
  const base = await resolveLoopApiBase();
  if (!base) return null;

  const data = await fetchJson(withCacheBust(`${base}${path}`), {
    headers: LOCAL_SYNC_HEADERS,
    mode: 'cors',
  });
  if (data) return data;

  if (LOOP_API_BASE === base) LOOP_API_BASE = null;
  return null;
}

export async function fetchLoopProposals() {
  const data = await fetchLoopJson('/loop-eng/proposals');
  return Array.isArray(data) ? data : [];
}

export async function fetchLoopDecisions() {
  const data = await fetchLoopJson('/loop-eng/decisions');
  return Array.isArray(data) ? data : [];
}

export async function fetchLoopRuns() {
  const data = await fetchLoopJson('/loop-eng/runs');
  return Array.isArray(data) ? data : [];
}

export async function fetchLoopComparisons() {
  const data = await fetchLoopJson('/loop-eng/comparisons');
  return Array.isArray(data) ? data : [];
}

export async function fetchLoopSimulations() {
  const data = await fetchLoopJson('/loop-eng/simulations');
  return Array.isArray(data) ? data : [];
}

export async function fetchLoopOutcomes() {
  const data = await fetchLoopJson('/loop-eng/outcomes');
  return Array.isArray(data) ? data : [];
}

export async function fetchLoopSummary() {
  const data = await fetchLoopJson('/loop-eng/summary');
  return data && typeof data === 'object' ? data : EMPTY_SUMMARY;
}

export async function fetchLoopDigest() {
  const data = await fetchLoopJson('/loop-eng/digest');
  return data && typeof data === 'object' && !data.error ? data : null;
}

export async function fetchLoopNonce() {
  const data = await fetchLoopJson('/loop-eng/nonce');
  return typeof data?.nonce === 'string' ? data.nonce : null;
}

export async function postLoopDecision({ proposal_id, decision, reason, undo_of }) {
  const base = await resolveLoopApiBase(true);
  if (!base) return null;

  const nonce = await fetchLoopNonce();
  if (!nonce) return null;

  const result = await postJson(`${base}/loop-eng/decisions`, {
    nonce,
    proposal_id,
    decision,
    reason,
    undo_of,
  });
  return result && typeof result === 'object' ? result : null;
}

export async function postLoopExecute({ proposal_id }) {
  const base = await resolveLoopApiBase(true);
  if (!base) return null;

  const nonce = await fetchLoopNonce();
  if (!nonce) return null;

  const result = await postJson(`${base}/loop-eng/execute`, { nonce, proposal_id });
  return result && typeof result === 'object' ? result : null;
}
