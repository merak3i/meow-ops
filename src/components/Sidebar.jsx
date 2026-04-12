import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, List, FolderKanban, CalendarDays, Wrench, DollarSign,
  Cat, Timer, RefreshCw, Check, AlertCircle, BarChart3, GitBranch, Swords,
} from 'lucide-react';
import { formatCost, formatTokens } from '../lib/format';
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

// ── Token formatting helpers ──────────────────────────────────────────────────
function fmtTok(n) {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function parseTok(str) {
  const s = str.trim().toUpperCase();
  if (s.endsWith('B')) return parseFloat(s) * 1e9;
  if (s.endsWith('M')) return parseFloat(s) * 1e6;
  if (s.endsWith('K')) return parseFloat(s) * 1e3;
  return parseFloat(s) || 0;
}

// ── Token quota mini-row ──────────────────────────────────────────────────────
function QuotaRow({ label, used, budget, color, srcKey, period, onSetBudget }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');

  function commit() {
    const v = parseTok(draft);
    if (v > 0) onSetBudget(srcKey, period, v);
    setEditing(false);
  }

  const hasBudget = budget > 0;
  const pct       = hasBudget ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const remaining = hasBudget ? budget - used : 0;
  const isOver    = hasBudget && used > budget;

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        {editing ? (
          <div style={{ display: 'flex', gap: 3 }}>
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
              placeholder="e.g. 10B"
              style={{
                width: 56, fontSize: 9, background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 3, color: 'var(--text-primary)', padding: '1px 4px', outline: 'none',
              }}
            />
            <button onClick={commit} style={{ fontSize: 9, background: 'none', border: 'none',
              color: 'var(--green)', cursor: 'pointer', padding: 0 }}>✓</button>
            <button onClick={() => setEditing(false)} style={{ fontSize: 9, background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => { setDraft(hasBudget ? fmtTok(budget) : ''); setEditing(true); }}
            style={{ fontSize: 9, background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
              textDecoration: 'underline dotted', }}
          >
            {hasBudget ? `limit: ${fmtTok(budget)}` : 'set limit'}
          </button>
        )}
      </div>

      {hasBudget ? (
        <>
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 2 }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: isOver ? 'var(--red, #ff4a4a)' : color,
              borderRadius: 2, transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
            <span style={{ color: 'var(--text-muted)' }}>{fmtTok(used)} used</span>
            <span style={{ color: isOver ? 'var(--red, #ff4a4a)' : 'var(--green)' }}>
              {isOver ? `${fmtTok(used - budget)} over` : `${fmtTok(remaining)} left`}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {fmtTok(used)} used this {label.toLowerCase().replace(' tokens', '')}
        </div>
      )}
    </div>
  );
}

// ── Source usage mini-panel ───────────────────────────────────────────────────
function SourceUsagePanel({ sourceStats, tokenBudget, onBudgetChange }) {
  if (!sourceStats) return null;
  const { claude, codex } = sourceStats;
  const totalSess = claude.sessions + codex.sessions;
  if (totalSess === 0) return null;

  function handleSetBudget(src, period, value) {
    const next = {
      ...tokenBudget,
      [src]: { ...tokenBudget[src], [period]: value },
    };
    onBudgetChange(next);
  }

  const rows = [
    { src: 'claude', label: '◆ Claude', color: 'var(--accent)', ...claude },
    { src: 'codex',  label: '⬡ Codex',  color: 'oklch(0.65 0.18 260)', ...codex },
  ];

  return (
    <div style={{
      margin: '0 16px 12px',
      padding: '10px 12px',
      background: 'var(--bg-page)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em',
        textTransform: 'uppercase', marginBottom: 8 }}>
        Source Usage
      </div>
      {rows.map(({ src, label, color, sessions, cost, weekTokens, monthTokens }) => {
        if (sessions === 0) return null;
        const pct = totalSess > 0 ? Math.round((sessions / totalSess) * 100) : 0;
        const budget = tokenBudget?.[src] || { week: 0, month: 0 };
        return (
          <div key={src} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 3 }}>
              <span style={{ fontSize: 11, color, fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pct}%</span>
            </div>
            {/* Session share bar */}
            <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 3 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color,
                borderRadius: 2, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9,
              color: 'var(--text-muted)', marginBottom: 6 }}>
              <span>{sessions.toLocaleString()} sessions</span>
              <span style={{ color: 'var(--green)' }}>{formatCost(cost)}</span>
            </div>
            {/* Token quota rows */}
            <QuotaRow
              label="Week tokens" used={weekTokens} budget={budget.week}
              color={color} srcKey={src} period="week" onSetBudget={handleSetBudget}
            />
            <QuotaRow
              label="Month tokens" used={monthTokens} budget={budget.month}
              color={color} srcKey={src} period="month" onSetBudget={handleSetBudget}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function Sidebar({ activePage, onNavigate, onReload, sourceStats, tokenBudget, onBudgetChange }) {
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

      <SourceUsagePanel sourceStats={sourceStats} tokenBudget={tokenBudget} onBudgetChange={onBudgetChange} />
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
