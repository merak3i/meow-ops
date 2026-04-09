import { supabase } from './supabase';

// ─── Source resolution ────────────────────────────────────────────────────────
// Production: VITE_SESSIONS_URL points to Supabase Storage public bucket.
// Development: /data/sessions.json served by Vite from public/.
// Fallback: demo data so new users see something on first run.

export const IS_PROD = typeof window !== 'undefined'
  && window.location.hostname !== 'localhost'
  && window.location.hostname !== '127.0.0.1';

const REMOTE_SESSIONS_URL = import.meta.env.VITE_SESSIONS_URL || null;

// Derive cost-summary URL from sessions URL — same bucket, different file.
// Override with VITE_COST_SUMMARY_URL if needed.
function deriveCostSummaryUrl() {
  const override = import.meta.env.VITE_COST_SUMMARY_URL;
  if (override) return override;
  if (IS_PROD && REMOTE_SESSIONS_URL) {
    return REMOTE_SESSIONS_URL.replace(/sessions\.json(\?.*)?$/, 'cost-summary.json');
  }
  return null; // dev: use relative path
}
const REMOTE_COST_SUMMARY_URL = deriveCostSummaryUrl();

// ─── In-memory session cache ──────────────────────────────────────────────────
let REAL_SESSIONS = null;
let REAL_SESSIONS_PROMISE = null;

async function loadRealSessions() {
  if (REAL_SESSIONS) return REAL_SESSIONS;
  if (REAL_SESSIONS_PROMISE) return REAL_SESSIONS_PROMISE;

  const url = (IS_PROD && REMOTE_SESSIONS_URL)
    ? REMOTE_SESSIONS_URL + '?t=' + Date.now()
    : '/data/sessions.json?t=' + Date.now();

  REAL_SESSIONS_PROMISE = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && Array.isArray(data) && data.length > 0) {
        REAL_SESSIONS = data;
        return data;
      }
      return null;
    })
    .catch(() => null);
  return REAL_SESSIONS_PROMISE;
}

export function invalidateRealSessions() {
  REAL_SESSIONS = null;
  REAL_SESSIONS_PROMISE = null;
}

