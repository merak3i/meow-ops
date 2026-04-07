import { Activity, Zap, DollarSign, FolderKanban } from 'lucide-react';
import StatCard from '../components/StatCard';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import { formatTokens, formatCost } from '../lib/format';

function periodLabel(dateRange) {
  if (dateRange === 'all') return 'All time';
  if (dateRange === 7)  return '7 days';
  if (dateRange === 30) return '30 days';
  if (dateRange === 90) return '90 days';
  return `${dateRange} days`;
}

export default function Overview({ stats, dailyData, toolData, dateRange = 30 }) {
  const label = periodLabel(dateRange);

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>Overview</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard
          label={`Sessions — ${label}`}
          value={stats.periodSessions}
          sub={`${stats.sessionsToday} today`}
          icon={Activity}
          color="var(--accent)"
        />
        <StatCard
          label={`Tokens — ${label}`}
          value={formatTokens(stats.periodTokens)}
          sub={`${formatTokens(stats.tokensToday)} today`}
          icon={Zap}
          color="var(--cyan)"
        />
        <StatCard
          label={`Cost — ${label}`}
          value={formatCost(stats.periodCost)}
          sub={`${formatCost(stats.costToday)} today`}
          icon={DollarSign}
          color="var(--green)"
        />
        <StatCard
          label={`Projects — ${label}`}
          value={stats.periodProjects}
          sub={`${stats.projectsToday} active today · ${stats.healthRatio}% healthy`}
          icon={FolderKanban}
          color="var(--amber)"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <DailyChart data={dailyData} title="Token Usage (last period)" />
        <ToolBreakdown data={toolData} title="Tool Distribution" />
      </div>
    </div>
  );
}
