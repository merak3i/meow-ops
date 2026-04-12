import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, List, FolderKanban, CalendarDays, Wrench, DollarSign,
  Cat, Timer, Activity, RefreshCw, Check, AlertCircle, BarChart3, GitBranch,
  Swords,
} from 'lucide-react';
import { triggerSync, getSyncStatus, invalidateRealSessions, IS_PROD } from '../lib/queries';

const NAV = [
  { id: 'overview',   label: 'Overview',        icon: LayoutDashboard },
  { id: 'sessions',   label: 'Sessions',        icon: List },
  { id: 'by-project', label: 'By Project',      icon: FolderKanban },
  { id: 'by-day',     label: 'By Day',          icon: CalendarDays },
  { id: 'by-action',  label: 'By Action',       icon: Wrench },
  { id: 'cost',       label: 'Cost Tracker',    icon: DollarSign },
  { id: 'analytics',  label: 'Analytics',       icon: BarChart3 },
  { id: 'agent-ops',  label: 'Agent Ops',       icon: GitBranch },
  { id: 'sanctum',    label: 'Scrying Sanctum', icon: Swords },
  { id: 'companion',  label: 'Companion',       icon: Cat },
  { id: 'live',       label: 'Live Sessions',   icon: Activity },
  { id: 'pomodoro',   label: 'Focus Timer',     icon: Timer },
];

