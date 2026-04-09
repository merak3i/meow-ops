import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import DateFilter from './components/DateFilter';
import Overview from './pages/Overview';
import Sessions from './pages/Sessions';
import ByProject from './pages/ByProject';
import ByDay from './pages/ByDay';
import ByAction from './pages/ByAction';
import CostTracker from './pages/CostTracker';
import CompanionView from './companion/CompanionView';
import Pomodoro from './pages/Pomodoro';
import LiveSessions from './pages/LiveSessions';
import {
  fetchSessions,
  fetchDailyStats,
  fetchCostSummary,
  computeOverviewStats,
  getProjectBreakdown,
  getToolBreakdownFromSessions,
  getModelBreakdown,
  invalidateRealSessions,
} from './lib/queries';

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export default function App() {
  const [page, setPage] = useState('overview');
  const [dateRange, setDateRange] = useState(30);
  const [sessions, setSessions] = useState([]);
  const [dailyData, setDailyData] = useState([]);
  const [costSummary, setCostSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Main data load — filtered sessions + daily stats + cost summary
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [sess, daily, summary] = await Promise.all([
        fetchSessions(dateRange),
        fetchDailyStats(dateRange),
        fetchCostSummary(),
      ]);
      if (cancelled) return;
      setSessions(sess);
      setDailyData(daily);
      if (summary) setCostSummary(summary);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange, reloadKey]);

  // Auto-refresh every 5 minutes — invalidates the in-memory session cache
  // so the next tick re-fetches sessions.json + cost-summary.json from disk.
  useEffect(() => {
    const id = setInterval(() => {
      invalidateRealSessions();
      setReloadKey((k) => k + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const reloadData = useCallback(() => {
    invalidateRealSessions();
    setReloadKey((k) => k + 1);
  }, []);

  const stats       = computeOverviewStats(sessions, dateRange);
  const projectData = getProjectBreakdown(sessions);
  const toolData    = getToolBreakdownFromSessions(sessions);
  const modelData   = getModelBreakdown(sessions);

  const renderPage = () => {
    switch (page) {
      case 'overview':
        return <Overview stats={stats} sessions={sessions} dailyData={dailyData} toolData={toolData} costSummary={costSummary} dateRange={dateRange} />;
      case 'sessions':
        return <Sessions sessions={sessions} />;
      case 'by-project':
        return <ByProject projectData={projectData} />;
      case 'by-day':
        return <ByDay dailyData={dailyData} />;
      case 'by-action':
        return <ByAction toolData={toolData} />;
      case 'cost':
        return <CostTracker dailyData={dailyData} modelData={modelData} stats={stats} costSummary={costSummary} />;
      case 'companion':
        return <CompanionView sessions={sessions} />;
      case 'live':
        return <LiveSessions sessions={sessions} />;
      case 'pomodoro':
        return <Pomodoro />;
      default:
        return <Overview stats={stats} sessions={sessions} dailyData={dailyData} toolData={toolData} costSummary={costSummary} />;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar activePage={page} onNavigate={setPage} onReload={reloadData} />

      <main style={{
        marginLeft: 'var(--sidebar-w)',
        flex: 1,
        padding: 32,
        maxWidth: 1280,
      }}>
        {page !== 'pomodoro' && page !== 'companion' && page !== 'live' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
            <DateFilter value={dateRange} onChange={setDateRange} />
          </div>
        )}

        {loading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 400,
            color: 'var(--text-muted)',
            fontSize: 14,
          }}>
            Loading...
          </div>
        ) : (
          renderPage()
        )}
      </main>
    </div>
  );
}
