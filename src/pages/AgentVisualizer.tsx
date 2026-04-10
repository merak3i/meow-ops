// AgentVisualizer.tsx — wall-clock Gantt timeline for subagent operation trees.
// Groups sessions by project + time proximity, renders indented agent rows with
// absolute Gantt positioning, efficiency index, ghost flagging, and drill-down panel.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getSessionRunGroups,
  modelColor,
  modelLabel,
  efficiencyIndex,
  cacheHitRate,
} from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';
import type { Session } from '@/types/session';
import { AgentDetailPanel } from './AgentDetailPanel';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentVisualizerProps {
  sessions: Session[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function formatDur(sec: number): string {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function catIcon(type: string): string {
  const icons: Record<string, string> = {
    builder:     '🏗️',
    detective:   '🔍',
    commander:   '💻',
    architect:   '📐',
    guardian:    '🛡️',
    storyteller: '📝',
    ghost:       '👻',
  };
  return icons[type] ?? '🐱';
}

function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
  });
}

// ─── Single agent row (Gantt-positioned) ─────────────────────────────────────

function AgentRow({
  node,
  depth,
  groupStart,
  groupSpan,
  onSelect,
}: {
  node:       AgentTreeNode;
  depth:      number;
  groupStart: number;
  groupSpan:  number;
  onSelect:   (s: Session) => void;
}) {
  const s       = node.session;
  const isGhost = !!s.is_ghost;
  const color   = modelColor(s.model);
  const label   = modelLabel(s.model);
  const slug    = s.agent_slug ?? s.session_id.slice(0, 16);

  // Wall-clock Gantt positioning
  const agentStartMs = new Date(s.started_at).getTime();
  const barLeft  = groupSpan > 0 ? Math.max(0, (agentStartMs - groupStart) / groupSpan * 100) : 0;
  const barWidth = groupSpan > 0
    ? Math.max(2, Math.min(100 - barLeft, s.duration_seconds * 1000 / groupSpan * 100))
    : 2;

  const hitRate = cacheHitRate(s);

  const topTools = s.tools
    ? Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(s)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(s)}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           8,
        paddingLeft:   12 + depth * 18,
        paddingRight:  12,
        paddingTop:    6,
        paddingBottom: 6,
        borderBottom:  '1px solid var(--border)',
        fontSize:      12,
        cursor:        'pointer',
        opacity:       isGhost ? 0.55 : 1,
        background:    'transparent',
        transition:    'background 0.12s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Tree connector */}
      {depth > 0 && (
        <span style={{ color: 'var(--border)', fontSize: 9, flexShrink: 0, marginLeft: -12 }}>└─</span>
      )}

      {/* Type icon */}
      <span style={{ fontSize: 13, flexShrink: 0 }}>{catIcon(s.cat_type)}</span>

      {/* Model badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.5, color, flexShrink: 0, minWidth: 48,
      }}>
        {label}
      </span>

      {/* Ghost badge */}
      {isGhost && (
        <span style={{
          fontSize: 9, color: 'var(--text-muted)',
          background: 'var(--border)', borderRadius: 3,
          padding: '1px 5px', flexShrink: 0,
        }}>
          ghost
        </span>
      )}

      {/* Slug */}
      <span style={{
        color: 'var(--text-secondary)', flexShrink: 0,
        maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {slug}
      </span>

      {/* Gantt bar */}
      <div style={{
        flex: 1, height: 8, background: 'var(--border)',
        borderRadius: 3, overflow: 'hidden', minWidth: 40,
        position: 'relative',
      }}>
        {/* Main bar — wall-clock positioned */}
        <div style={{
          position:   'absolute',
          left:       `${barLeft}%`,
          width:      `${barWidth}%`,
          height:     '100%',
          background: isGhost ? 'var(--text-muted)' : color,
          borderRadius: 3,
          opacity:    0.72,
          backgroundImage: isGhost
            ? 'repeating-linear-gradient(90deg,transparent,transparent 5px,rgba(0,0,0,0.25) 5px,rgba(0,0,0,0.25) 10px)'
            : 'none',
        }} />
        {/* Cache hit micro-bar (teal, bottom 2px) */}
        {hitRate > 0.05 && (
          <div style={{
            position: 'absolute',
            left:     `${barLeft}%`,
            width:    `${barWidth * hitRate}%`,
            height:   2,
            bottom:   0,
            background: 'var(--cyan)',
          }} />
        )}
      </div>

      {/* Duration */}
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 38, textAlign: 'right' }}>
        {formatDur(s.duration_seconds)}
      </span>

      {/* Top tools */}
      {topTools.length > 0 && (
        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, minWidth: 56 }}>
          {topTools.map(([t, n]) => `${t.slice(0, 4)}×${n}`).join(' ')}
        </span>
      )}

      {/* Cost */}
      <span style={{
        fontSize: 11, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0,
        minWidth: 46, textAlign: 'right',
        color: s.estimated_cost_usd > 0.1 ? 'var(--amber)' : 'var(--text-muted)',
      }}>
        ${s.estimated_cost_usd.toFixed(3)}
      </span>
    </div>
  );
}

