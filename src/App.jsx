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
  computeOverviewStats,
  computeSpendBreakdown,
  getProjectBreakdown,
  getToolBreakdownFromSessions,
  getModelBreakdown,
} from './lib/queries';

export default function App() {
  const [page, setPage] = useState('overview');
  const [dateRange, setDateRange] = useState(30);
  const [sessions, setSessions] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [dailyData, setDailyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Filtered sessions for the selected date range (used by most pages).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [sess, daily] = await Promise.all([
        fetchSessions(dateRange),
        fetchDailyStats(dateRange),
      ]);
      if (cancelled) return;
      setSessions(sess);
      setDailyData(daily);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange, reloadKey]);

  // All-time sessions — needed for accurate weekly/monthly spend breakdown
  // regardless of which date-range filter the user has selected.
  // loadRealSessions() caches in memory so this is free after the first load.
  useEffect(() => {
    let cancelled = false;
    fetchSessions('all').then((sess) => {
      if (!cancelled) setAllSessions(sess);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reloadData = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const stats = computeOverviewStats(sessions, dateRange);
  const spendData = computeSpendBreakdown(allSessions);
  const projectData = getProjectBreakdown(sessions);
  const toolData = getToolBreakdownFromSessions(sessions);
  const modelData = getModelBreakdown(sessions);

  const renderPage = () => {
    switch (page) {
      case 'overview':
        return <Overview stats={stats} sessions={sessions} allSessions={allSessions} dailyData={dailyData} toolData={toolData} spendData={spendData} dateRange={dateRange} />;
      case 'sessions':
        return <Sessions sessions={sessions} />;
      case 'by-project':
        return <ByProject projectData={projectData} />;
      case 'by-day':
        return <ByDay dailyData={dailyData} />;
      case 'by-action':
        return <ByAction toolData={toolData} />;
      case 'cost':
        return <CostTracker dailyData={dailyData} modelData={modelData} stats={stats} />;
      case 'companion':
        return <CompanionView sessions={sessions} />;
      case 'live':
        return <LiveSessions sessions={sessions} />;
      case 'pomodoro':
        return <Pomodoro />;
      default:
        return <Overview stats={stats} sessions={sessions} allSessions={allSessions} dailyData={dailyData} toolData={toolData} spendData={spendData} />;
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
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 24,
          }}>
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