function relativeTime(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

// ─── Sync/Refresh buttons ─────────────────────────────────────────────────────

function RefreshButton({ onReload }) {
  const [status, setStatus] = useState('idle');

  const handleRefresh = async () => {
    if (status === 'refreshing') return;
    setStatus('refreshing');
    try {
      invalidateRealSessions();
      await onReload?.();
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  const Icon = status === 'success' ? Check : status === 'error' ? AlertCircle : RefreshCw;
  const accent =
    status === 'success' ? 'var(--green)' :
    status === 'error' ? 'var(--red)' :
    status === 'refreshing' ? 'var(--accent)' : 'var(--text-secondary)';

  return (
    <div style={{ padding: '0 16px', marginBottom: 8 }}>
      <button
        onClick={handleRefresh}
        disabled={status === 'refreshing'}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8,
          background: 'var(--bg-page)', color: accent, cursor: status === 'refreshing' ? 'wait' : 'pointer',
          fontSize: 12, fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.3s var(--ease)',
        }}
        onMouseEnter={(e) => { if (status === 'idle') e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
        onMouseLeave={(e) => { if (status === 'idle') e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        <motion.span
          animate={status === 'refreshing' ? { rotate: 360 } : { rotate: 0 }}
          transition={status === 'refreshing' ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Icon size={14} />
        </motion.span>
        <span style={{ flex: 1 }}>
          {status === 'refreshing' ? 'Refreshing…' : status === 'success' ? 'Refreshed' : status === 'error' ? 'Failed' : 'Refresh data'}
        </span>
      </button>
    </div>
  );
}

function SyncButton({ onReload }) {
  const [status, setStatus] = useState('idle');
  const [lastSync, setLastSync] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let mounted = true;
    getSyncStatus().then((s) => { if (mounted && s.ok) setLastSync(s.mtime); });
    const tick = setInterval(() => setLastSync((v) => v), 30_000);
    return () => { mounted = false; clearInterval(tick); };
  }, []);

  const handleSync = async () => {
    if (status === 'syncing') return;
    setStatus('syncing');
    setErrorMsg(null);
    const result = await triggerSync();
    if (result.ok) {
      setStatus('success');
      setLastSync(result.mtime || Date.now());
      onReload?.();
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error');
      setErrorMsg(result.error || result.stderr || 'Sync failed');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const Icon = status === 'success' ? Check : status === 'error' ? AlertCircle : RefreshCw;
  const accent =
    status === 'success' ? 'var(--green)' :
    status === 'error' ? 'var(--red)' :
    status === 'syncing' ? 'var(--accent)' : 'var(--text-secondary)';

  return (
    <div style={{ padding: '0 16px', marginBottom: 8 }}>
      <button
        onClick={handleSync}
        disabled={status === 'syncing'}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8,
          background: 'var(--bg-page)', color: accent, cursor: status === 'syncing' ? 'wait' : 'pointer',
          fontSize: 12, fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.3s var(--ease)',
        }}
        onMouseEnter={(e) => { if (status === 'idle') e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
        onMouseLeave={(e) => { if (status === 'idle') e.currentTarget.style.borderColor = 'var(--border)'; }}
        title={errorMsg || `Last sync: ${relativeTime(lastSync)}`}
      >
        <motion.span
          animate={status === 'syncing' ? { rotate: 360 } : { rotate: 0 }}
          transition={status === 'syncing' ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Icon size={14} />
        </motion.span>
        <span style={{ flex: 1 }}>
          {status === 'syncing' ? 'Syncing…' : status === 'success' ? 'Synced' : status === 'error' ? 'Failed' : 'Sync sessions'}
        </span>
        {status === 'idle' && lastSync && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{relativeTime(lastSync)}</span>
        )}
      </button>
      <AnimatePresence>
        {status === 'error' && errorMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              marginTop: 6, padding: '6px 10px', fontSize: 10,
              color: 'var(--red)', background: 'var(--bg-page)',
              borderRadius: 6, border: '1px solid var(--border)',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}
          >
            {errorMsg.slice(0, 60)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── SOURCE USAGE panel ───────────────────────────────────────────────────────

function formatTokens(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function RateBar({ pct, color, label, sublabel }) {
  const remaining = 100 - pct;
  const barColor =
    pct > 85 ? '#ef4444' :
    pct > 60 ? '#f59e0b' :
    color;

  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: .5 }}>{label}</span>
        <span style={{ fontSize: 9, color: barColor, fontFamily: 'monospace' }}>
          {remaining}% left
        </span>
      </div>
      <div style={{
        height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, ${barColor}aa, ${barColor})`,
          borderRadius: 3,
          transition: 'width .6s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
      {sublabel && (
        <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2, opacity: .7 }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

function SourceUsagePanel({ allSessions, rateLimits }) {
  const [expanded, setExpanded] = useState(false);

  // Compute local session stats per source (last 7 days)
  const stats = (() => {
    const now  = Date.now();
    const week = now - 7 * 24 * 60 * 60 * 1000;
    const weekSessions = (allSessions ?? []).filter(
      (s) => new Date(s.started_at).getTime() >= week
    );
    const bySource = (src) => weekSessions.filter((s) => s.source === src);
    const sum = (arr, key) => arr.reduce((t, s) => t + (s[key] ?? 0), 0);

    const claudeSess = bySource('claude');
    const codexSess  = bySource('codex');
    const allSess    = (allSessions ?? []);

    return {
      claude: {
        weekSessions: claudeSess.length,
        weekTokens:   sum(claudeSess, 'total_tokens'),
        weekCost:     sum(claudeSess, 'estimated_cost_usd'),
        totalSessions: allSess.filter((s) => s.source === 'claude').length,
        totalCost:    sum(allSess.filter((s) => s.source === 'claude'), 'estimated_cost_usd'),
      },
      codex: {
        weekSessions: codexSess.length,
        weekCost:     sum(codexSess, 'estimated_cost_usd'),
        totalSessions: allSess.filter((s) => s.source === 'codex').length,
        totalCost:    sum(allSess.filter((s) => s.source === 'codex'), 'estimated_cost_usd'),
      },
    };
  })();

  const rl = rateLimits?.claude;

  return (
    <div style={{
      margin: '0 12px 10px',
      background: 'var(--bg-page)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '8px 12px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase' }}>
          Source Usage
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>

              {/* ── Claude ── */}
              <div style={{ paddingTop: 10 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Claude</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    ${stats.claude.totalCost.toFixed(2)}
                  </span>
                </div>

                {/* Rate limit bars from claude.ai/settings/usage */}
                {rl ? (
                  <div style={{ marginBottom: 4 }}>
                    <RateBar
                      pct={rl.session?.used_pct ?? 0}
                      color="var(--accent)"
                      label={`Session${rl.session?.resets_in_label ? ` · resets in ${rl.session.resets_in_label}` : ''}`}
                      sublabel={null}
                    />
                    <RateBar
                      pct={rl.weekly?.all_models_used_pct ?? 0}
                      color="var(--accent)"
                      label={`Weekly (all)${rl.weekly?.resets_label ? ` · resets ${rl.weekly.resets_label}` : ''}`}
                      sublabel={null}
                    />
                    <RateBar
                      pct={rl.weekly?.sonnet_only_used_pct ?? 0}
                      color="var(--cyan)"
                      label="Weekly (Sonnet)"
                      sublabel={null}
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Rate limits: run{' '}
                    <code style={{ fontSize: 8.5, color: 'var(--accent)' }}>sync/fetch-claude-limits.mjs</code>
                  </div>
                )}

                {/* Local session stats */}
                <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  <div>{stats.claude.weekSessions} sessions this week</div>
                  <div>{formatTokens(stats.claude.weekTokens)} tokens this week</div>
                  <div>{stats.claude.totalSessions} sessions total</div>
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />

              {/* ── Codex / OpenAI ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Codex</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    ${stats.codex.totalCost.toFixed(2)}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  <div>{stats.codex.weekSessions} sessions this week</div>
                  <div>{stats.codex.totalSessions} sessions total</div>
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />

              {/* ── ChatGPT ── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--border)', border: '1px solid var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>ChatGPT</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>—</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', opacity: .65 }}>
                  Not connected. Tracking via local sessions coming soon.
                </div>
              </div>

              {/* Refresh hint */}
              <div style={{ marginTop: 10, fontSize: 8.5, color: 'var(--text-muted)', opacity: .55, lineHeight: 1.5 }}>
                Rate limits pulled from{' '}
                <span style={{ color: 'var(--accent)' }}>claude.ai/settings/usage</span>
                {rateLimits?._updated && (
                  <> · {new Date(rateLimits._updated).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

export default function Sidebar({ activePage, onNavigate, onReload, allSessions, rateLimits }) {
  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        height: '100vh',
        position: 'fixed',
        top: 0, left: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
        zIndex: 50,
        overflowY: 'auto',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '0 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src="/meow-logo-dark.png" alt="Meow Operations" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <span style={{ fontSize: 15, fontWeight: 300, color: 'var(--text-primary)' }}>Meow Operations</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = activePage === id;
          const isSanctum = id === 'sanctum';
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 20px',
                border: 'none',
                background: active
                  ? isSanctum ? 'rgba(200,168,85,.1)' : 'var(--bg-hover)'
                  : 'transparent',
                color: active
                  ? isSanctum ? '#c8a855' : 'var(--text-primary)'
                  : isSanctum ? '#c8a85588' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                letterSpacing: 'inherit',
                textAlign: 'left',
                borderLeft: active
                  ? isSanctum ? '2px solid #c8a855' : '2px solid var(--accent)'
                  : '2px solid transparent',
                transition: 'all 0.3s var(--ease)',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={16} />
              {label}
              {isSanctum && (
                <span style={{
                  marginLeft: 'auto', fontSize: 7.5,
                  color: '#c8a85599', letterSpacing: 1, textTransform: 'uppercase',
                  border: '1px solid #c8a85533', borderRadius: 2,
                  padding: '1px 5px',
                }}>
                  MMORPG
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* SOURCE USAGE */}
      <div style={{ flexShrink: 0 }}>
        <SourceUsagePanel allSessions={allSessions} rateLimits={rateLimits} />
      </div>

      {/* Sync/Refresh */}
      <div style={{ flexShrink: 0 }}>
        {IS_PROD ? <RefreshButton onReload={onReload} /> : <SyncButton onReload={onReload} />}
      </div>

      {/* Footer */}
      <div style={{ padding: '0 20px', color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
        <span style={{ opacity: .5 }}>powered by</span>{' '}
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Meow Creative Haus</span>
      </div>
    </aside>
  );
}
