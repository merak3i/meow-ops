// Collapsible wave cluster for the research lane.
// Clicking toggles expansion; the toggle itself is handled in LoopCanvas's
// onNodeClick so node data stays plain and serializable.
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusChip } from './StatusChip';
import type { ClusterNodeData } from './layout';

const style: CSSProperties = {
  background: 'var(--bg-hover)', border: '1px dashed var(--border-hover)',
  borderRadius: 8, padding: '10px 12px', width: 220, cursor: 'pointer',
  display: 'flex', flexDirection: 'column', gap: 4,
};

const handleStyle: CSSProperties = { opacity: 0, pointerEvents: 'none' };

export function ClusterNode({ data }: NodeProps<Node<ClusterNodeData>>) {
  const { wave, count, status, expanded, revealDelay } = data;
  return (
    <div
      className="loop-reveal"
      style={{ ...style, animationDelay: `${revealDelay}ms` }}
      data-testid="loop-cluster"
      data-wave={wave}
      data-expanded={expanded}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
        }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Wave {wave}
        </span>
        <StatusChip status={status} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        {count} research surface{count === 1 ? '' : 's'} — click to {expanded ? 'collapse' : 'expand'}
      </span>
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
    </div>
  );
}
