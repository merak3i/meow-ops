// ─── Source resolution ────────────────────────────────────────────────────────
// Local-first default:
// - localhost: read /data/*.json served by Vite from public/
// - deployed app on the same machine: prefer localhost helper on 127.0.0.1
// - public fallback: demo data only

export const IS_PROD = typeof window !== 'undefined'
  && window.location.hostname !== 'localhost'
  && window.location.hostname !== '127.0.0.1';

const LOCAL_SYNC_URLS = [
  import.meta.env.VITE_LOCAL_SYNC_URL,
  'http://127.0.0.1:7337',
  'http://localhost:7337',
].filter(Boolean);
const LOCAL_SYNC_HEADERS = { 'x-meow-ops-local': '1' };

let LOCAL_SYNC_BASE = null;
let LOCAL_SYNC_PROBE = null;

function withCacheBust(url) {
  return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
}

async function fetchJson(url, init) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...init });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function resolveLocalSyncBase(force = false) {
  if (IS_PROD) return null;
  if (!force && LOCAL_SYNC_BASE) return LOCAL_SYNC_BASE;
  if (!force && LOCAL_SYNC_PROBE) return LOCAL_SYNC_PROBE;

  LOCAL_SYNC_PROBE = (async () => {
    for (const base of LOCAL_SYNC_URLS) {
      const status = await fetchJson(withCacheBust(`${base}/sync/status`), {
        headers: LOCAL_SYNC_HEADERS,
        mode: 'cors',
      });
      if (status) {
        LOCAL_SYNC_BASE = base;
        return base;
      }
    }
    LOCAL_SYNC_BASE = null;
    return null;
  })();

  try {
    return await LOCAL_SYNC_PROBE;
  } finally {
    LOCAL_SYNC_PROBE = null;
  }
}

async function fetchLocalJson(path) {
  const base = await resolveLocalSyncBase();
  if (!base) return null;

  const data = await fetchJson(withCacheBust(`${base}${path}`), {
    headers: LOCAL_SYNC_HEADERS,
    mode: 'cors',
  });
  if (data) return data;

  if (LOCAL_SYNC_BASE === base) LOCAL_SYNC_BASE = null;
  return null;
}

// ─── In-memory session cache ──────────────────────────────────────────────────
let DASHBOARD_PROMISE = null;
let LAST_GOOD_DASHBOARD = null;
let DASHBOARD_EPOCH = 0;

// Numeric fields that must be finite, non-negative numbers. sessions.json is
// generated locally and fetched at runtime; a schema drift or a malformed row
// would otherwise feed NaN into every reduce() and silently break all totals.
const NUMERIC_FIELDS = [
  'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
  'total_tokens', 'estimated_cost_usd', 'duration_seconds', 'message_count',
];
const NULLABLE_FIELDS = new Set([
  'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
  'total_tokens', 'estimated_cost_usd', 'observed_cost_usd',
]);

function coerceNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function estimatedCost(session) {
  return ['unknown', 'default', 'family', 'unavailable'].includes(session.pricing_source)
    || session.cost_available === false ? null : nullableNumber(session.estimated_cost_usd);
}

function emptyCostBucket() {
  return { cost: null, estimated_cost_usd: null, observed_cost_usd: null,
    estimated_cost_sessions: 0, observed_cost_sessions: 0, unavailable_cost_sessions: 0 };
}

function addCostToBucket(bucket, session) {
  const estimate = estimatedCost(session);
  const observed = nullableNumber(session.observed_cost_usd);
  if (estimate !== null) {
    bucket.estimated_cost_usd = (bucket.estimated_cost_usd ?? 0) + estimate;
    bucket.cost = bucket.estimated_cost_usd;
    bucket.estimated_cost_sessions += 1;
  }
  if (observed !== null) {
    bucket.observed_cost_usd = (bucket.observed_cost_usd ?? 0) + observed;
    bucket.observed_cost_sessions += 1;
  }
  if (estimate === null && observed === null) bucket.unavailable_cost_sessions += 1;
  return bucket;
}

export function summarizeCosts(sessions) {
  return sessions.reduce(addCostToBucket, emptyCostBucket());
}

