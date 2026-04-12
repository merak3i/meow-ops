import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { PasswordGate } from './components/PasswordGate';
import Sidebar from './components/Sidebar';
import DateFilter from './components/DateFilter';
import Overview from './pages/Overview';
import Sessions from './pages/Sessions';
import ByProject from './pages/ByProject';
import ByDay from './pages/ByDay';
import ByAction from './pages/ByAction';
import CostTracker from './pages/CostTracker';
import Pomodoro from './pages/Pomodoro';

// Heavy pages — code-split to keep the main bundle lean
const AnalyticsDashboard = lazy(() => import('./pages/AnalyticsDashboard'));
const CompanionPageV2    = lazy(() => import('./companion-v2/CompanionPageV2'));
const AgentVisualizer    = lazy(() => import('./pages/AgentVisualizer'));
// MMORPG unit-frame visualizer (uses local session data)
const ScryingSanctum     = lazy(() => import('./pages/ScryingSanctum'));
// D3/Realtime visualizer kept at './scrying-sanctum/ScryingSanctum' for future use
import {
  fetchSessions,
  fetchAllSessions,
  fetchDailyStats,
  fetchCostSummary,
  filterDailySummaryByRange,
  fillMissingDays,
  computeOverviewStats,
  getProjectBreakdown,
  getToolBreakdownFromSessions,
  getModelBreakdown,
  invalidateRealSessions,
  hasNoData,
} from './lib/queries';

const AUTO_REFRESH_MS = 5 * 60 * 1000;

// ─── Page loader ─────────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, color: 'var(--text-muted)', fontSize: 14 }}>
      Loading…
    </div>
  );
}

