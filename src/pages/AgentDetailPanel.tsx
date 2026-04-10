// AgentDetailPanel.tsx — Slide-in right panel showing full details for a clicked agent session.
// Appears when user clicks any AgentRow in the AgentVisualizer.

import type { Session } from '@/types/session';
import { modelColor, modelLabel, cacheHitRate } from '@/lib/agent-tree';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentDetailPanelProps {
  session:  Session | null;
  onClose:  () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDur(sec: number): string {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' IST';
}

function Row({ label, value, mono = false, color }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: '5px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        fontSize: 12,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        color: color ?? 'var(--text-secondary)',
      }}>
        {value}
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgentDetailPanel({ session: s, onClose }: AgentDetailPanelProps) {
  // Keyboard close
  if (typeof window !== 'undefined') {
    // ESC handled by parent via useEffect
  }

  const isOpen = !!s;

  return (
    <div style={{
      position:   'fixed',
      top:        0,
      right:      isOpen ? 0 : -340,
      width:      320,
      height:     '100vh',
      background: 'var(--bg-card)',
      borderLeft: '1px solid var(--border)',
      boxShadow:  isOpen ? '-4px 0 24px rgba(0,0,0,0.4)' : 'none',
      transition: 'right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      zIndex:     200,
      overflowY:  'auto',
      padding:    '16px',
      boxSizing:  'border-box',
    }}>
      {s && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {s.agent_slug ?? s.session_id.slice(0, 22)}
              </div>
              <div style={{ fontSize: 11, color: modelColor(s.model), marginTop: 2 }}>
                {modelLabel(s.model)} · {s.cat_type}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 18, padding: '0 0 0 8px', lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Timing */}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            Timing
          </div>
          <Row label="Started"  value={fmtTime(s.started_at)} />
          <Row label="Duration" value={formatDur(s.duration_seconds)} mono />
          <Row label="Messages" value={`${s.message_count} (${s.user_message_count} user, ${s.assistant_message_count} asst)`} />
          {s.is_sidechain !== undefined && (
            <Row label="Sidechain" value={s.is_sidechain ? 'Yes' : 'No'} />
          )}
          {s.is_subagent && (
            <Row label="Subagent" value="Yes" />
          )}

          {/* Tokens */}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '14px 0 6px' }}>
            Tokens
          </div>
          <Row label="Input"       value={s.input_tokens.toLocaleString()}  mono />
          <Row label="Output"      value={s.output_tokens.toLocaleString()} mono />
          {s.cache_read_tokens > 0 && (
            <Row label="Cache read" value={s.cache_read_tokens.toLocaleString()} mono color="var(--cyan)" />
          )}
          {s.cache_creation_tokens > 0 && (
            <Row label="Cache create" value={s.cache_creation_tokens.toLocaleString()} mono />
          )}

          {/* Cache hit rate bar */}
          {cacheHitRate(s) > 0 && (() => {
            const pct = Math.round(cacheHitRate(s) * 100);
            return (
              <div style={{ marginTop: 6, marginBottom: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Cache hit rate</span>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--cyan)' }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--cyan)', borderRadius: 2 }} />
                </div>
              </div>
            );
          })()}

          {/* Cost */}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '14px 0 6px' }}>
            Cost
          </div>
          <Row
            label="Estimated"
            value={`$${s.estimated_cost_usd.toFixed(4)}`}
            mono
            color={s.estimated_cost_usd > 0.1 ? 'var(--amber)' : 'var(--text-secondary)'}
          />

          {/* Tools */}
          {s.tools && Object.keys(s.tools).length > 0 && (
            <>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '14px 0 6px' }}>
                Tools Used
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(s.tools)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tool, count]) => (
                    <span key={tool} style={{
                      fontSize: 10,
                      background: 'var(--border)',
                      borderRadius: 4,
                      padding: '2px 7px',
                      color: 'var(--text-secondary)',
                    }}>
                      {tool} <span style={{ color: 'var(--text-muted)' }}>×{count}</span>
                    </span>
                  ))}
              </div>
            </>
          )}

          {/* Ghost warning */}
          {s.is_ghost && (
            <div style={{
              marginTop: 16,
              padding: '8px 12px',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: 6,
              fontSize: 11,
              color: '#f87171',
            }}>
              ⚠ Ghost session — no assistant output recorded. Likely an error or timeout.
            </div>
          )}

          {/* Project / source */}
          <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {s.project} · {s.source} · {s.git_branch ?? 'no branch'}
            </div>
            {s.cwd && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
                {s.cwd}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
