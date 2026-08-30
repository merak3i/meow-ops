import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { PasswordGate } from './components/PasswordGate';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import DateFilter from './components/DateFilter';
import { CommandPalette } from './components/CommandPalette';
import { FocusChip } from './components/FocusChip';
import { EmptyState, Notice, PageHeader, Tabs } from './components/ui';
import { resolveChrome, surfaceById } from './components/nav-config';
import { useRoute } from './lib/useRoute';
import { useShortcuts } from './lib/useShortcuts';
import { useSync } from './lib/useSync';
import { useTheme } from './lib/useTheme';
import {
  fetchSessions,
  fetchAllSessions,
  fetchDailyStats,
  fetchCostSummary,
  filterDailySummaryByRange,
  fillMissingDays,
  computeOverviewStats,
  getModelBreakdown,
  invalidateRealSessions,
  hasNoData,
} from './lib/queries';

const AUTO_REFRESH_MS = 5 * 60 * 1000;

// One chunk per reachable location, keyed by the same `surface/tab` path the
// router produces. Adding a tab is one entry here plus one in nav-config.
const ROUTE_LOADERS = {
  'today/summary':  () => import('./pages/Overview'),
  'today/sessions': () => import('./pages/Sessions'),
  'today/runs':     () => import('./pages/AgentVisualizer'),
  'review/inbox':   () => import('./pages/LoopReview'),
  'review/projects':() => import('./pages/ProjectControl'),
  'review/map':     () => import('./pages/LoopOps'),
  ledger:           () => import('./pages/CostTracker'),
  sanctum:          () => import('./pages/ScryingSanctum'),
  learn:            () => import('./pages/LearningQuest'),
  capacity:         () => import('./pages/CapacityUsage'),
};

const Overview        = lazy(ROUTE_LOADERS['today/summary']);
const Sessions        = lazy(ROUTE_LOADERS['today/sessions']);
const AgentVisualizer = lazy(ROUTE_LOADERS['today/runs']);
const LoopReview      = lazy(ROUTE_LOADERS['review/inbox']);
const ProjectControl  = lazy(ROUTE_LOADERS['review/projects']);
const LoopOps         = lazy(ROUTE_LOADERS['review/map']);
const CostTracker     = lazy(ROUTE_LOADERS.ledger);
const ScryingSanctum  = lazy(ROUTE_LOADERS.sanctum);
const LearningQuest   = lazy(ROUTE_LOADERS.learn);
const CapacityUsage   = lazy(ROUTE_LOADERS.capacity);

// Locations that read their own data and ship their own instructional empty
// states, so the session-data splash must not cover them.
const SELF_LOADING = new Set([
  'review/inbox',
  'review/map',
  'review/projects',
  'learn',
  'capacity',
]);

function PageLoader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 320, color: 'var(--text-muted)', fontSize: 'var(--fs-body)',
    }}>
      Loading…
    </div>
  );
}

function withSuspense(node) {
  return <Suspense fallback={<PageLoader />}>{node}</Suspense>;
}

function NoDataScreen() {
  return (
    <EmptyState
      title="No sessions parsed yet"
      body="Meow Ops reads session files your AI coding tools already wrote to this machine. Run the parser once, then hit Sync in the sidebar."
      command="node sync/export-local.mjs"
    />
  );
}

