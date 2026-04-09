import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, List, FolderKanban, CalendarDays, Wrench, DollarSign,
  Cat, Timer, Activity, RefreshCw, Check, AlertCircle, BarChart3, Sparkles,
} from 'lucide-react';
import { triggerSync, getSyncStatus, invalidateRealSessions, IS_PROD } from '../lib/queries';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: List },
  { id: 'by-project', label: 'By Project', icon: FolderKanban },
  { id: 'by-day', label: 'By Day', icon: CalendarDays },
  { id: 'by-action', label: 'By Action', icon: Wrench },
  { id: 'cost', label: 'Cost Tracker', icon: DollarSign },
  { id: 'analytics',    label: 'Analytics',     icon: BarChart3 },
  { id: 'companion',    label: 'Companion',     icon: Cat },
  { id: 'companion-v2', label: 'Companion V2',  icon: Sparkles },
  { id: 'live',         label: 'Live Sessions', icon: Activity },
  { id: 'pomodoro',     label: 'Focus Timer',   icon: Timer },
];

function relativeTime(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function RefreshButton({ onReload }) {
  const [status, setStatus] = useState('idle'); // idle | refreshing | success | error

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
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-page)',
          color: accent,
          cursor: status === 'refreshing' ? 'wait' : 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'all 0.3s var(--ease)',
        }}
        onMouseEnter={(e) => { if (status === 'idle') e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
        onMouseLeave={(e) => { if (status === 'idle') e.currentTarget.style.borderColor = 'var(--border)'; }}
        title="Re-fetch the latest sessions from storage"
      >
        <motion.span
          animate={status === 'refreshing' ? { rotate: 360 } : { rotate: 0 }}
          transition={status === 'refreshing' ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Icon size={14} />
        </motion.span>
        <span style={{ flex: 1 }}>
          {status === 'refreshing' ? 'Refreshing…' :
           status === 'success' ? 'Refreshed' :
           status === 'error' ? 'Failed' :
           'Refresh data'}
        </span>
      </button>
    </div>
  );
}

function SyncButton({ onReload }) {
  const [status, setStatus] = useState('idle'); // idle | syncing | success | error
  const [lastSync, setLastSync] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let mounted = true;
    getSyncStatus().then((s) => {
      if (mounted && s.ok) setLastSync(s.mtime);
    });
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
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-page)',
          color: accent,
          cursor: status === 'syncing' ? 'wait' : 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'all 0.3s var(--ease)',
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
          {status === 'syncing' ? 'Syncing…' :
           status === 'success' ? 'Synced' :
           status === 'error' ? 'Failed' :
           'Sync sessions'}
        </span>
        {status === 'idle' && lastSync && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {relativeTime(lastSync)}
          </span>
        )}
      </button>
      <AnimatePresence>
        {status === 'error' && errorMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              marginTop: 6,
              padding: '6px 10px',
              fontSize: 10,
              color: 'var(--red)',
              background: 'var(--bg-page)',
              borderRadius: 6,
              border: '1px solid var(--border)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {errorMsg.slice(0, 60)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Sidebar({ activePage, onNavigate, onReload }) {
  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
        zIndex: 50,
      }}
    >
      <div style={{ padding: '0 20px', marginBottom: 32, display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/meow-logo-dark.png" alt="Meow Operations" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <span style={{ fontSize: 15, fontWeight: 300, color: 'var(--text-primary)' }}>Meow Operations</span>
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = activePage === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 20px',
                border: 'none',
                background: active ? 'var(--bg-hover)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                letterSpacing: 'inherit',
                textAlign: 'left',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.3s var(--ease)',
              }}
              onMouseEnter={(e) => { if (!active) e.target.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { if (!active) e.target.style.background = 'transparent'; }}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </nav>

      {IS_PROD ? <RefreshButton onReload={onReload} /> : <SyncButton onReload={onReload} />}

      <div style={{ padding: '0 20px', color: 'var(--text-muted)', fontSize: 11 }}>
        Meow Creative Haus
      </div>
    </aside>
  );
}
