import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Check, AlertCircle, Sun, Moon,
} from 'lucide-react';
import { triggerSync, getSyncStatus, invalidateRealSessions } from '../lib/queries';
import { Eyebrow } from './ui/Eyebrow';
import { NAV_SECTIONS } from './nav-config';

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
      const isLocalServerDown = (result.error || '').includes('Local sync server')
        || (result.error || '').includes('fetch')
        || (result.error || '').includes('Failed')
        || (result.stderr || '').includes('spawn');
      setErrorMsg(isLocalServerDown ? '__local_server__' : (result.error || result.stderr || 'Sync failed'));
      setTimeout(() => setStatus('idle'), 8000);
    }
  };

  const [showPopup, setShowPopup] = useState(false);
  const isLocalError = errorMsg === '__local_server__';

  useEffect(() => {
    if (status === 'error' && isLocalError) setShowPopup(true);
  }, [status, isLocalError]);

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
        title={isLocalError ? 'Local sync server not running' : errorMsg || `Last sync: ${relativeTime(lastSync)}`}
      >
        <motion.span
          animate={status === 'syncing' ? { rotate: 360 } : { rotate: 0 }}
          transition={status === 'syncing' ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Icon size={14} />
        </motion.span>
        <span style={{ flex: 1 }}>
          {status === 'syncing' ? 'Syncing…' : status === 'success' ? 'Synced' : status === 'error' ? (isLocalError ? 'Server offline' : 'Failed') : 'Sync sessions'}
        </span>
        {status === 'idle' && lastSync && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{relativeTime(lastSync)}</span>
        )}
      </button>
      <AnimatePresence>
        {status === 'error' && errorMsg && !isLocalError && (
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

      {/* Local sync server popup */}
      <AnimatePresence>
        {showPopup && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            style={{
              position: 'fixed', bottom: 80, left: 16, zIndex: 999,
              width: 320, padding: '16px 18px',
              background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border)',
              borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.5)',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e8e8e8)' }}>
                Local sync server needed
              </div>
              <button
                onClick={() => setShowPopup(false)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: 16, lineHeight: 1, padding: '0 2px',
                }}
              >x</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary, #a0a0b0)', lineHeight: 1.5, marginBottom: 12 }}>
              Sync reads session data from your machine and pushes it to the cloud. Open a terminal and run:
            </div>
            <div
              onClick={() => { navigator.clipboard.writeText('cd ~/repos/meow-ops && node sync/local-api.mjs'); }}
              style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(0,0,0,.4)', border: '1px solid var(--border)',
                fontFamily: 'monospace', fontSize: 11, color: 'var(--green, #63f7b3)',
                cursor: 'pointer', userSelect: 'all',
                lineHeight: 1.6,
              }}
              title="Click to copy"
            >
              <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>$</div>
              <div>cd ~/repos/meow-ops</div>
              <div>node sync/local-api.mjs</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>click to copy</div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
              Keep it running while you use the dashboard. Then hit Sync again.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      <div style={{ padding: '0 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src="/meow-logo-dark.png" alt="Meow Operations" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <span style={{ fontSize: 15, fontWeight: 300, color: 'var(--text-primary)' }}>Meow Operations</span>
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
            <Eyebrow style={{ padding: '0 20px', marginBottom: 6 }}>
              {section.label}
            </Eyebrow>
            {section.items.map(({ id, label, icon: Icon }) => {
              const active = activePage === id;
              return (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
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
                  {label}
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
        <div>
          <span style={{ opacity: .5 }}>powered by</span>{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Meow Creative Haus</span>
        </div>
      </div>
    </aside>
  );
}