export default function App() {
  const { route, navigate, setTab } = useRoute();
  const path = route.tab ? `${route.surface}/${route.tab}` : route.surface;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  const [dateRange, setDateRange] = useState(() => {
    try {
      const raw = localStorage.getItem('meow-ops-date-range');
      if (raw === '1h' || raw === '24h' || raw === 'all') return raw;
      const num = Number.parseInt(raw, 10);
      if (num === 7 || num === 30 || num === 90) return num;
    } catch { /* localStorage blocked */ }
    return 30;
  });
  useEffect(() => {
    try { localStorage.setItem('meow-ops-date-range', String(dateRange)); } catch { /* quota */ }
  }, [dateRange]);

  // Two session arrays:
  //   sessions    — date-filtered, used for display (table, charts, per-page views)
  //   allSessions — newest bounded compatibility preview with no date filter;
  //                 complete all-time metrics come from costSummary rollups
  const [sessions,    setSessions]    = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [dailyData,   setDailyData]   = useState([]);
  const [costSummary, setCostSummary] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [noData,      setNoData]      = useState(false);
  const [reloadKey,   setReloadKey]   = useState(0);

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

  const reloadData = useCallback(() => {
    invalidateRealSessions();
    setReloadKey((k) => k + 1);
  }, []);

  const sync = useSync(reloadData);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      const [sess, all, summary] = await Promise.all([
        fetchSessions(dateRange),
        fetchAllSessions(),
        fetchCostSummary(),
      ]);

      if (cancelled) return;

      const empty = await hasNoData();
      setNoData(empty && sess.length === 0);

      setSessions(sess);
      setAllSessions(all);
      if (summary) setCostSummary(summary);

      // cost-summary.daily_summary covers ALL sessions (no preview cap); fall
      // back to computing from the in-memory array only when it is missing.
      const raw = summary?.daily_summary?.length
        ? filterDailySummaryByRange(summary.daily_summary, dateRange)
        : await fetchDailyStats(dateRange, summary);

      setDailyData(fillMissingDays(raw, dateRange));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange, reloadKey]);

  // Start the active chunk while session data loads so one Loading… covers
  // both, instead of flashing a second loader.
  useEffect(() => { ROUTE_LOADERS[path]?.(); }, [path]);

  useEffect(() => {
    const id = setInterval(() => {
      invalidateRealSessions();
      setReloadKey((k) => k + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const openPalette  = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const goToSurface  = useCallback((surface) => navigate(surface), [navigate]);

  useShortcuts({ onOpenPalette: openPalette, onNavigate: goToSurface, paletteOpen });

  const modelData = costSummary?.byModel
    ? costSummary.byModel.map((row) => ({ model: row.key, sessions: row.sessions, tokens: row.tokens, cost: row.cost }))
    : getModelBreakdown(sessions);
  const stats = computeOverviewStats(sessions, dateRange);

  // Per-source rollup for the budget panel. Computed from ALL sessions so the
  // week/month figures do not move when the date filter changes.
  const sourceStats = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const blank = () => ({
      sessions: 0, cost: 0, tokens: 0,
      weekTokens: 0, monthTokens: 0, weekSessions: 0, monthSessions: 0,
    });
    const acc = { claude: blank(), codex: blank() };

    allSessions.forEach((s) => {
      const src = s.source || 'claude';
      if (!acc[src]) acc[src] = blank();
      const tok = s.total_tokens || 0;
      acc[src].sessions++;
      acc[src].cost   += s.estimated_cost_usd || 0;
      acc[src].tokens += tok;

      const d = new Date(s.started_at);
      if (d >= weekStart)  { acc[src].weekTokens  += tok; acc[src].weekSessions++;  }
      if (d >= monthStart) { acc[src].monthTokens += tok; acc[src].monthSessions++; }
    });
    for (const [src, complete] of Object.entries(costSummary?.bySourceAllTime || {})) {
      if (!acc[src]) acc[src] = blank();
      acc[src].sessions = complete.sessions || 0;
      acc[src].cost = complete.cost || 0;
      acc[src].tokens = complete.tokens || 0;
    }
    return acc;
  }, [allSessions, costSummary]);

  const chrome  = resolveChrome(route.surface, route.tab);
  const surface = surfaceById(route.surface);

  function renderLocation() {
    if (!SELF_LOADING.has(path) && noData) return <NoDataScreen />;

    switch (path) {
      case 'today/summary':
        return withSuspense(
          <Overview
            stats={stats}
            sessions={sessions}
            allSessions={allSessions}
            dailyData={dailyData}
            costSummary={costSummary}
            dateRange={dateRange}
            sourceStats={sourceStats}
            tokenBudget={tokenBudget}
            onBudgetChange={saveBudget}
            onNavigate={navigate}
          />,
        );
      case 'today/sessions':
        return withSuspense(<Sessions sessions={sessions} />);
      case 'today/runs':
        return withSuspense(<AgentVisualizer sessions={allSessions} />);
      case 'review/inbox':
        return withSuspense(<LoopReview />);
      case 'review/map':
        return withSuspense(<LoopOps />);
      case 'review/projects':
        return withSuspense(<ProjectControl />);
      case 'ledger':
        return withSuspense(
          <CostTracker
            dailyData={dailyData}
            modelData={modelData}
            stats={stats}
            costSummary={costSummary}
            allSessions={allSessions}
            dateRange={dateRange}
          />,
        );
      case 'sanctum':
        return withSuspense(<ScryingSanctum sessions={allSessions} onReload={reloadData} />);
      case 'learn':
        return withSuspense(<LearningQuest sessions={sessions} />);
      case 'capacity':
        return withSuspense(<CapacityUsage />);
      default:
        return <NoDataScreen />;
    }
  }

  const showLoader = loading && !SELF_LOADING.has(path);

  const header = (
    <>
      <PageHeader
        title={surface?.label ?? 'Meow Ops'}
        description={chrome.description}
        actions={(
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <FocusChip />
            {chrome.usesDateFilter ? <DateFilter value={dateRange} onChange={setDateRange} /> : null}
          </div>
        )}
      />
      {surface?.tabs && (
        <Tabs
          items={surface.tabs}
          value={route.tab ?? surface.tabs[0].id}
          onChange={setTab}
          ariaLabel={`${surface.label} views`}
        />
      )}
      {chrome.needsHelper && !sync.helperOnline && (
        <Notice command="node sync/local-api.mjs">
          This view reads from the local helper, which is not running. Start it in a terminal at the
          repo root and this page fills in.
        </Notice>
      )}
    </>
  );

  const body = (
    <ErrorBoundary key={path}>
      {showLoader ? <PageLoader /> : renderLocation()}
    </ErrorBoundary>
  );

  return (
    <PasswordGate>
      <div className="mo-shell">
        <Sidebar
          activeSurface={route.surface}
          onNavigate={goToSurface}
          onOpenPalette={openPalette}
          sync={sync}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <main className={chrome.fullBleed ? 'mo-main mo-main--bleed' : 'mo-main mo-main--standard'}>
          {chrome.fullBleed ? (
            <>
              <div className="mo-bleedhead">{header}</div>
              <div className="mo-bleedbody">{body}</div>
            </>
          ) : (
            <>
              {header}
              {body}
            </>
          )}
        </main>

        <CommandPalette
          open={paletteOpen}
          onClose={closePalette}
          onNavigate={navigate}
          onSync={() => { void sync.run(); }}
          onSetDateRange={setDateRange}
          onToggleTheme={toggleTheme}
          theme={theme}
        />
      </div>
    </PasswordGate>
  );
}