// Validate + repair fetched session rows at the trust boundary. Drops anything
// that isn't an object with a session_id; clamps numeric fields so one bad row
// can't poison aggregate stats.
function sanitizeSessions(data) {
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const row of data) {
    if (!row || typeof row !== 'object' || typeof row.session_id !== 'string') continue;
    const s = { ...row };
    for (const f of NUMERIC_FIELDS) s[f] = NULLABLE_FIELDS.has(f) ? nullableNumber(s[f]) : coerceNum(s[f]);
    if (s.usage_available === false) {
      for (const f of NULLABLE_FIELDS) if (f.endsWith('tokens')) s[f] = null;
    }
    s.estimated_cost_usd = estimatedCost(s);
    s.observed_cost_usd = nullableNumber(s.observed_cost_usd);
    s.cost_available = s.estimated_cost_usd !== null || s.observed_cost_usd !== null;
    s.cost_kind = s.observed_cost_usd !== null ? 'observed' : s.estimated_cost_usd !== null ? 'estimated' : 'unavailable';
    if (!s.tools || typeof s.tools !== 'object') s.tools = {};
    out.push(s);
  }
  return out;
}

async function loadDashboard() {
  if (DASHBOARD_PROMISE) return DASHBOARD_PROMISE;
  const epoch = DASHBOARD_EPOCH;
  DASHBOARD_PROMISE = (async () => {
    const base = await resolveLocalSyncBase();
    const snapshotUrl = base ? `${base}/data/snapshot.json` : IS_PROD ? '/data/snapshot.json' : '/api/data/snapshot.json';
    const init = base ? { headers: LOCAL_SYNC_HEADERS, mode: 'cors' } : undefined;
    let status = 0;
    let data = null;
    try {
      const response = await fetch(withCacheBust(snapshotUrl), { signal: AbortSignal.timeout(8000), ...init });
      status = response.status ?? (response.ok ? 200 : 404);
      // Static preview servers return the SPA HTML for an absent /api route.
      // Only that same-origin compatibility case counts as a missing endpoint.
      if (!base && response.ok && response.headers?.get('content-type')?.includes('text/html')) status = 404;
      else if (response.ok) data = await response.json();
    } catch { /* A failed validated read must not fall through to mixed legacy files. */ }
    if (status === 200 && data?.schemaVersion === 1 && typeof data.generation?.id === 'string' && Array.isArray(data.sessions) && data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary)) {
      const snapshot = {
        state: data.lastGood ? 'last-good' : 'verified', generation: data.generation,
        warning: data.warning || (data.lastGood ? 'Showing the last verified snapshot.' : null),
      };
      const bundle = { sessions: sanitizeSessions(data.sessions), summary: { ...data.summary, snapshot } };
      if (epoch === DASHBOARD_EPOCH) LAST_GOOD_DASHBOARD = bundle;
      return bundle;
    }
    if (status === 404) {
      // Both compatibility files come from the same origin and request cycle.
      // Older helpers cannot prove that the pair belongs to one generation.
      const [sessions, summary] = await Promise.all([
        fetchJson(withCacheBust(`${base || ''}/data/sessions.json`), init),
        fetchJson(withCacheBust(`${base || ''}/data/cost-summary.json`), init),
      ]);
      return {
        sessions: sessions === null ? null : sanitizeSessions(sessions),
        summary: { ...(summary || {}), snapshot: { state: 'legacy-unverified', generation: null, warning: 'Legacy snapshot: sessions and summary have not been verified as one generation.' } },
      };
    }
    const warning = 'The current snapshot could not be verified. ' + (LAST_GOOD_DASHBOARD ? 'Showing the last verified snapshot.' : 'No verified snapshot is available.');
    return {
      sessions: LAST_GOOD_DASHBOARD?.sessions || [],
      summary: { ...(LAST_GOOD_DASHBOARD?.summary || {}), snapshot: { state: LAST_GOOD_DASHBOARD ? 'last-good' : 'unavailable', generation: LAST_GOOD_DASHBOARD?.summary?.snapshot?.generation || null, warning } },
    };
  })();
  return DASHBOARD_PROMISE;
}

async function loadRealSessions() {
  return (await loadDashboard()).sessions;
}

export function invalidateRealSessions() {
  DASHBOARD_EPOCH++;
  DASHBOARD_PROMISE = null;
}

// ─── Cost summary (covers ALL sessions, no cap) ───────────────────────────────
export async function fetchCostSummary() {
  return (await loadDashboard()).summary;
}

// ─── Sync trigger / status ────────────────────────────────────────────────────