// ─── Cost summary (covers ALL sessions, no cap) ───────────────────────────────
export async function fetchCostSummary() {
  try {
    const url = REMOTE_COST_SUMMARY_URL
      ? REMOTE_COST_SUMMARY_URL + '?t=' + Date.now()
      : '/data/cost-summary.json?t=' + Date.now();
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ─── Sync trigger (dev only) ──────────────────────────────────────────────────
export async function triggerSync() {
  try {
    const r = await fetch('/api/sync', { method: 'POST' });
    const result = await r.json();
    if (result.ok) invalidateRealSessions();
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getSyncStatus() {
  try {
    const r = await fetch('/api/sync/status');
    return await r.json();
  } catch {
    return { ok: false };
  }
}

// ─── IST helpers ─────────────────────────────────────────────────────────────
// All day bucketing uses IST so "today" matches the user's clock in India.
const IST = 'Asia/Kolkata';

function activityDate(s) {
  return s.ended_at || s.started_at;
}

function activityDay(s) {
  return new Date(activityDate(s)).toLocaleDateString('en-CA', { timeZone: IST });
}

// Returns midnight IST for a given calendar-date string "YYYY-MM-DD".
function istMidnight(dateStr) {
  // Parse as IST midnight by constructing in local IST offset.
  return new Date(`${dateStr}T00:00:00+05:30`);
}

// ─── Date filter ─────────────────────────────────────────────────────────────
function filterByDateRange(data, dateField, days) {
  if (days === 'all') return data;
  const cutoff = new Date(Date.now() - days * 86400000);
  return data.filter((d) => new Date(d[dateField]) >= cutoff);
}

// ─── Demo data fallback ───────────────────────────────────────────────────────
// Only shown if no sessions.json exists AND no Supabase is configured.
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
export async function fetchSessions(dateRange = 30) {
  const real = await loadRealSessions();
  if (real) return filterByDateRange(real, 'ended_at', dateRange);

  if (!supabase) return filterByDateRange(DEMO_SESSIONS, 'ended_at', dateRange);

  const cutoff = dateRange === 'all'
    ? '2020-01-01'
    : new Date(Date.now() - dateRange * 86400000).toISOString();
  const { data } = await supabase
    .from('meow_ops_sessions')
    .select('*')
    .gte('ended_at', cutoff)
    .order('ended_at', { ascending: false });
  return (data && data.length > 0) ? data : filterByDateRange(DEMO_SESSIONS, 'ended_at', dateRange);
}

// Returns ALL sessions with no date filter — used for spend breakdown so that
// "This Week" / "This Month" cards are never silently truncated by the
// date-range filter selected in the UI.
export async function fetchAllSessions() {
  const real = await loadRealSessions();
  if (real) return real;
  if (!supabase) return DEMO_SESSIONS;
  const { data } = await supabase
    .from('meow_ops_sessions')
    .select('*')
    .order('ended_at', { ascending: false });
  return (data && data.length > 0) ? data : DEMO_SESSIONS;
}

// Returns true when sessions.json is present but empty / missing
export async function hasNoData() {
  const real = await loadRealSessions();
  return real === null;
}

// ─── fetchDailyStats ──────────────────────────────────────────────────────────
// Prefers cost-summary.daily_summary (all sessions, no cap) when available.
// Falls back to computing from the in-memory sessions array.
export async function fetchDailyStats(dateRange = 30, costSummary = null) {
  // Use pre-computed daily_summary if we have it — it covers ALL sessions.
  if (costSummary?.daily_summary?.length) {
    return filterDailySummaryByRange(costSummary.daily_summary, dateRange);
  }

  // Compute from sessions.json (may be capped).
  const real = await loadRealSessions();
  const source = real || DEMO_SESSIONS;
  const sessions = filterByDateRange(source, 'ended_at', dateRange);
  return buildDailyFromSessions(sessions);
}

// Filter a daily_summary array by a dateRange (in days, or 'all').
export function filterDailySummaryByRange(dailySummary, dateRange) {
  if (dateRange === 'all') return dailySummary;
  const cutoff = new Date(Date.now() - dateRange * 86400000);
  const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: IST });
  return dailySummary.filter((d) => d.date >= cutoffStr);
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
        estimated_cost_usd: 0,
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
    byDate[date].estimated_cost_usd  += s.estimated_cost_usd || 0;
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
export function fillMissingDays(dailyData, dateRange) {
  if (dateRange === 'all' || !dailyData?.length) return dailyData || [];
  const existing = new Map(dailyData.map((d) => [d.date, d]));
  const filled = [];
  const now = new Date();
  for (let i = dateRange - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
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
      active_projects: 0,
      ghost_count: 0,
    });
  }
  return filled;
}

// ─── computeOverviewStats ────────────────────────────────────────────────────
export function computeOverviewStats(sessions, dateRange = 30) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: IST });

  const todaySessions  = sessions.filter((s) => activityDay(s) === today);
  const tokensToday    = todaySessions.reduce((a, s) => a + s.total_tokens, 0);
  const costToday      = todaySessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  const projectsToday  = new Set(todaySessions.map((s) => s.project)).size;

  const totalTokens    = sessions.reduce((a, s) => a + s.total_tokens, 0);
  const totalCost      = sessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  const totalProjects  = new Set(sessions.map((s) => s.project)).size;
  const ghostCount     = sessions.filter((s) => s.is_ghost).length;
  const healthRatio    = sessions.length > 0
    ? ((sessions.length - ghostCount) / sessions.length * 100).toFixed(0)
    : 100;

  return {
    periodSessions:  sessions.length,
    periodTokens:    totalTokens,
    periodCost:      totalCost,
    periodProjects:  totalProjects,
    sessionsToday:   todaySessions.length,
    tokensToday,
    costToday,
    projectsToday,
    // Legacy aliases kept for CostTracker compatibility
    totalSessions:   sessions.length,
    totalTokens,
    totalCost,
    totalProjects,
    ghostCount,
    healthRatio,
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
        acc.cost     += s.estimated_cost_usd;
        acc.tokens   += s.total_tokens;
        acc.sessions += 1;
      }
      return acc;
    }, { cost: 0, tokens: 0, sessions: 0 });
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
    if (!bySource[src]) bySource[src] = { sessions: 0, cost: 0, tokens: 0 };
    bySource[src].sessions++;
    bySource[src].cost   += s.estimated_cost_usd;
    bySource[src].tokens += s.total_tokens;
  }

  // Today bucket using IST day matching.
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: IST });
  const todayBucket = sessions.reduce((acc, s) => {
    if (new Date(activityDate(s)).toLocaleDateString('en-CA', { timeZone: IST }) === todayStr) {
      acc.cost += s.estimated_cost_usd;
      acc.tokens += s.total_tokens;
      acc.sessions++;
    }
    return acc;
  }, { cost: 0, tokens: 0, sessions: 0 });

  return {
    today:          todayBucket,
    thisWeek:       bucket(thisWeekStart, now),
    lastWeek:       bucket(lastWeekStart, lastWeekEnd),
    thisMonth:      bucket(thisMonthStart, now),
    lastMonth:      bucket(lastMonthStart, lastMonthEnd),
    thisYear:       bucket(thisYearStart, now),
    lastYear:       bucket(lastYearStart, lastYearEnd),
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
      byProject[s.project] = { project: s.project, sessions: 0, tokens: 0, cost: 0, lastActive: last };
    }
    byProject[s.project].sessions++;
    byProject[s.project].tokens += s.total_tokens;
    byProject[s.project].cost   += s.estimated_cost_usd;
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
    if (!byModel[model]) byModel[model] = { model, sessions: 0, tokens: 0, cost: 0 };
    byModel[model].sessions++;
    byModel[model].tokens += s.total_tokens;
    byModel[model].cost   += s.estimated_cost_usd;
  }
  return Object.values(byModel).sort((a, b) => b.cost - a.cost);
}
