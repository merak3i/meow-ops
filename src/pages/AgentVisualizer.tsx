// AgentVisualizer.tsx — horizontal timeline showing subagent operation trees.
// Groups sessions by project + time proximity, renders indented agent rows
// with proportional duration bars and cost rollup.

import { useMemo, useState } from 'react';
import {
  getSessionRunGroups,
  modelColor,
  modelLabel,
} from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';
import type { Session } from '@/types/session';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentVisualizerProps {
  sessions: Session[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)        return 'just now';
  if (diff < 3_600_000)     return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000)    return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function formatDur(sec: number): string {
  if (sec < 60) return `${sec}s`;
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

// ─── Single agent row ─────────────────────────────────────────────────────────

function AgentRow({
  node,
  depth,
  maxDuration,
}: {
  node:        AgentTreeNode;
  depth:       number;
  maxDuration: number;
}) {
  const s           = node.session;
  const barPct      = maxDuration > 0 ? Math.max(2, (s.duration_seconds / maxDuration) * 100) : 2;
  const color       = modelColor(s.model);
  const label       = modelLabel(s.model);
  const slug        = s.agent_slug ?? s.session_id.slice(0, 14);
  const toolCount   = s.tools ? Object.values(s.tools).reduce((a, b) => a + b, 0) : 0;
  const topTools    = s.tools
    ? Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      gap:        10,
      paddingLeft: 16 + depth * 20,
      paddingRight: 16,
      paddingTop: 7,
      paddingBottom: 7,
      borderBottom: '1px solid var(--border)',
      fontSize: 12,
    }}>
      {/* Depth connector */}
      {depth > 0 && (
        <span style={{ color: 'var(--border)', fontSize: 10, marginLeft: -14, marginRight: 4, flexShrink: 0 }}>└─</span>
      )}

      {/* Cat type icon */}
      <span style={{ fontSize: 14, flexShrink: 0 }}>{catIcon(s.cat_type)}</span>

      {/* Model badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
        color, flexShrink: 0, minWidth: 52,
      }}>
        {label}
      </span>

      {/* Slug / name */}
      <span style={{ color: 'var(--text-secondary)', flex: '0 0 auto', minWidth: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {slug}
      </span>

      {/* Duration bar */}
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
        <div style={{
          height: '100%', width: `${barPct}%`,
          background: color, borderRadius: 3,
          opacity: 0.7,
        }} />
      </div>

      {/* Duration label */}
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 42, textAlign: 'right' }}>
        {formatDur(s.duration_seconds)}
      </span>

      {/* Tools */}
      {toolCount > 0 && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 60 }}>
          {topTools.map(([t, n]) => `${t.slice(0, 4)}×${n}`).join(' ')}
        </span>
      )}

      {/* Cost */}
      <span style={{
        fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
        color: s.estimated_cost_usd > 0.1 ? 'var(--amber)' : 'var(--text-muted)',
        flexShrink: 0, minWidth: 48, textAlign: 'right',
      }}>
        ${s.estimated_cost_usd.toFixed(3)}
      </span>
    </div>
  );
}

// ─── Run group ────────────────────────────────────────────────────────────────

function RunGroupCard({
  group,
  projectFilter,
}: {
  group:         SessionRunGroup;
  projectFilter: string;
}) {
  const [open, setOpen] = useState(true);

  if (projectFilter && group.project !== projectFilter) return null;

  // Flatten roots + children for rendering in order
  const rows: Array<{ node: AgentTreeNode; depth: number }> = [];
  function collect(node: AgentTreeNode, depth: number) {
    rows.push({ node, depth });
    for (const child of node.children) collect(child, depth + 1);
  }
  for (const root of group.roots) collect(root, 0);

  const maxDuration = Math.max(...rows.map((r) => r.node.session.duration_seconds), 1);
  const agentCount  = rows.length;
  const relTime     = relativeTime(group.startedAt);

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border)',
      borderRadius: 10,
      overflow:     'hidden',
      marginBottom: 12,
    }}>
      {/* Group header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width:       '100%',
          display:     'flex',
          alignItems:  'center',
          gap:         12,
          padding:     '11px 16px',
          background:  'none',
          border:      'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor:      'pointer',
          fontFamily:  'inherit',
          textAlign:   'left',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>

        {/* Project */}
        <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
          {group.project}
        </span>

        {/* Agent count */}
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {agentCount} agent{agentCount !== 1 ? 's' : ''}
        </span>

        <span style={{ flex: 1 }} />

        {/* Time */}
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{relTime}</span>

        {/* Total cost */}
        <span style={{
          fontSize: 12,
          fontFamily: 'JetBrains Mono, monospace',
          color: group.totalCost > 0.5 ? 'var(--amber)' : 'var(--text-secondary)',
          fontWeight: 600,
        }}>
          ${group.totalCost.toFixed(3)}
        </span>
      </button>

      {/* Rows */}
      {open && rows.map(({ node, depth }, i) => (
        <AgentRow key={i} node={node} depth={depth} maxDuration={maxDuration} />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentVisualizer({ sessions }: AgentVisualizerProps) {
  const [projectFilter, setProjectFilter] = useState('');
  const [expandAll, setExpandAll]         = useState(true);

  const groups = useMemo(() => getSessionRunGroups(sessions), [sessions]);

  // Unique project names for filter
  const projects = useMemo(() => {
    const set = new Set(sessions.map((s) => s.project));
    return ['', ...Array.from(set).sort()];
  }, [sessions]);

  const totalCost   = groups.reduce((a, g) => a + g.totalCost, 0);
  const totalAgents = sessions.filter((s) => s.is_subagent).length;

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🌲</div>
        <p style={{ fontSize: 14, marginBottom: 8 }}>No agent sessions found</p>
        <p style={{ fontSize: 12 }}>
          Run Claude Code with subagents enabled, then re-sync your sessions.
        </p>
        <pre style={{
          display: 'inline-block',
          marginTop: 16,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 20px',
          fontSize: 12,
          color: 'var(--accent)',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          node sync/export-local.mjs
        </pre>
      </div>
    );
  }

  return (
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
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{
            padding:      '7px 10px',
            background:   'var(--bg-card)',
            border:       '1px solid var(--border)',
            borderRadius: 6,
            color:        'var(--text-secondary)',
            fontSize:     12,
            fontFamily:   'inherit',
            cursor:       'pointer',
          }}
        >
          {projects.map((p) => (
            <option key={p} value={p}>{p || 'All projects'}</option>
          ))}
        </select>

        <button
          onClick={() => setExpandAll((v) => !v)}
          style={{
            padding:      '7px 14px',
            background:   'var(--bg-card)',
            border:       '1px solid var(--border)',
            borderRadius: 6,
            color:        'var(--text-secondary)',
            fontSize:     12,
            fontFamily:   'inherit',
            cursor:       'pointer',
          }}
        >
          {expandAll ? 'Collapse all' : 'Expand all'}
        </button>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {groups.length} run group{groups.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Run groups */}
      {groups.map((group) => (
        <RunGroupCard
          key={group.id}
          group={group}
          projectFilter={projectFilter}
        />
      ))}
    </div>
  );
}