export async function triggerSync() {
  const status = await getSyncStatus();
  const base = status.mode === 'dev-sync' ? null : await resolveLocalSyncBase(true);
  const url = status.mode === 'dev-sync' ? '/api/sync' : base && `${base}/sync`;

  if (!url) {
    return {
      ok: false,
      error: 'Local sync helper is offline. Start `node sync/local-api.mjs` on this machine.',
    };
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      ...(base ? { headers: LOCAL_SYNC_HEADERS, mode: 'cors' } : {}),
    });
    const result = await r.json();
    if (result.ok) invalidateRealSessions();
    else if (IS_PROD) LOCAL_SYNC_BASE = null;
    return result;
  } catch (err) {
    if (IS_PROD) LOCAL_SYNC_BASE = null;
    return { ok: false, error: err.message };
  }
}

export async function getSyncStatus() {
  const base = await resolveLocalSyncBase();
  const result = base && await fetchJson(withCacheBust(`${base}/sync/status`), {
    headers: LOCAL_SYNC_HEADERS,
    mode: 'cors',
  });
  if (result) return { ...result, mode: 'local-sync' };
  LOCAL_SYNC_BASE = null;
  if (!IS_PROD) {
    const dev = await fetchJson('/api/sync/status');
    if (dev?.state) return { ...dev, mode: 'dev-sync' };
  }
  return { ok: false, mode: 'refresh-only', error: 'Local sync is disconnected. Open the local dashboard for private history.' };
}

export function isDemoData(sessions = [], summary = null) {
  return summary?.source === 'synthetic-demo'
    || (sessions.length > 0 && sessions.every(session => session.is_demo || /^demo-session-\d+$/.test(session.session_id)));
}

// Calendar labels use the operator's timezone. Rolling bounds use UTC instants.
const IST = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function activityDate(s) {
  return s.ended_at || s.started_at;
}

function activityDay(s) {
  return new Date(activityDate(s)).toLocaleDateString('en-CA', { timeZone: IST });
}

// Returns local midnight for a calendar-date string "YYYY-MM-DD".
function istMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

// ─── Date filter ─────────────────────────────────────────────────────────────
// dateRange can be:
//   'all'  — no filter
//   '1h'   — last 60 minutes
//   '24h'  — last 24 hours
//   number — last N rolling 24-hour periods

export function getDateRangeBounds(dateRange, now = Date.now()) {
  const duration = dateRange === '1h' ? 3_600_000 : dateRange === '24h' ? 86_400_000 : Number(dateRange) * 86_400_000;
  return {
    from: dateRange === 'all' ? null : new Date(now - duration).toISOString(),
    to: new Date(now).toISOString(),
  };
}

export function getSessionFilters(dateRange, now, filters = {}) {
  const custom = Boolean(filters.from || filters.to);
  const bounds = getDateRangeBounds(custom ? 'all' : dateRange, now);
  for (const key of ['from', 'to']) {
    if (!filters[key]) continue;
    const value = new Date(`${filters[key]}T${key === 'to' ? '23:59:59.999' : '00:00:00'}`);
    if (!Number.isFinite(value.getTime())) return { error: 'Choose valid dates.' };
    bounds[key] = value.toISOString();
  }
  if (bounds.from && bounds.to && bounds.from > bounds.to) return { error: 'From date must be before to date.' };
  return { ...filters, ...bounds };
}

export function filterSessionScope(sessions, filters = {}) {
  if (filters.error) return [];
  const from = filters.from ? Date.parse(filters.from) : -Infinity;
  const to = filters.to ? Date.parse(filters.to) : Infinity;
  return sessions.filter((session) => {
    const activity = Date.parse(activityDate(session));
    return Number.isFinite(activity) && activity >= from && activity <= to
      && (!filters.project || session.project === filters.project)
      && (!filters.source || (session.source || 'claude') === filters.source)
      && (!filters.model || session.model === filters.model);
  });
}

function emptyAggregateBucket() {
  return { ...emptyCostBucket(), tokens: 0, sessions: 0, duration_seconds: 0 };
}

function addSessionToBucket(acc, s) {
  addCostToBucket(acc, s);
  acc.tokens += s.total_tokens || 0;
  acc.sessions += 1;
  acc.duration_seconds += s.duration_seconds || 0;
  return acc;
}

// ─── Demo data fallback ───────────────────────────────────────────────────────
// Only shown if no local sessions.json exists.
const DEMO_SESSIONS = generateDemoData();