// ─── No-data splash ───────────────────────────────────────────────────────────
function NoDataScreen() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '80vh', gap: 20, textAlign: 'center',
      padding: '0 48px',
    }}>
      <span style={{ fontSize: 48 }}>🐱</span>
      <h2 style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-primary)', margin: 0 }}>
        No session data yet
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 480, lineHeight: 1.7, margin: 0 }}>
        Run the sync script to parse your Claude Code sessions:
      </p>
      <pre style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '12px 20px', fontSize: 13,
        color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace',
      }}>
        node sync/export-local.mjs
      </pre>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
        Then hit the sync button in the sidebar, or refresh this page.
      </p>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('overview');
  const [dateRange, setDateRange] = useState(30);

  // Two session arrays:
  //   sessions    — date-filtered, used for display (table, charts, per-page views)
  //   allSessions — no date filter, used for spend breakdown so week/month cards
  //                 are never truncated by the date-range selector
  const [sessions,    setSessions]    = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [dailyData,   setDailyData]   = useState([]);
  const [costSummary, setCostSummary] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [noData,      setNoData]      = useState(false);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [rateLimits,  setRateLimits]  = useState(null);

  // Token budgets — weekly and monthly limits per source (persisted in localStorage)
  const [tokenBudget, setTokenBudget] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('meow-ops-token-budget')) ||
        { claude: { week: 0, month: 0 }, codex: { week: 0, month: 0 } };
    } catch { return { claude: { week: 0, month: 0 }, codex: { week: 0, month: 0 } }; }
  });

  const saveBudget = useCallback((next) => {
    setTokenBudget(next);
    localStorage.setItem('meow-ops-token-budget', JSON.stringify(next));
  }, []);

  // Main data load
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      // Fetch everything in parallel
      const [sess, all, summary] = await Promise.all([
        fetchSessions(dateRange),
        fetchAllSessions(),
        fetchCostSummary(),
      ]);

      if (cancelled) return;

      // Check for genuine "no data" state (sessions.json missing or empty)
      const empty = await hasNoData();
      setNoData(empty && sess.length === 0);

      setSessions(sess);
      setAllSessions(all);
      if (summary) setCostSummary(summary);

      // Use cost-summary.daily_summary when available — it covers ALL sessions
      // (no 1000-session cap). Fall back to computing from the in-memory array.
      const raw = summary?.daily_summary?.length
        ? filterDailySummaryByRange(summary.daily_summary, dateRange)
        : await fetchDailyStats(dateRange, summary);

      setDailyData(fillMissingDays(raw, dateRange));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange, reloadKey]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(() => {
      invalidateRealSessions();
      setReloadKey((k) => k + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Fetch cached rate limit data (populated by sync/fetch-claude-limits.mjs)
  useEffect(() => {
    fetch('/data/rate-limits.json')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setRateLimits(data); })
      .catch(() => {});
  }, []);

  const reloadData = useCallback(() => {
    invalidateRealSessions();
    setReloadKey((k) => k + 1);
  }, []);

  const stats       = computeOverviewStats(sessions, dateRange);
  const projectData = getProjectBreakdown(sessions);
  const toolData    = getToolBreakdownFromSessions(sessions);
  const modelData   = getModelBreakdown(sessions);

  // Source breakdown for sidebar + overview — computed from ALL sessions (no date filter)
  // Also computes this-week and this-month token usage for budget tracking
  const sourceStats = useMemo(() => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const acc = {
      claude: { sessions: 0, cost: 0, tokens: 0, weekTokens: 0, monthTokens: 0, weekSessions: 0, monthSessions: 0 },
      codex:  { sessions: 0, cost: 0, tokens: 0, weekTokens: 0, monthTokens: 0, weekSessions: 0, monthSessions: 0 },
    };
    allSessions.forEach(s => {
      const src = s.source === 'codex' ? 'codex' : 'claude';
      const tok = s.total_tokens || 0;
      acc[src].sessions++;
      acc[src].cost   += s.estimated_cost_usd || 0;
      acc[src].tokens += tok;

      const d = new Date(s.started_at);
      if (d >= weekStart)  { acc[src].weekTokens  += tok; acc[src].weekSessions++;  }
      if (d >= monthStart) { acc[src].monthTokens += tok; acc[src].monthSessions++; }
    });
    return acc;
  }, [allSessions]);

  const renderPage = () => {
    if (noData) return <NoDataScreen />;

    switch (page) {
      case 'overview':
        return (
          <Overview
            stats={stats}
            sessions={sessions}
            allSessions={allSessions}
            dailyData={dailyData}
            toolData={toolData}
            costSummary={costSummary}
            dateRange={dateRange}
            sourceStats={sourceStats}
            tokenBudget={tokenBudget}
            onBudgetChange={saveBudget}
          />
        );
      case 'sessions':
        return <Sessions sessions={sessions} />;
      case 'by-project':
        return <ByProject projectData={projectData} />;
      case 'by-day':
        return <ByDay dailyData={dailyData} dateRange={dateRange} />;
      case 'by-action':
        return <ByAction toolData={toolData} />;
      case 'cost':
        return (
          <CostTracker
            dailyData={dailyData}
            modelData={modelData}
            stats={stats}
            costSummary={costSummary}
          />
        );
      case 'pomodoro':
        return <Pomodoro />;
      case 'analytics':
        return (
          <Suspense fallback={<PageLoader />}>
            <AnalyticsDashboard
              sessions={allSessions}
              dailySummary={costSummary?.daily_summary ?? []}
            />
          </Suspense>
        );
      case 'companion':
        return (
          <Suspense fallback={<PageLoader />}>
            <CompanionPageV2 sessions={allSessions} />
          </Suspense>
        );
      case 'agent-ops':
        return (
          <Suspense fallback={<PageLoader />}>
            <AgentVisualizer sessions={allSessions} />
          </Suspense>
        );
      case 'sanctum':
        return (
          <Suspense fallback={<PageLoader />}>
            <ScryingSanctum sessions={allSessions} onReload={reloadData} />
          </Suspense>
        );
      default:
        return (
          <Overview
            stats={stats}
            sessions={sessions}
            allSessions={allSessions}
            dailyData={dailyData}
            toolData={toolData}
            costSummary={costSummary}
            dateRange={dateRange}
            sourceStats={sourceStats}
            tokenBudget={tokenBudget}
            onBudgetChange={saveBudget}
          />
        );
    }
  };

  return (
    <PasswordGate>
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar activePage={page} onNavigate={setPage} onReload={reloadData} sourceStats={sourceStats} tokenBudget={tokenBudget} onBudgetChange={saveBudget} />

      <main style={{
        marginLeft: 'var(--sidebar-w)', flex: 1,
        ...(page === 'sanctum'
          ? { padding: 0, maxWidth: 'none', display: 'flex', flexDirection: 'column', height: '100vh' }
          : { padding: 32, maxWidth: 1280 }),
      }}>
        {page !== 'pomodoro' && page !== 'companion' && page !== 'live' &&
         page !== 'agent-ops' && page !== 'analytics' && page !== 'sanctum' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
            <DateFilter value={dateRange} onChange={setDateRange} />
          </div>
        )}

        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 400, color: 'var(--text-muted)', fontSize: 14,
          }}>
            Loading…
          </div>
        ) : (
          renderPage()
        )}
      </main>
    </div>
    </PasswordGate>
  );
}
