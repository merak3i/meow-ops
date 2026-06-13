import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Gauge,
  GitBranch,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { fetchCapacityUsageData, fetchCapacityUsageStatus, postCapacityUsageSync } from './capacity-usage/api';

const CATEGORY_ORDER = ['All', 'AI', 'Infra', 'Data', 'Ops', 'Design', 'Other'];
const STATUS_COPY = {
  healthy: { label: 'Healthy', color: 'var(--green)' },
  watch: { label: 'Watch', color: 'var(--amber)' },
  over: { label: 'Over', color: 'var(--red)' },
  running: { label: 'Running', color: 'var(--cyan)' },
  unknown: { label: 'Unknown', color: 'var(--text-muted)' },
};

const cardStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
};

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(Number(value) || 0);
}

function number(value, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return 'not set';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
  });
}

function relativeFromMs(ms) {
  if (!ms) return 'not synced';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusMeta(status) {
  return STATUS_COPY[status] ?? STATUS_COPY.unknown;
}

function StatusChip({ status }) {
  const meta = statusMeta(status);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      color: meta.color,
      border: `1px solid ${meta.color}`,
      borderRadius: 999,
      padding: '3px 8px',
      fontSize: 10,
      lineHeight: 1,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      whiteSpace: 'nowrap',
    }}>
      {status === 'healthy' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {meta.label}
    </span>
  );
}

function MiniStat({ label, value, sub, icon: Icon, color = 'var(--accent)' }) {
  return (
    <div className="card" style={{ padding: 16, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {label}
        </span>
        {createElement(Icon, { size: 16, style: { color } })}
      </div>
      <div style={{ fontSize: 28, lineHeight: 1.1, color, fontWeight: 400 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, color }) {
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{
      height: 7,
      borderRadius: 999,
      overflow: 'hidden',
      background: 'var(--bg-page)',
      border: '1px solid var(--border)',
    }}>
      <div style={{ width: `${width}%`, height: '100%', background: color }} />
    </div>
  );
}

function SourceBadge({ source }) {
  const safeSource = source === 'demo' ? 'demo data' : source || 'local data';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      color: source === 'demo' ? 'var(--amber)' : 'var(--green)',
      border: `1px solid ${source === 'demo' ? 'var(--amber)' : 'var(--green)'}`,
      borderRadius: 999,
      padding: '4px 10px',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    }}>
      <ShieldCheck size={12} />
      {safeSource}
    </span>
  );
}

