// Read-only React Flow canvas (spec §Phase 2): no dragging, no connecting —
// agents log state, the UI renders it. Pan/zoom + minimap stay enabled.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Background, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildFlow } from './layout';
import type { LoopFlowNode } from './layout';
import { EntityNode } from './EntityNode';
import { ClusterNode } from './ClusterNode';
import type { LoopEntity, LoopSpecEdge } from './types';

const nodeTypes = { entity: EntityNode, cluster: ClusterNode };

// Follow the app-wide theme the Sidebar writes to <html data-theme>; React
// Flow's own dark/light chrome (minimap mask, edge strokes, dots) must match
// the surrounding app or light mode renders mismatched dark artifacts.
function subscribeTheme(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const getTheme = () => (document.documentElement.dataset['theme'] === 'light' ? 'light' as const : 'dark' as const);

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Lives inside <ReactFlow> so useReactFlow has store context. The fitView
// prop only fires once at mount; expanding a wave adds nodes far below the
// fitted viewport, so re-fit whenever the expansion set changes.
function FitOnExpand({ expandedWaves }: { expandedWaves: ReadonlySet<number> }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    void fitView({ padding: 0.1, duration: prefersReducedMotion() ? 0 : 200 });
  }, [expandedWaves, fitView]);
  return null;
}

interface LoopCanvasProps {
  entities: LoopEntity[];
  expandedWaves: ReadonlySet<number>;
  proposalCounts: ReadonlyMap<string, number>;
  dependencyEdges: LoopSpecEdge[];
  onToggleWave: (wave: number) => void;
  onSelectEntity: (entity: LoopEntity) => void;
  onOpenProposals: (entityId: string) => void;
}

export function LoopCanvas({
  entities, expandedWaves, proposalCounts, dependencyEdges, onToggleWave, onSelectEntity, onOpenProposals,
}: LoopCanvasProps) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const [showDependencies, setShowDependencies] = useState(false);
  const { nodes, edges: hierarchyEdges } = useMemo(
    () => buildFlow(entities, expandedWaves, proposalCounts, onOpenProposals),
    [entities, expandedWaves, proposalCounts, onOpenProposals],
  );
  const edges = useMemo(() => {
    if (!showDependencies) return hierarchyEdges;
    const visible = new Set(nodes.map((node) => node.id));
    const overlay = dependencyEdges
      .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: `dependency.${edge.id}`,
        className: 'loop-dependency-edge',
        animated: false,
        style: { strokeDasharray: '7 5', opacity: 0.55 },
      }));
    return [...hierarchyEdges, ...overlay];
  }, [dependencyEdges, hierarchyEdges, nodes, showDependencies]);

  const activate = (node: LoopFlowNode) => {
    if (node.type === 'cluster') onToggleWave(node.data.wave);
    else onSelectEntity(node.data.entity);
  };

  const handleNodeClick: NodeMouseHandler<LoopFlowNode> = (_event, node) => activate(node);

  // React Flow v12 fires the user onNodeClick only on the mouse path —
  // Enter/Space on a focused node wrapper just selects. Bridge the keyboard
  // path so the inspector and wave toggles stay reachable without a pointer.
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const wrapper = (event.target as HTMLElement).closest('.react-flow__node');
    const id = wrapper?.getAttribute('data-id');
    if (!id) return;
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    event.preventDefault();
    activate(node);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="loop-canvas" onKeyDown={handleKeyDown}>
      <button
        type="button"
        aria-pressed={showDependencies}
        onClick={() => setShowDependencies((shown) => !shown)}
        style={{
          position: 'absolute', zIndex: 5, top: 12, left: 12,
          border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px',
          background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {showDependencies ? 'Hide dependencies' : 'Show dependencies'}
      </button>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: false }}
          colorMode={theme}
        >
          <Background gap={24} />
          <MiniMap pannable zoomable style={{ background: 'var(--bg-card)' }} />
          <FitOnExpand expandedWaves={expandedWaves} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