function generateDemoData() {
  const projects = ['acme-app', 'design-system', 'mobile-client', 'data-pipeline', 'meow-ops'];
  const models = ['claude-opus-4-6', 'claude-sonnet-4-6'];
  const catTypes = ['builder', 'detective', 'commander', 'architect', 'guardian', 'storyteller'];
  const sessions = [];

  for (let i = 0; i < 80; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const started = new Date(Date.now() - daysAgo * 86400000 - Math.random() * 43200000);
    const duration = Math.floor(Math.random() * 7200) + 300;
    const inputTokens = Math.floor(Math.random() * 500000) + 10000;
    const outputTokens = Math.floor(Math.random() * 200000) + 5000;
    const cacheRead = Math.floor(Math.random() * 300000);
    const cacheCreate = Math.floor(Math.random() * 100000);
    const model = models[Math.random() > 0.4 ? 0 : 1];
    const isOpus = model.includes('opus');
    const cost = (inputTokens / 1e6) * (isOpus ? 15 : 3)
      + (outputTokens / 1e6) * (isOpus ? 75 : 15)
      + (cacheCreate / 1e6) * (isOpus ? 18.75 : 3.75)
      + (cacheRead / 1e6) * (isOpus ? 1.5 : 0.3);

    sessions.push({
      is_demo: true,
      session_id: `sess-${i.toString().padStart(3, '0')}`,
      project: projects[Math.floor(Math.random() * projects.length)],
      model,
      entrypoint: Math.random() > 0.3 ? 'claude-desktop' : 'cli',
      git_branch: 'main',
      started_at: started.toISOString(),
      ended_at: new Date(started.getTime() + duration * 1000).toISOString(),
      duration_seconds: duration,
      message_count: Math.floor(Math.random() * 40) + 5,
      user_message_count: Math.floor(Math.random() * 20) + 3,
      assistant_message_count: Math.floor(Math.random() * 20) + 2,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_tokens: cacheCreate,
      cache_read_tokens: cacheRead,
      total_tokens: inputTokens + outputTokens + cacheCreate + cacheRead,
      estimated_cost_usd: parseFloat(cost.toFixed(4)),
      cat_type: catTypes[Math.floor(Math.random() * catTypes.length)],
      is_ghost: Math.random() > 0.85,
      source: 'claude',
    });
  }
  return sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
}

// ─── fetchSessions ────────────────────────────────────────────────────────────
// Returns sessions filtered by dateRange. The in-memory cache is re-used
// across date-range changes so we only fetch sessions.json once per page load.
export async function fetchSessions(dateRange = 30, now = Date.now()) {
  const real = await loadRealSessions();
  return filterSessionScope(real || DEMO_SESSIONS, getDateRangeBounds(dateRange, now));
}

// Returns the bounded compatibility preview with no date filter. Complete
// all-time totals and dimension rollups come from cost-summary.json.
export async function fetchAllSessions() {
  const real = await loadRealSessions();
  if (real) return real;
  return DEMO_SESSIONS;
}

