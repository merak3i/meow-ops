import { CHAMPION_META, NODE_H, NODE_STATUS_COLOR, NODE_W } from './championsConfig';
import type { SsNode } from './types';

interface Props {
  node: SsNode;
  onClick?: (node: SsNode) => void;
}

function formatMana(usd: number): string {
  if (usd === 0) return '$0.000000';
  if (usd < 0.0001) return `$${usd.toFixed(8)}`;
  return `$${usd.toFixed(6)}`;
}

function formatStamina(ms: number): string {
  if (ms === 0) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function ChampionNode({ node, onClick }: Props) {
  const meta       = CHAMPION_META[node.node_type];
  const statusCol  = NODE_STATUS_COLOR[node.status];
  const isActive   = node.status === 'active';

  const x = node.position_x - NODE_W / 2;
  const y = node.position_y - NODE_H / 2;

  return (
    <g style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={() => onClick?.(node)}>

      {/* Active breathing ring */}
      {isActive && (
        <circle
          cx={node.position_x}
          cy={node.position_y}
          r={NODE_W / 2 - 4}
          fill="none"
          stroke={meta.accentColor}
          strokeWidth={1}
          className="champion-active-ring"
        />
      )}

      {/* Card shell via foreignObject */}
      <foreignObject x={x} y={y} width={NODE_W} height={NODE_H} style={{ overflow: 'visible' }}>
        {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
        {/* @ts-ignore — xmlns required inside SVG foreignObject */}
        <div xmlns="http://www.w3.org/1999/xhtml"
          className="champion-card"
          style={{
            border: `1px solid ${meta.borderColor}`,
            boxShadow: `0 0 18px ${meta.glowColor}, inset 0 0 0 1px ${meta.accentColor}18`,
          }}
        >
          {/* Status dot */}
          <div
            className="champion-status-dot"
            style={{ background: statusCol, boxShadow: `0 0 5px ${statusCol}` }}
          />

          {/* Header */}
          <div className="champion-card-header">
            <span className="champion-sigil" style={{ color: meta.accentColor }}>
              {meta.sigil}
            </span>
            <span className="champion-label" style={{ color: meta.accentColor }}>
              {node.label}
            </span>
          </div>

          {/* Role subtitle */}
          <div className="champion-role">{meta.role}</div>

          {/* Metrics */}
          <div className="champion-metrics">
            <div className="metric metric-mana">
              <span className="metric-label">Mana Burn</span>
              <span className="metric-value">{formatMana(node.mana_burn)}</span>
            </div>
            <div className="metric metric-stam">
              <span className="metric-label">Stamina</span>
              <span className="metric-value">{formatStamina(node.stamina_ms)}</span>
            </div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
}
