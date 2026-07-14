import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Check, AlertCircle, Sun, Moon,
} from 'lucide-react';
import { triggerSync, getSyncStatus, invalidateRealSessions, IS_PROD } from '../lib/queries';
import { Eyebrow } from './ui/Eyebrow';
import { NAV_SECTIONS } from './nav-config';
import SyncActivityDrawer from './SyncActivityDrawer';

function relativeTime(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

// ─── Sync button ─────────────────────────────────────────────────────────────

function SyncButton({ onReload }) {
  const [sync, setSync] = useState(null);
  const [mode, setMode] = useState(IS_PROD ? 'refresh' : 'sync');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [, setTicker] = useState(0);

  const refreshStatus = useCallback(async () => {
    const next = await getSyncStatus();
    setSync(next);
    if (next.mode === 'local-sync' || next.mode === 'dev-sync') setMode('sync');
    else setMode('refresh');
    return next;
  }, []);

  useEffect(() => {
    let mounted = true;
    getSyncStatus().then((next) => {
      if (!mounted) return;
      setSync(next);
      if (next.mode === 'local-sync' || next.mode === 'dev-sync') setMode('sync');
      else setMode('refresh');
    });
    const tick = setInterval(() => setTicker((n) => n + 1), 30_000);
    return () => { mounted = false; clearInterval(tick); };
  }, [refreshStatus]);

  useEffect(() => {
    if (sync?.state !== 'running') return undefined;
    const poll = setInterval(async () => {
      const next = await refreshStatus();
      if (next.state !== 'running' && next.ok) {
        invalidateRealSessions();
        await onReload?.();
      }
    }, 1200);
    return () => clearInterval(poll);
  }, [onReload, refreshStatus, sync?.state]);

  const handleSync = async () => {
    if (requesting || sync?.state === 'running') {
      setDrawerOpen(true);
      return;
    }
    setRequesting(true);
    setDrawerOpen(true);
    let actionMode = mode;

    if (actionMode === 'refresh' && IS_PROD) {
      const nextStatus = await getSyncStatus();
      if (nextStatus.mode === 'local-sync') {
        setMode('sync');
        actionMode = 'sync';
      } else {
        try {
          invalidateRealSessions();
          await onReload?.();
        } finally { setRequesting(false); }
        return;
      }
    }

    if (actionMode === 'refresh') {
      try {
        invalidateRealSessions();
        await onReload?.();
      } finally { setRequesting(false); }
      return;
    }

    const result = await triggerSync();
    if (result.status) setSync({ ...result.status, mode: sync?.mode || 'dev-sync' });
    await refreshStatus();
    setRequesting(false);
  };

  const state = requesting ? 'running' : sync?.state || 'idle';
  const Icon = state === 'succeeded' ? Check : state === 'failed' ? AlertCircle : RefreshCw;
  const accent =
    state === 'succeeded' ? 'var(--green)' :
    state === 'failed' ? 'var(--red)' :
    state === 'partial' ? 'var(--amber)' :
    state === 'running' ? 'var(--accent)' : 'var(--text-secondary)';
  const lastSync = sync?.artifact?.mtime || sync?.mtime;

  return (
    <>
    <div style={{ padding: '0 16px', marginBottom: 8 }}>
      <button
        onClick={handleSync}
        aria-haspopup="dialog"
        className="sidebar-sync-button"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8,
          background: 'var(--bg-page)', color: accent, cursor: state === 'running' ? 'progress' : 'pointer',
          fontSize: 12, fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.3s var(--ease)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        title={
          sync?.failure?.summary
          || (mode === 'sync'
            ? `Last sync: ${relativeTime(lastSync)}`
            : 'Reload the latest data already available to this dashboard')
        }
      >
        <span className={state === 'running' ? 'loop-spin' : ''} style={{ display: 'flex', alignItems: 'center' }}>
          <Icon size={14} />
        </span>
        <span className="sidebar-sync-text" style={{ flex: 1 }}>
          {state === 'running' ? (mode === 'sync' ? 'Syncing…' : 'Refreshing…')
            : state === 'succeeded' ? 'Sessions healthy'
              : state === 'partial' ? 'Synced with warning'
                : state === 'failed' ? 'Sync needs attention'
                : mode === 'sync' ? 'Sync sessions' : 'Refresh data'}
        </span>
        {state !== 'running' && lastSync && mode === 'sync' && (
          <span className="sidebar-sync-time" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{relativeTime(lastSync)}</span>
        )}
      </button>
    </div>
    <SyncActivityDrawer
      open={drawerOpen}
      status={sync}
      retrying={requesting}
      onClose={() => setDrawerOpen(false)}
      onRetry={() => { void handleSync(); }}
    />
    </>
  );
}


// ─── Theme toggle ────────────────────────────────────────────────────────────
//
// Sun/moon icon button in the sidebar footer. The light-theme tokens live in
// index.css under `:root[data-theme="light"]` so flipping the attribute
// repaints the dashboard chrome without a re-render. The Sanctum 3D scene
// and Companion 2D canvas keep their baked palettes regardless — they're
// not theme-aware (the fantasy environment lighting is intentional).

function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') ?? 'dark',
  );

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('meow-ops-theme', next); } catch { /* quota */ }
    setTheme(next);
  }

  const Icon = theme === 'dark' ? Sun : Moon;
  const tip  = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggle}
      title={tip}
      aria-label={tip}
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 6px',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s var(--ease)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-hover)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      <Icon size={12} />
    </button>
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
        top: 0, left: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
        zIndex: 50,
        overflowY: 'auto',
      }}
    >
      {/* Logo */}
      <div className="sidebar-logo-wrap" style={{ padding: '0 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src="/meow-logo-dark.png" alt="Meow Operations" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <span className="sidebar-logo-text" style={{ fontSize: 15, fontWeight: 300, color: 'var(--text-primary)' }}>Meow Operations</span>
      </div>

      {/* Nav — grouped sections (Insights / Operations / Living). Active item
          reads as a filled chip with rounded corners + 12px lateral margin
          rather than a 2px left border, matching the modern dashboard style
          (Linear, Vercel, Notion). The Sanctum gold-override is gone; the
          Operations section heading does the categorical work the gold used
          to do, and Sanctum reads as a normal nav item. */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label} style={{ marginTop: idx === 0 ? 0 : 14 }}>
            <Eyebrow className="sidebar-section-label" style={{ padding: '0 20px', marginBottom: 6 }}>
              {section.label}
            </Eyebrow>
            {section.items.map(({ id, label, icon: Icon }) => {
              const active = activePage === id;
              return (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  title={label}
                  className="sidebar-nav-button"
                  style={{
                    width: 'calc(100% - 16px)',
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    margin: '0 8px',
                    border: 'none',
                    background: active ? 'var(--bg-hover)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    letterSpacing: 'inherit',
                    textAlign: 'left',
                    borderRadius: 6,
                    transition: 'all 0.3s var(--ease)',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon size={16} />
                  <span className="sidebar-nav-label">{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ flexShrink: 0 }}>
        <SyncButton onReload={onReload} />
      </div>

      {/* Footer — theme toggle on the left, powered-by text on the right.
          Toggle reads/writes the document's data-theme attribute and
          persists to localStorage; main.jsx applies the initial value
          before render to avoid a flash of the wrong theme. */}
      <div style={{
        padding: '0 20px',
        color: 'var(--text-muted)',
        fontSize: 11,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <ThemeToggle />
        <div className="sidebar-powered-text">
          <span style={{ opacity: .5 }}>powered by</span>{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Meow Creative Haus</span>
        </div>
      </div>
    </aside>
  );
}
