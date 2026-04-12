export type NodeType =
  | 'argent_vanguard'
  | 'ebon_blade_scout'
  | 'dalaran_archmage'
  | 'argent_herald';

export type NodeStatus   = 'idle' | 'active' | 'completed' | 'error';
export type EdgeStatus   = 'healthy' | 'choked' | 'severed';
export type PayloadType  = 'json' | 'text' | 'error';
export type RunestoneStatus = 'transit' | 'delivered' | 'failed';

export interface SsPipeline {
  id: string;
  tenant_id: string;
  name: string;
  session_id: string | null;
  status: 'active' | 'completed' | 'failed' | 'idle';
  created_at: string;
  updated_at: string;
}

export interface SsNode {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  node_type: NodeType;
  label: string;
  position_x: number;
  position_y: number;
  status: NodeStatus;
  mana_burn: number;    // cumulative USD cost (6dp)
  stamina_ms: number;   // last measured latency in ms
  token_count: number;
  created_at: string;
  updated_at: string;
}

export interface SsEdge {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  source_id: string;
  target_id: string;
  status: EdgeStatus;
  latency_ms: number;
  created_at: string;
  updated_at: string;
}

export interface SsRunestone {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  edge_id: string;
  payload_type: PayloadType;
  payload: Record<string, unknown> | string | null;
  tokens_used: number;
  latency_ms: number;
  status: RunestoneStatus;
  created_at: string;
}

export interface ScryingState {
  pipeline: SsPipeline | null;
  nodes: SsNode[];
  edges: SsEdge[];
  liveRunestones: SsRunestone[];
  loading: boolean;
  error: string | null;
  isDemo: boolean;
}