// Query the uncapped local archive. Filters are applied by the local helper
// before a bounded page is sent to the browser.
export async function fetchSessionPage(options = {}) {
  const dashboard = await loadDashboard();
  const snapshot = dashboard.summary?.snapshot;
  // An archive append can precede publication, or publication can fail. Bind
  // the very first page to the generation that supplied the displayed totals.
  // Older helpers may ignore the boundary, so also verify the returned hash.
  const publishedVersion = dashboard.summary?.archive?.version;
  if (snapshot?.state !== 'legacy-unverified' && !publishedVersion) return null;
  const expectedVersion = options.expectedVersion || publishedVersion;
  const snapshotBytes = options.snapshotBytes ?? (expectedVersion === publishedVersion ? dashboard.summary?.archive?.snapshotBytes : undefined);
  const params = new URLSearchParams();
  const boundOptions = { ...options, expectedVersion, snapshotBytes };
  for (const key of ['limit', 'cursor', 'expectedVersion', 'snapshotBytes', 'from', 'to', 'project', 'source', 'model']) {
    const value = boundOptions[key];
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const path = `/session-history/sessions?${params.toString()}`;
  const data = await fetchLocalJson(path)
    || (!IS_PROD ? await fetchJson(withCacheBust(`/api${path}`)) : null);
  if (!data || !Array.isArray(data.items) || typeof data.archiveVersion !== 'string' || !data.archiveVersion) return null;
  if (expectedVersion && data.archiveVersion !== expectedVersion) return null;
  return {
    ...data,
    items: sanitizeSessions(data.items),
    total: coerceNum(data.total),
    limit: coerceNum(data.limit),
    nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
  };
}

// Archive cursors pin a read snapshot. Never merge a partial/failed page chain
// into preview data and call it complete.
export async function fetchRangeSessions(dateRange, now = Date.now()) {
  const dashboard = await loadDashboard();
  const bounds = getDateRangeBounds(dateRange, now);
  const items = [];
  const cursors = new Set();
  let cursor = null;
  let total = null;
  let expectedVersion = dashboard.summary?.archive?.version;
  const snapshotBytes = dashboard.summary?.archive?.snapshotBytes;
  do {
    const page = await fetchSessionPage({ ...bounds, limit: 500, cursor, expectedVersion, snapshotBytes });
    if (!page || (total !== null && total !== page.total)) break;
    if (expectedVersion && page.archiveVersion !== expectedVersion) break;
    expectedVersion = page.archiveVersion;
    total = page.total;
    items.push(...page.items);
    if (!page.nextCursor) {
      if (items.length === total && new Set(items.map(sessionIdentity)).size === total) {
        return { items, completeness: 'archive', error: null };
      }
      break;
    }
    if (cursors.has(page.nextCursor)) break;
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return { items: filterSessionScope(dashboard.sessions || DEMO_SESSIONS, bounds), completeness: 'preview', error: 'The published archive is unavailable. Showing matching sessions from the same snapshot preview.' };
}

function sessionIdentity(session) {
  return JSON.stringify([session.source || 'claude', session.session_id]);
}

// Load an exact bounded interval from one pinned archive generation. A failed
// page chain falls back as a whole to the compatibility preview, never a mix.
export async function fetchSessionWindow(from, to, filters = {}) {
  const dashboard = await loadDashboard();
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) {
    return { items: [], completeness: 'unavailable', error: 'The requested evidence window is invalid.' };
  }
  const bounds = { from: new Date(fromTime).toISOString(), to: new Date(toTime).toISOString(), ...filters };
  const items = [];
  const cursors = new Set();
  let cursor = null;
  let total = null;
  let expectedVersion = dashboard.summary?.archive?.version;
  const snapshotBytes = dashboard.summary?.archive?.snapshotBytes;
  do {
    const page = await fetchSessionPage({ ...bounds, limit: 500, cursor, expectedVersion, snapshotBytes });
    if (!page || (total !== null && total !== page.total)) break;
    if (expectedVersion && page.archiveVersion !== expectedVersion) break;
    expectedVersion = page.archiveVersion;
    total = page.total;
    items.push(...page.items);
    if (!page.nextCursor) {
      if (items.length === total && new Set(items.map(sessionIdentity)).size === total) {
        return { items, completeness: 'archive', error: null, archiveVersion: expectedVersion };
      }
      break;
    }
    if (cursors.has(page.nextCursor)) break;
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return {
    items: filterSessionScope(dashboard.sessions || DEMO_SESSIONS, bounds),
    completeness: 'preview',
    error: 'The complete local archive could not be read. Showing only matching preview records.',
  };
}

// Returns true when sessions.json is present but empty / missing
export async function hasNoData() {
  const real = await loadRealSessions();
  return real === null;
}

// ─── fetchDailyStats ──────────────────────────────────────────────────────────
// Exact ranges are calculated from session timestamps, never daily rollups.
export async function fetchDailyStats(dateRange = 30, _costSummary = null, now = Date.now()) {
  // Daily rollups cannot resolve the partially included first day of a rolling range.
  return buildDailyFromSessions(await fetchSessions(dateRange, now));
}

// Overlapping calendar buckets, for calendar context only. These buckets cannot
// produce exact rolling totals; fetchDailyStats uses timestamp-filtered sessions.
export function filterDailySummaryByRange(dailySummary, dateRange, now = Date.now()) {
  if (dateRange === 'all') return dailySummary;
  const bounds = getDateRangeBounds(dateRange, now);
  const first = new Date(bounds.from).toLocaleDateString('en-CA', { timeZone: IST });
  const last = new Date(bounds.to).toLocaleDateString('en-CA', { timeZone: IST });
  return dailySummary.filter((day) => day.date >= first && day.date <= last);
}

// Build daily stats from a session array (fallback when no daily_summary).
// Also used by the source-filtered Overview path.
export function buildDailyFromSessions(sessions) {
  const byDate = {};
  for (const s of sessions) {
    const date = activityDay(s);
    if (!byDate[date]) {
      byDate[date] = {
        date,
        session_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_creation: 0,
        total_cache_read: 0,
        total_tokens: 0,
        ...emptyCostBucket(),
        total_duration_seconds: 0,
        active_projects: new Set(),
        ghost_count: 0,
      };
    }
    byDate[date].session_count++;
    byDate[date].total_input_tokens  += s.input_tokens  || 0;
    byDate[date].total_output_tokens += s.output_tokens || 0;
    byDate[date].total_cache_creation += s.cache_creation_tokens || 0;
    byDate[date].total_cache_read    += s.cache_read_tokens      || 0;
    byDate[date].total_tokens        += s.total_tokens  || 0;
    addCostToBucket(byDate[date], s);
    byDate[date].total_duration_seconds += s.duration_seconds || 0;
    byDate[date].active_projects.add(s.project);
    if (s.is_ghost) byDate[date].ghost_count++;
  }
  return Object.values(byDate)
    .map((d) => ({ ...d, active_projects: d.active_projects.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Fill missing days ────────────────────────────────────────────────────────
// Ensures the ByDay chart always has one entry per calendar day in the range,
// with zeros for inactive days (no gaps, no jump-cuts in the area chart).
export function fillMissingDays(dailyData, dateRange, nowMs = Date.now()) {
  // Hour-based ranges are sub-day — no day-filling needed
  if (dateRange === '1h' || dateRange === '24h') return dailyData || [];
  if (dateRange === 'all' || !dailyData?.length) return dailyData || [];
  const existing = new Map(dailyData.map((d) => [d.date, d]));
  const filled = [];
  const d = new Date(getDateRangeBounds(dateRange, nowMs).from);
  d.setHours(0, 0, 0, 0);
  for (; d.getTime() <= nowMs; d.setDate(d.getDate() + 1)) {
    const date = d.toLocaleDateString('en-CA', { timeZone: IST });
    filled.push(existing.get(date) || {
      date,
      session_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_creation: 0,
      total_cache_read: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      total_duration_seconds: 0,
      active_projects: 0,
      ghost_count: 0,
    });
  }
  return filled;
}

// ─── computeOverviewStats ────────────────────────────────────────────────────
export function computeOverviewStats(sessions) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: IST });

  const todaySessions  = sessions.filter((s) => activityDay(s) === today);
  const tokensToday    = todaySessions.reduce((a, s) => a + s.total_tokens, 0);
  const costToday      = summarizeCosts(todaySessions).estimated_cost_usd;
  const projectsToday  = new Set(todaySessions.map((s) => s.project)).size;

  const totalTokens    = sessions.reduce((a, s) => a + s.total_tokens, 0);
  const costCoverage   = summarizeCosts(sessions);
  const totalCost      = costCoverage.estimated_cost_usd;
  const totalDuration  = sessions.reduce((a, s) => a + (s.duration_seconds || 0), 0);
  const totalProjects  = new Set(sessions.map((s) => s.project)).size;
  const ghostCount     = sessions.filter((s) => s.is_ghost).length;
  const healthRatio    = sessions.length > 0
    ? ((sessions.length - ghostCount) / sessions.length * 100).toFixed(0)
    : 100;

  return {
    periodSessions:  sessions.length,
    costCoverage,
    periodTokens:    totalTokens,
    periodCost:      totalCost,
    periodDuration:  totalDuration,
    periodProjects:  totalProjects,
    sessionsToday:   todaySessions.length,
    tokensToday,
    costToday,
    durationToday:   todaySessions.reduce((a, s) => a + (s.duration_seconds || 0), 0),
    projectsToday,
    // Legacy aliases kept for CostTracker compatibility
    totalSessions:   sessions.length,
    totalTokens,
    totalCost,
    totalDuration,
    totalProjects,
    ghostCount,
    healthRatio,
  };
}

// ─── computeTimeSpentBreakdown ───────────────────────────────────────────────
// Source-aware duration aggregation for the Overview "Time Spent" panel.
// Uses the same IST calendar boundaries as cost breakdowns so day/week/month
// totals line up with the rest of the dashboard.
export function computeTimeSpentBreakdown(sessions) {
  const now = new Date();
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: IST }));
  const dowIST = nowIST.getDay();
  const daysToMon = dowIST === 0 ? 6 : dowIST - 1;

  const thisWeekStartIST = new Date(nowIST);
  thisWeekStartIST.setDate(nowIST.getDate() - daysToMon);
  thisWeekStartIST.setHours(0, 0, 0, 0);
  const thisWeekStart = istMidnight(thisWeekStartIST.toLocaleDateString('en-CA'));

  const thisMonthStart = istMidnight(
    new Date(nowIST.getFullYear(), nowIST.getMonth(), 1).toLocaleDateString('en-CA'),
  );
  const thisYearStart = istMidnight(`${nowIST.getFullYear()}-01-01`);
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: IST });

  function bucket(predicate) {
    const total = emptyAggregateBucket();
    const bySource = {};
    for (const s of sessions) {
      if (!predicate(s)) continue;
      addSessionToBucket(total, s);
      const src = s.source || 'claude';
      if (!bySource[src]) bySource[src] = emptyAggregateBucket();
      addSessionToBucket(bySource[src], s);
    }
    return { ...total, bySource };
  }

  return {
    today: bucket((s) =>
      new Date(activityDate(s)).toLocaleDateString('en-CA', { timeZone: IST }) === todayStr,
    ),
    thisWeek: bucket((s) => new Date(activityDate(s)) >= thisWeekStart),
    thisMonth: bucket((s) => new Date(activityDate(s)) >= thisMonthStart),
    thisYear: bucket((s) => new Date(activityDate(s)) >= thisYearStart),
    allTime: bucket(() => true),
  };
}

