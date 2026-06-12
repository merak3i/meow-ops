// Custom React Flow node rendering all three entity kinds. Spec §7 node
// anatomy: full answers to the four questions live in the inspector drawer;
// the node face shows identity, lane, wave, and operational status.
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { StatusChip } from './StatusChip';
import type { EntityNodeData } from './layout';
import type { LoopEntity } from './types';

type LoopEntityKind = LoopEntity['kind'];

const KIND_STYLE: Record<LoopEntityKind, CSSProperties> = {
  coordinator: { borderColor: 'var(--accent)', minWidth: 220 },
  director: { borderColor: 'var(--border-hover)', minWidth: 180 },
  assistant: { borderColor: 'var(--border)', width: 220 },
};

const baseStyle: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', gap: 4,
};

const handleStyle: CSSProperties = { opacity: 0, pointerEvents: 'none' };

export function EntityNode({ data }: NodeProps<Node<EntityNodeData>>) {
  const { entity, revealDelay } = data;
  const kindStyle = KIND_STYLE[entity.kind];
  return (
    <div
      className="loop-reveal"
      style={{ ...baseStyle, ...kindStyle, animationDelay: `${revealDelay}ms` }}
      data-testid="loop-entity"
      data-entity-id={entity.id}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entity.label}
        </span>
        <StatusChip status={entity.status} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
        {entity.surfaceKey && <code style={{ fontSize: 10 }}>{entity.surfaceKey}</code>}
        {entity.kind !== 'assistant' && <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{entity.kind}</span>}
        {entity.archetype && <span>{entity.archetype}</span>}
        {entity.riskClass && <span>{entity.riskClass}</span>}
        {entity.wave !== null && <span>W{entity.wave}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
    </div>
  );
}
