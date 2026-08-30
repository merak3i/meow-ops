import { useState } from 'react';
import {
  AlertCircle, Check, Moon, RefreshCw, Search, Sun,
} from 'lucide-react';

import { NAV } from './nav-config';
import SyncActivityDrawer from './SyncActivityDrawer';
import { Button } from './ui/Button';
import type { SyncController } from '../lib/useSync';
import type { Theme } from '../lib/useTheme';

// Five items, each with its keyboard jump shown on hover. The sidebar is now
// the discoverable path; Cmd+K is the fast one.

function relativeTime(ms: number | null): string {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const SYNC_LABEL: Record<string, string> = {
  running: 'Working…',
  succeeded: 'Up to date',
  partial: 'Synced with a warning',
  failed: 'Sync needs attention',
};

export interface SidebarProps {
  activeSurface: string;
  onNavigate: (surface: string) => void;
  onOpenPalette: () => void;
  sync: SyncController;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function Sidebar({
  activeSurface, onNavigate, onOpenPalette, sync, theme, onToggleTheme,
}: SidebarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const StatusIcon = sync.state === 'succeeded' ? Check : sync.state === 'failed' ? AlertCircle : RefreshCw;
  const statusColor =
    sync.state === 'succeeded' ? 'var(--green)'
      : sync.state === 'failed' ? 'var(--red)'
        : sync.state === 'partial' ? 'var(--amber)'
          : sync.state === 'running' ? 'var(--accent)'
            : 'var(--text-secondary)';

  const idleLabel = sync.mode === 'sync' ? 'Sync sessions' : 'Reload data';
  const themeTip = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <>
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
          padding: '18px 0',
          gap: 'var(--sp-4)',
          zIndex: 50,
          overflowY: 'auto',
        }}
      >
        <div
          className="sidebar-logo-wrap"
          style={{ padding: '0 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}
        >
          <img src="/meow-logo-dark.png" alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
          <span
            className="sidebar-logo-text"
            style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-primary)' }}
          >
            Meow Ops
          </span>
        </div>

        <div style={{ padding: '0 12px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onOpenPalette}
            className="mo-btn mo-btn--block sidebar-search-button"
            title="Search and jump anywhere (Cmd K)"
            style={{ justifyContent: 'flex-start', color: 'var(--text-muted)', fontWeight: 400 }}
          >
            <Search size={14} aria-hidden="true" />
            <span className="sidebar-nav-label" style={{ flex: 1, textAlign: 'left' }}>Search…</span>
            <kbd className="mo-kbd sidebar-nav-label">⌘K</kbd>
          </button>
        </div>

        <nav
          aria-label="Primary"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}
        >
          {NAV.map(({ id, label, icon: Icon, shortcut, description }) => {
            const active = activeSurface === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                title={`${description}  (g ${shortcut})`}
                aria-current={active ? 'page' : undefined}
                className="sidebar-nav-button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: 'var(--r-sm)',
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--fs-body)',
                  fontWeight: active ? 500 : 400,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.15s var(--ease), color 0.15s var(--ease)',
                }}
              >
                <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span className="sidebar-nav-label" style={{ flex: 1 }}>{label}</span>
                <kbd className="mo-kbd sidebar-nav-label" aria-hidden="true" style={{ opacity: active ? 0.8 : 0.35 }}>
                  {shortcut}
                </kbd>
              </button>
            );
          })}
        </nav>

        <div style={{ padding: '0 12px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setDrawerOpen(true); void sync.run(); }}
            aria-haspopup="dialog"
            className="mo-btn mo-btn--block sidebar-sync-button"
            title={sync.status?.failure?.summary
              ?? (sync.mode === 'sync'
                ? `Last sync ${relativeTime(sync.lastSyncAt)}`
                : 'Reload the data already available to this dashboard')}
            style={{ justifyContent: 'flex-start', color: statusColor, fontWeight: 400 }}
          >
            <span className={sync.state === 'running' ? 'loop-spin' : ''} style={{ display: 'flex' }}>
              <StatusIcon size={14} aria-hidden="true" />
            </span>
            <span className="sidebar-sync-text" style={{ flex: 1, textAlign: 'left' }}>
              {SYNC_LABEL[sync.state] ?? idleLabel}
            </span>
            {sync.state !== 'running' && sync.lastSyncAt && sync.mode === 'sync' && (
              <span className="sidebar-sync-time" style={{ fontSize: 'var(--fs-label)', color: 'var(--text-muted)' }}>
                {relativeTime(sync.lastSyncAt)}
              </span>
            )}
          </button>
        </div>

        <div
          style={{
            padding: '0 18px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--sp-2)',
          }}
        >
          <Button variant="ghost" size="sm" icon label={themeTip} onClick={onToggleTheme}>
            <ThemeIcon size={13} aria-hidden="true" />
          </Button>
          <div
            className="sidebar-powered-text"
            style={{ fontSize: 'var(--fs-label)', color: 'var(--text-muted)' }}
          >
            local only
          </div>
        </div>
      </aside>

      <SyncActivityDrawer
        open={drawerOpen}
        status={sync.status}
        retrying={sync.requesting}
        onClose={() => setDrawerOpen(false)}
        onRetry={() => { void sync.run(); }}
      />
    </>
  );
}