// ─── computeSpendBreakdown ────────────────────────────────────────────────────
// NOTE: All week/month/year boundaries are computed in IST so they match the
// pre-computed values in cost-summary.json (also computed in IST by export-local.mjs).
// This prevents the "This Week shows different numbers than the spend card" bug
// that appeared when the browser was in a non-IST timezone.
export function computeSpendBreakdown(sessions) {
  const now = new Date();

  // Compute IST "now" to derive IST-accurate week/month/year boundaries.
  const nowIST     = new Date(now.toLocaleString('en-US', { timeZone: IST }));
  const dowIST     = nowIST.getDay(); // 0 = Sun
  const daysToMon  = dowIST === 0 ? 6 : dowIST - 1;

  // IST week start = this Monday at midnight IST
  const thisWeekStartIST = new Date(nowIST);
  thisWeekStartIST.setDate(nowIST.getDate() - daysToMon);
  thisWeekStartIST.setHours(0, 0, 0, 0);
  // Convert back to UTC-epoch-compatible Date for comparison
  const thisWeekStart = istMidnight(thisWeekStartIST.toLocaleDateString('en-CA'));

  const lastWeekEnd   = new Date(thisWeekStart.getTime() - 1);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  // IST month / year boundaries
  const thisMonthStart = istMidnight(
    new Date(nowIST.getFullYear(), nowIST.getMonth(), 1).toLocaleDateString('en-CA'),
  );
  const lastMonthStart = istMidnight(
    new Date(nowIST.getFullYear(), nowIST.getMonth() - 1, 1).toLocaleDateString('en-CA'),
  );
  const lastMonthEnd = new Date(thisMonthStart.getTime() - 1);

  const thisYearStart = istMidnight(`${nowIST.getFullYear()}-01-01`);
  const lastYearStart = istMidnight(`${nowIST.getFullYear() - 1}-01-01`);
  const lastYearEnd   = new Date(thisYearStart.getTime() - 1);

  function bucket(start, end) {
    return sessions.reduce((acc, s) => {
      const d = new Date(activityDate(s));
      if (d >= start && d <= end) {
        addSessionToBucket(acc, s);
      }
      return acc;
    }, emptyAggregateBucket());
  }
  const sumCost = (start, end) => bucket(start, end).cost;

  // Last 8 weeks (oldest first), ending with the current partial week.
  const weeklyHistory = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = new Date(thisWeekStart);
    wStart.setDate(thisWeekStart.getDate() - i * 7);
    const wEnd = i === 0 ? now : new Date(wStart.getTime() + 7 * 86_400_000 - 1);
    const label = i === 0
      ? 'This wk'
      : wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    weeklyHistory.push({ label, cost: sumCost(wStart, wEnd), isCurrent: i === 0 });
  }

  // Last 6 months (oldest first), ending with the current partial month.
  const monthlyHistory = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = istMidnight(
      new Date(nowIST.getFullYear(), nowIST.getMonth() - i, 1).toLocaleDateString('en-CA'),
    );
    const mEnd = i === 0
      ? now
      : new Date(istMidnight(
          new Date(nowIST.getFullYear(), nowIST.getMonth() - i + 1, 1).toLocaleDateString('en-CA'),
        ).getTime() - 1);
    const label = i === 0
      ? 'This mo'
      : mStart.toLocaleDateString('en-US', { month: 'short' });
    monthlyHistory.push({ label, cost: sumCost(mStart, mEnd), isCurrent: i === 0 });
  }

  // Per-source breakdown for the current calendar month.
  const bySource = {};
  for (const s of sessions) {
    const d = new Date(activityDate(s));
    if (d < thisMonthStart) continue;
    const src = s.source || 'claude';
    if (!bySource[src]) bySource[src] = emptyAggregateBucket();
    addSessionToBucket(bySource[src], s);
  }

  // Today bucket using IST day matching.
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: IST });
  const todayBucket = sessions.reduce((acc, s) => {
    if (new Date(activityDate(s)).toLocaleDateString('en-CA', { timeZone: IST }) === todayStr) {
      addSessionToBucket(acc, s);
    }
    return acc;
  }, emptyAggregateBucket());

  return {
    today:          todayBucket,
    thisWeek:       bucket(thisWeekStart, now),
    lastWeek:       bucket(lastWeekStart, lastWeekEnd),
    thisMonth:      bucket(thisMonthStart, now),
    lastMonth:      bucket(lastMonthStart, lastMonthEnd),
    thisYear:       bucket(thisYearStart, now),
    lastYear:       bucket(lastYearStart, lastYearEnd),
    allTime:        sessions.reduce((acc, s) => addSessionToBucket(acc, s), emptyAggregateBucket()),
    weeklyHistory,
    monthlyHistory,
    bySource,
  };
}