function RepoRow({ repo }) {
  const meta = statusMeta(repo.health);
  const workflows = repo.workflows?.slice(0, 3) ?? [];
  return (
    <div style={{
      padding: '14px 0',
      borderTop: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
      gap: 16,
      alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <GitBranch size={14} style={{ color: meta.color, flexShrink: 0 }} />
          <span style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {repo.repo}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {repo.visibility}
          </span>
          {workflows.map((workflow) => (
            <span key={`${repo.repo}-${workflow.name}`} style={{
              fontSize: 10,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '2px 7px',
            }}>
              {workflow.name}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {number(repo.estimatedMinutes, 1)} min wall-clock
          </span>
          <span style={{ fontSize: 11, color: meta.color }}>{repo.failed} failed</span>
        </div>
        <ProgressBar
          pct={repo.runs ? ((repo.successful || 0) / repo.runs) * 100 : 0}
          color={meta.color}
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 7, fontSize: 11, color: 'var(--text-muted)' }}>
          <span>{repo.runs} runs</span>
          <span>{number(repo.cacheGb, 1)} GB cache</span>
          <span>{repo.artifactCount} artifacts</span>
        </div>
      </div>
      <StatusChip status={repo.health} />
    </div>
  );
}

function GitHubActionsPanel({ githubActions }) {
  const totals = githubActions?.totals ?? {};
  const limit = githubActions?.limits?.minutesIncluded;
  const pct = limit ? (totals.estimatedMinutes / limit) * 100 : 0;
  const status = totals.failed > 0 ? 'watch' : 'healthy';
  const meta = statusMeta(status);

  return (
    <section style={{ ...cardStyle, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>GitHub Actions</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {githubActions?.period?.label ?? 'last 30 days'} across {totals.repos ?? 0} repos
          </p>
        </div>
        <StatusChip status={status} />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 10,
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
            Runs
          </div>
          <div style={{ fontSize: 22, color: 'var(--text-primary)' }}>{number(totals.runs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
            Minutes
          </div>
          <div style={{ fontSize: 22, color: meta.color }}>{number(totals.estimatedMinutes, 1)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
            Cache
          </div>
          <div style={{ fontSize: 22, color: 'var(--cyan)' }}>{number(totals.cacheGb, 1)} GB</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
            Artifacts
          </div>
          <div style={{ fontSize: 22, color: 'var(--purple)' }}>{number(totals.artifactGb, 1)} GB</div>
        </div>
      </div>

      {limit ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>included minutes</span>
            <span style={{ fontSize: 11, color: meta.color }}>{number(pct, 0)}%</span>
          </div>
          <ProgressBar pct={pct} color={meta.color} />
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          Billing quota not configured. Showing workflow wall-clock minutes.
        </div>
      )}

      {(githubActions?.repos ?? []).map((repo) => <RepoRow key={repo.repo} repo={repo} />)}
    </section>
  );
}

function ServiceRow({ service }) {
  const meta = statusMeta(service.status);
  return (
    <div style={{
      padding: '13px 0',
      borderTop: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
      gap: 14,
      alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {service.name}
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
          {service.vendor} / {service.plan}
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{service.usageLabel}</span>
          <span style={{ fontSize: 11, color: meta.color }}>{number(service.usagePct)}%</span>
        </div>
        <ProgressBar pct={service.usagePct} color={meta.color} />
        <div style={{ marginTop: 7, fontSize: 11, color: 'var(--text-muted)' }}>
          {number(service.usageValue, 1)} / {number(service.limitValue, 1)} {service.limitLabel}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>
        {money(service.monthlyCostUsd)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 }}>
        <StatusChip status={service.status} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dateLabel(service.renewalDate)}</span>
      </div>
    </div>
  );
}

function SaaSPanel({ services }) {
  const [category, setCategory] = useState('All');
  const categories = useMemo(() => {
    const present = new Set(services.map((service) => service.category || 'Other'));
    return CATEGORY_ORDER.filter((item) => item === 'All' || present.has(item));
  }, [services]);
  const filtered = category === 'All'
    ? services
    : services.filter((service) => service.category === category);

  return (
    <section style={{ ...cardStyle, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>SaaS Stack</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            daily software, build systems, infrastructure, and ops subscriptions
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: category === item ? 'var(--accent)' : 'transparent',
                color: category === item ? '#000' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 11,
                padding: '5px 9px',
                fontFamily: 'inherit',
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        filtered.map((service) => <ServiceRow key={service.id} service={service} />)
      ) : (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, color: 'var(--text-muted)', fontSize: 12 }}>
          No services in this category.
        </div>
      )}
    </section>
  );
}

function WiringPanel({ patherle, notVerified }) {
  const sources = patherle?.sources ?? [];
  return (
    <section style={{ ...cardStyle, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Database size={16} style={{ color: 'var(--cyan)' }} />
        <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>SuperAdmin Wiring</h3>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12,
        marginBottom: 18,
      }}>
        {sources.map((source) => (
          <div key={source.name} style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 13,
            background: 'var(--bg-page)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{source.name}</span>
              <span style={{ fontSize: 10, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {source.status}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {source.surface}
              <br />
              {source.privacy}
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Not verified
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(notVerified ?? []).map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <AlertTriangle size={13} style={{ color: 'var(--amber)', marginTop: 2, flexShrink: 0 }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EmptyPanel({ error }) {
  return (
    <section style={{ ...cardStyle, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />
        <h3 style={{ fontSize: 15, margin: 0 }}>Usage data unavailable</h3>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.65, margin: 0 }}>
        {error || 'No local or demo usage data loaded.'}
      </p>
    </section>
  );
}

export default function CapacityUsage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usage, freshStatus] = await Promise.all([
        fetchCapacityUsageData(),
        fetchCapacityUsageStatus(),
      ]);
      setData(usage);
      setStatus(freshStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    const result = await postCapacityUsageSync();
    await load();
    if (!result.ok) setError(result.stderr || result.error || 'sync failed');
    setSyncing(false);
  }

  const totals = data?.saas?.totals ?? {};
  const githubTotals = data?.githubActions?.totals ?? {};
  const services = data?.saas?.services ?? [];
  const generated = data?.meta?.generatedAt ? new Date(data.meta.generatedAt).getTime() : null;
  const source = data?.meta?.source ?? 'unknown';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Gauge size={22} style={{ color: 'var(--accent)' }} />
            <h2 style={{ fontSize: 22, margin: 0 }}>Capacity & Usage</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <SourceBadge source={source} />
            <span>generated {relativeFromMs(generated)}</span>
            <span>local file {relativeFromMs(status?.mtime)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          title="Refresh local usage snapshot"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: syncing ? 'var(--bg-hover)' : 'var(--bg-card)',
            color: syncing ? 'var(--accent)' : 'var(--text-secondary)',
            cursor: syncing ? 'wait' : 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            padding: '8px 12px',
          }}
        >
          <RefreshCw size={14} className={syncing ? 'loop-spin' : undefined} />
          {syncing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 14,
      }}>
        <MiniStat
          label="Monthly Run Rate"
          value={money(totals.monthlyUsd)}
          sub={`${totals.services ?? 0} services tracked`}
          icon={CircleDollarSign}
          color="var(--green)"
        />
        <MiniStat
          label="Watch List"
          value={number((totals.watch ?? 0) + (totals.over ?? 0))}
          sub={`${totals.over ?? 0} over capacity`}
          icon={AlertTriangle}
          color={(totals.over ?? 0) > 0 ? 'var(--red)' : 'var(--amber)'}
        />
        <MiniStat
          label="Actions Runs"
          value={number(githubTotals.runs)}
          sub={`${number(githubTotals.estimatedMinutes, 1)} min wall-clock`}
          icon={Activity}
          color="var(--accent)"
        />
        <MiniStat
          label="Actions Storage"
          value={`${number((githubTotals.cacheGb ?? 0) + (githubTotals.artifactGb ?? 0), 1)} GB`}
          sub={`${githubTotals.artifactCount ?? 0} artifacts`}
          icon={HardDrive}
          color="var(--cyan)"
        />
        <MiniStat
          label="Renewals"
          value={number(totals.renewal30d)}
          sub="next 30 days"
          icon={CalendarClock}
          color="var(--purple)"
        />
        <MiniStat
          label="Sources"
          value={number(data?.patherle?.sources?.length ?? 0)}
          sub="wired surfaces"
          icon={Boxes}
          color="var(--amber)"
        />
      </div>

      {loading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>Loading usage surfaces...</div>
      )}

      {!loading && !data && <EmptyPanel error={error} />}

      {!loading && data && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
            gap: 20,
            alignItems: 'start',
          }}>
            <GitHubActionsPanel githubActions={data.githubActions} />
            <WiringPanel patherle={data.patherle} notVerified={data.meta?.notVerified} />
          </div>

          <SaaSPanel services={services} />

          {error && (
            <div style={{
              color: 'var(--amber)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.55,
              background: 'var(--bg-card)',
            }}>
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
