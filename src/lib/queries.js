import { supabase } from './supabase';

// Real session data source resolution:
// - Production (deployed): VITE_SESSIONS_URL (Supabase Storage public bucket)
// - Development (Vite dev): /data/sessions.json from public folder
// - Fallback: demo data
export const IS_PROD = typeof window !== 'undefined'
  && window.location.hostname !== 'localhost'
  && window.location.hostname !== '127.0.0.1';

const REMOTE_SESSIONS_URL = import.meta.env.VITE_SESSIONS_URL || null;

let REAL_SESSIONS = null;
let REAL_SESSIONS_PROMISE = null;

async function loadRealSessions() {
  if (REAL_SESSIONS) return REAL_SESSIONS;
  if (REAL_SESSIONS_PROMISE) return REAL_SESSIONS_PROMISE;

  // In prod, fetch from remote URL. In dev, fetch from local public folder.
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

export async function triggerSync() {
  try {
    const r = await fetch('/api/sync', { method: 'POST' });
    const result = await r.json();
    if (result.ok) {
      invalidateRealSessions();
    }
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

// Demo data fallback (only if no real data and no Supabase)
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
    const model = models[Math.random() > 0.4 ? 0 : 1];
    const isOpus = model.includes('opus');
    const cost = (inputTokens / 1e6) * (isOpus ? 15 : 3) + (outputTokens / 1e6) * (isOpus ? 75 : 15);

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
      cache_creation_tokens: Math.floor(Math.random() * 100000),
      cache_read_tokens: cacheRead,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: parseFloat(cost.toFixed(4)),
      cat_type: catTypes[Math.floor(Math.random() * catTypes.length)],
      is_ghost: Math.random() > 0.85,
    });
  }
  return sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
}

function filterByDateRange(data, dateField, days) {
  if (days === 'all') return data;
  const cutoff = new Date(Date.now() - days * 86400000);
  return data.filter((d) => new Date(d[dateField]) >= cutoff);
}

export async function fetchSessions(dateRange = 30) {
  if (!supabase) {
    const real = await loadRealSessions();
    const source = real || DEMO_SESSIONS;
    return filterByDateRange(source, 'started_at', dateRange);
  }
  const cutoff = dateRange === 'all' ? '2020-01-01' : new Date(Date.now() - dateRange * 86400000).toISOString();
  const { data } = await supabase
    .from('meow_ops_sessions')
    .select('*')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false });
  return data || [];
}

export async function fetchDailyStats(dateRange = 30) {
  if (!supabase) {
    const real = await loadRealSessions();
    const source = real || DEMO_SESSIONS;
    const sessions = filterByDateRange(source, 'started_at', dateRange);
    const byDate = {};
    for (const s of sessions) {
      const date = s.started_at.slice(0, 10);
      if (!byDate[date]) {
        byDate[date] = { date, session_count: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, total_tool_calls: 0, estimated_cost_usd: 0, active_projects: new Set(), ghost_count: 0 };
      }
      byDate[date].session_count++;
      byDate[date].total_input_tokens += s.input_tokens;
      byDate[date].total_output_tokens += s.output_tokens;
      byDate[date].total_tokens += s.total_tokens;
      byDate[date].estimated_cost_usd += s.estimated_cost_usd;
      byDate[date].active_projects.add(s.project);
      if (s.is_ghost) byDate[date].ghost_count++;
    }
    return Object.values(byDate)
      .map((d) => ({ ...d, active_projects: d.active_projects.size }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const cutoff = dateRange === 'all' ? '2020-01-01' : new Date(Date.now() - dateRange * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('meow_ops_daily')
    .select('*')
    .gte('date', cutoff)
    .order('date', { ascending: true });
  return data || [];
}

export async function fetchToolUsage(dateRange = 30) {
  if (!supabase) {
    const tools = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Agent', 'TodoWrite'];
    return tools.map((t) => ({
      tool_name: t,
      call_count: Math.floor(Math.random() * 500) + 50,
    }));
  }
  const { data } = await supabase.rpc('get_tool_usage_summary', { days: dateRange === 'all' ? 9999 : dateRange });
  return data || [];
}

export function computeOverviewStats(sessions) {
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = sessions.filter((s) => s.started_at.slice(0, 10) === today);
  const totalTokensToday = todaySessions.reduce((a, s) => a + s.total_tokens, 0);
  const totalCostToday = todaySessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  const projectsToday = new Set(todaySessions.map((s) => s.project)).size;

  const totalTokensAll = sessions.reduce((a, s) => a + s.total_tokens, 0);
  const totalCostAll = sessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  const projectsAll = new Set(sessions.map((s) => s.project)).size;
  const ghostCount = sessions.filter((s) => s.is_ghost).length;

  return {
    sessionsToday: todaySessions.length,
    tokensToday: totalTokensToday,
    costToday: totalCostToday,
    projectsToday,
    totalSessions: sessions.length,
    totalTokens: totalTokensAll,
    totalCost: totalCostAll,
    totalProjects: projectsAll,
    ghostCount,
    healthRatio: sessions.length > 0 ? ((sessions.length - ghostCount) / sessions.length * 100).toFixed(0) : 100,
  };
}

export function getProjectBreakdown(sessions) {
  const byProject = {};
  for (const s of sessions) {
    if (!byProject[s.project]) {
      byProject[s.project] = { project: s.project, sessions: 0, tokens: 0, cost: 0, lastActive: s.started_at };
    }
    byProject[s.project].sessions++;
    byProject[s.project].tokens += s.total_tokens;
    byProject[s.project].cost += s.estimated_cost_usd;
    if (s.started_at > byProject[s.project].lastActive) byProject[s.project].lastActive = s.started_at;
  }
  return Object.values(byProject).sort((a, b) => b.tokens - a.tokens);
}

export function getToolBreakdownFromSessions(sessions) {
  const tools = {};
  for (const s of sessions) {
    // Prefer real tool counts when available; fall back to synthetic profile
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

function getCatToolProfile(catType) {
  const profiles = {
    builder: { Write: 15, Edit: 12, Read: 5, Bash: 8 },
    detective: { Read: 20, Grep: 15, Glob: 10, Bash: 5 },
    commander: { Bash: 25, Read: 5, Write: 3 },
    architect: { Agent: 10, Read: 15, Write: 5, EnterPlanMode: 3 },
    guardian: { Grep: 12, Read: 18, Bash: 8 },
    storyteller: { Write: 18, Read: 8, Edit: 6 },
    ghost: {},
  };
  return profiles[catType] || {};
}

export function getModelBreakdown(sessions) {
  const byModel = {};
  for (const s of sessions) {
    const model = s.model || 'unknown';
    if (!byModel[model]) byModel[model] = { model, sessions: 0, tokens: 0, cost: 0 };
    byModel[model].sessions++;
    byModel[model].tokens += s.total_tokens;
    byModel[model].cost += s.estimated_cost_usd;
  }
  return Object.values(byModel).sort((a, b) => b.cost - a.cost);
}