// ─── Run group card ───────────────────────────────────────────────────────────

function RunGroupCard({
  group,
  projectFilter,
  forceOpen,
  onSelectSession,
}: {
  group:           SessionRunGroup;
  projectFilter:   string;
  forceOpen:       boolean;
  onSelectSession: (s: Session) => void;
}) {
  // Flatten rows first — needed for ghost detection before useState
  const rows: Array<{ node: AgentTreeNode; depth: number }> = [];
  const collect = (node: AgentTreeNode, depth: number) => {
    rows.push({ node, depth });
    for (const child of node.children) collect(child, depth + 1);
  };
  for (const root of group.roots) collect(root, 0);

  const ghostCount = rows.filter((r) => r.node.session.is_ghost).length;
  const allGhosts  = rows.length > 0 && ghostCount === rows.length;

  // Open state: ghost runs default-collapsed; sync with external forceOpen
  const [open, setOpen]   = useState(!allGhosts);
  const prevForce         = useRef(forceOpen);
  useEffect(() => {
    if (prevForce.current !== forceOpen) {
      prevForce.current = forceOpen;
      setOpen(forceOpen ? true : !allGhosts);
    }
  }, [forceOpen, allGhosts]);

  if (projectFilter && group.project !== projectFilter) return null;

  const agentCount = rows.length;
  const relTime    = relativeTime(group.startedAt);

  // Wall-clock span for Gantt ruler + positioning
  let groupStart = Infinity;
  let groupEnd   = -Infinity;
  for (const { node: n } of rows) {
    const s   = n.session;
    const st  = new Date(s.started_at).getTime();
    const et  = new Date(s.ended_at || s.started_at).getTime() + s.duration_seconds * 1000;
    if (st < groupStart) groupStart = st;
    if (et > groupEnd)   groupEnd   = et;
  }
  const groupSpan = Math.max(groupEnd - groupStart, 1000);

  // Efficiency: sum over all roots
  const totalOutput = rows.reduce((sum, r) => sum + (r.node.session.output_tokens || 0), 0);
  const eff = group.totalCost > 0 ? Math.round(totalOutput / group.totalCost) : 0;

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border)',
      borderRadius: 10,
      overflow:     'hidden',
      marginBottom: 12,
      opacity:      allGhosts ? 0.65 : 1,
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width:        '100%',
          display:      'flex',
          alignItems:   'center',
          gap:          10,
          padding:      '10px 14px',
          background:   'none',
          border:       'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor:       'pointer',
          fontFamily:   'inherit',
          textAlign:    'left',
        }}
      >
        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
          {open ? '▼' : '▶'}
        </span>

        <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
          {group.project}
        </span>

        {allGhosts && (
          <span style={{
            fontSize: 9, color: 'var(--text-muted)',
            background: 'var(--border)', borderRadius: 3, padding: '1px 6px', flexShrink: 0,
          }}>
            ⚠ ghost run
          </span>
        )}

        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          {agentCount} agent{agentCount !== 1 ? 's' : ''}
          {ghostCount > 0 ? ` · ${ghostCount} ghost` : ''}
        </span>

        <span style={{ flex: 1 }} />

        {eff > 0 && (
          <span style={{ fontSize: 10, color: 'var(--cyan)', flexShrink: 0 }}>
            ⚡ {eff.toLocaleString()} tok/$
          </span>
        )}

        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          {relTime}
        </span>

        <span style={{
          fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, flexShrink: 0,
          color: group.totalCost > 0.5 ? 'var(--amber)' : 'var(--text-secondary)',
        }}>
          ${group.totalCost.toFixed(3)}
        </span>
      </button>

      {open && (
        <>
          {/* Time ruler */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '3px 14px 2px',
            fontSize: 9, color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border)',
          }}>
            <span>⏱ {shortTime(groupStart)}</span>
            <span>{shortTime(groupEnd)} IST</span>
          </div>

          {/* Agent rows */}
          {rows.map(({ node, depth }, i) => (
            <AgentRow
              key={i}
              node={node}
              depth={depth}
              groupStart={groupStart}
              groupSpan={groupSpan}
              onSelect={onSelectSession}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentVisualizer({ sessions }: AgentVisualizerProps) {
  const [projectFilter,  setProjectFilter]  = useState('');
  const [expandAll,      setExpandAll]      = useState(true);
  const [detailSession,  setDetailSession]  = useState<Session | null>(null);

  // Close detail panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailSession(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const groups = useMemo(() => getSessionRunGroups(sessions), [sessions]);

  const projects = useMemo(() => {
    const set = new Set(sessions.map((s) => s.project));
    return ['', ...Array.from(set).sort()];
  }, [sessions]);

  const totalCost   = groups.reduce((a, g) => a + g.totalCost, 0);
  const totalAgents = sessions.filter((s) => s.is_subagent).length;
  const totalGhosts = sessions.filter((s) => s.is_ghost).length;

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🌲</div>
        <p style={{ fontSize: 14, marginBottom: 8 }}>No agent sessions found</p>
        <p style={{ fontSize: 12 }}>
          Run Claude Code with subagents enabled, then re-sync your sessions.
        </p>
        <pre style={{
          display: 'inline-block', marginTop: 16,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 20px',
          fontSize: 12, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace',
        }}>
          node sync/export-local.mjs
        </pre>
      </div>
    );
  }

  return (
    <>
      {/* Detail panel — fixed right slide-in */}
      <AgentDetailPanel
        session={detailSession}
        onClose={() => setDetailSession(null)}
      />

      <div>
        {/* Header stats */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Runs</div>
            <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-primary)' }}>{groups.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Subagents</div>
            <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-primary)' }}>{totalAgents}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Total cost</div>
            <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--amber)' }}>${totalCost.toFixed(3)}</div>
          </div>
          {totalGhosts > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Ghosts</div>
              <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-muted)' }}>{totalGhosts}</div>
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            style={{
              padding: '7px 10px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-secondary)', fontSize: 12,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {projects.map((p) => (
              <option key={p} value={p}>{p || 'All projects'}</option>
            ))}
          </select>

          <button
            onClick={() => setExpandAll((v) => !v)}
            style={{
              padding: '7px 14px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-secondary)', fontSize: 12,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {expandAll ? 'Collapse all' : 'Expand all'}
          </button>

          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {groups.length} run group{groups.length !== 1 ? 's' : ''}
          </span>

          {detailSession && (
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
              ← click a row · Esc to close panel
            </span>
          )}
        </div>

        {/* Run groups */}
        {groups.map((group) => (
          <RunGroupCard
            key={group.id}
            group={group}
            projectFilter={projectFilter}
            forceOpen={expandAll}
            onSelectSession={setDetailSession}
          />
        ))}
      </div>
    </>
  );
}