// ─── Project + tool + model breakdowns ───────────────────────────────────────
export function getProjectBreakdown(sessions) {
  const byProject = {};
  for (const s of sessions) {
    const last = activityDate(s);
    if (!byProject[s.project]) {
      byProject[s.project] = { project: s.project, sessions: 0, tokens: 0, ...emptyCostBucket(), lastActive: last };
    }
    byProject[s.project].sessions++;
    byProject[s.project].tokens += s.total_tokens;
    addCostToBucket(byProject[s.project], s);
    if (last > byProject[s.project].lastActive) byProject[s.project].lastActive = last;
  }
  return Object.values(byProject).sort((a, b) => b.tokens - a.tokens);
}

function getCatToolProfile(catType) {
  const profiles = {
    builder:     { Write: 15, Edit: 12, Read: 5, Bash: 8 },
    detective:   { Read: 20, Grep: 15, Glob: 10, Bash: 5 },
    commander:   { Bash: 25, Read: 5, Write: 3 },
    architect:   { Agent: 10, Read: 15, Write: 5, EnterPlanMode: 3 },
    guardian:    { Grep: 12, Read: 18, Bash: 8 },
    storyteller: { Write: 18, Read: 8, Edit: 6 },
    ghost:       {},
  };
  return profiles[catType] || {};
}

export function getToolBreakdownFromSessions(sessions) {
  const tools = {};
  for (const s of sessions) {
    const source = s.tools && Object.keys(s.tools).length > 0
      ? s.tools
      : getCatToolProfile(s.cat_type);
    for (const [tool, count] of Object.entries(source)) {
      tools[tool] = (tools[tool] || 0) + count;
    }
  }
  return Object.entries(tools)
    .map(([tool_name, call_count]) => ({ tool_name, call_count }))
    .sort((a, b) => b.call_count - a.call_count);
}

export function getModelBreakdown(sessions) {
  const byModel = {};
  for (const s of sessions) {
    const model = s.model || 'unknown';
    if (!byModel[model]) byModel[model] = { model, sessions: 0, tokens: 0, ...emptyCostBucket() };
    byModel[model].sessions++;
    byModel[model].tokens += s.total_tokens;
    addCostToBucket(byModel[model], s);
  }
  return Object.values(byModel).sort((a, b) => b.cost - a.cost);
}
