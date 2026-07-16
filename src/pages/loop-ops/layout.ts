// Deterministic lane layout for the Loop-Ops canvas. The hierarchy is fixed
// (1 coordinator → 4 directors → 26 assistants), so node positions are computed
// directly — no runtime layout engine. The tenant lane (22 surfaces) clusters
// by wave into collapsible groups so the default view stays readable (spec §4).
import type { Edge, Node } from '@xyflow/react';
import { LOOP_GROUPS, worstStatus } from './types';
import type { LoopEntity, LoopGroup, LoopStatus } from './types';

export type EntityNodeData = Record<string, unknown> & {
  entity: LoopEntity;
  revealDelay: number;
  openProposalCount: number;
  onOpenProposals?: (entityId: string) => void;
};
export type ClusterNodeData = Record<string, unknown> & {
  wave: number;
  count: number;
  status: LoopStatus;
  expanded: boolean;
  revealDelay: number;
};

// Discriminated node union — lets onNodeClick narrow on node.type with no casts.
export type LoopFlowNode = Node<EntityNodeData, 'entity'> | Node<ClusterNodeData, 'cluster'>;

const NODE_W = 220;
const COL_GAP = 44;
const ROW_GAP = 100;
const DIRECTOR_Y = 150;
const CONTENT_Y = 300;

// Tenant occupies four wave columns; the other lanes get one column each.
const TENANT_WAVES = [1, 2, 3, 4] as const;
const laneColX = (col: number) => 40 + col * (NODE_W + COL_GAP);
const LANE_COLS: Record<LoopGroup, number[]> = {
  tenant: TENANT_WAVES.map((_, i) => laneColX(i)),
  customer: [laneColX(4)],
  admin: [laneColX(5)],
  doer: [laneColX(6)],
};

// Stagger node reveal on load; index.css disables it under reduced motion.
// The delay rides on node data and is applied INSIDE the custom node component
// — never on the React Flow wrapper, whose transform carries the position.
const revealDelay = (index: number) => Math.min(index * 30, 600);

export function buildFlow(
  entities: LoopEntity[],
  expandedWaves: ReadonlySet<number>,
  proposalCounts: ReadonlyMap<string, number> = new Map(),
  onOpenProposals?: (entityId: string) => void,
): { nodes: LoopFlowNode[]; edges: Edge[] } {
  const nodes: LoopFlowNode[] = [];
  const edges: Edge[] = [];
  let reveal = 0;
  const entityData = (entity: LoopEntity): EntityNodeData => ({
    entity,
    revealDelay: revealDelay(reveal++),
    openProposalCount: proposalCounts.get(entity.id) ?? 0,
    ...(onOpenProposals ? { onOpenProposals } : {}),
  });

  const assistants = entities.filter((e) => e.kind === 'assistant');
  const directors = entities.filter((e) => e.kind === 'director');
  const coordinator = entities.find((e) => e.kind === 'coordinator');

  const laneCenter = (g: LoopGroup): number => {
    const cols = LANE_COLS[g];
    const first = cols[0] ?? 40;
    const last = cols[cols.length - 1] ?? first;
    return (first + last) / 2;
  };

  if (coordinator) {
    nodes.push({
      id: coordinator.id, type: 'entity', data: entityData(coordinator),
      position: { x: (laneCenter('tenant') + laneCenter('doer')) / 2, y: 0 },
      draggable: false, connectable: false,
    });
  }

  for (const g of LOOP_GROUPS) {
    const director = directors.find((d) => d.group === g);
    if (!director) continue;
    nodes.push({
      id: director.id, type: 'entity', data: entityData(director),
      position: { x: laneCenter(g), y: DIRECTOR_Y },
      draggable: false, connectable: false,
    });
    if (coordinator) {
      edges.push({ id: `e.${coordinator.id}.${director.id}`, source: coordinator.id, target: director.id });
    }

    const laneAssistants = assistants.filter((a) => a.group === g);
    if (g === 'tenant') {
      TENANT_WAVES.forEach((wave, col) => {
        const inWave = laneAssistants.filter((a) => a.wave === wave);
        // An empty wave gets no cluster node — rendering one would show a
        // status for zero surfaces and an expand that does nothing.
        if (inWave.length === 0) return;
        const colX = LANE_COLS.tenant[col] ?? 40;
        const clusterId = `cluster.tenant.wave${wave}`;
        const expanded = expandedWaves.has(wave);
        nodes.push({
          id: clusterId, type: 'cluster',
          data: { wave, count: inWave.length, status: worstStatus(inWave.map((a) => a.status)), expanded, revealDelay: revealDelay(reveal++) },
          position: { x: colX, y: CONTENT_Y },
          draggable: false, connectable: false,
        });
        edges.push({ id: `e.${director.id}.${clusterId}`, source: director.id, target: clusterId });
        if (expanded) {
          inWave.forEach((a, row) => {
            nodes.push({
              id: a.id, type: 'entity', data: entityData(a),
              position: { x: colX, y: CONTENT_Y + 90 + row * ROW_GAP },
              draggable: false, connectable: false,
            });
            edges.push({ id: `e.${clusterId}.${a.id}`, source: clusterId, target: a.id });
          });
        }
      });
    } else {
      laneAssistants.forEach((a, row) => {
        nodes.push({
          id: a.id, type: 'entity', data: entityData(a),
          position: { x: laneCenter(g), y: CONTENT_Y + row * ROW_GAP },
          draggable: false, connectable: false,
        });
        edges.push({ id: `e.${director.id}.${a.id}`, source: director.id, target: a.id });
      });
    }
  }

  // Phase 2 has no active runs, so no edge is animated (motion spec §8: edge
  // pulse only for active runs). Phase 5 flips `animated` per running entity.
  return { nodes, edges: edges.map((e) => ({ ...e, animated: false })) };
}
