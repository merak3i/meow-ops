import { Activity, Zap, DollarSign, FolderKanban } from 'lucide-react';
import StatCard from '../components/StatCard';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import { formatTokens, formatCost } from '../lib/format';

export default function Overview({ stats, dailyData, toolData }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>Overview</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Sessions Today" value={stats.sessionsToday} sub={`${stats.totalSessions} total`} icon={Activity} color="var(--accent)" />
        <StatCard label="Tokens Today" value={formatTokens(stats.tokensToday)} sub={`${formatTokens(stats.totalTokens)} total`} icon={Zap} color="var(--cyan)" />
        <StatCard label="Cost Today" value={formatCost(stats.costToday)} sub={`${formatCost(stats.totalCost)} total`} icon={DollarSign} color="var(--green)" />
        <StatCard label="Active Projects" value={stats.projectsToday} sub={`${stats.totalProjects} total · ${stats.healthRatio}% healthy`} icon={FolderKanban} color="var(--amber)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <DailyChart data={dailyData} title="Token Usage (last period)" />
        <ToolBreakdown data={toolData} title="Tool Distribution" />
      </div>
    </div>
  );
}
