import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ScryingState, SsEdge, SsNode, SsPipeline, SsRunestone } from './types';

// ── Demo data ─────────────────────────────────────────────────────────────────
const DEMO_PIPELINE: SsPipeline = {
  id: 'demo-pipeline',
  tenant_id: 'demo',
  name: 'Primary Sanctum',
  session_id: null,
  status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEMO_NODES: SsNode[] = [
  {
    id: 'n-vanguard',  tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    node_type: 'argent_vanguard',  label: 'Argent Vanguard',
    position_x: 100,  position_y: 250,
    status: 'active', mana_burn: 0.0009, stamina_ms: 112, token_count: 380,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'n-scout',     tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    node_type: 'ebon_blade_scout', label: 'Ebon Blade Scout',
    position_x: 380,  position_y: 250,
    status: 'active', mana_burn: 0.0041, stamina_ms: 1480, token_count: 1620,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'n-archmage',  tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    node_type: 'dalaran_archmage', label: 'Dalaran Archmage',
    position_x: 660,  position_y: 250,
    status: 'active', mana_burn: 0.0223, stamina_ms: 3240, token_count: 8100,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'n-herald',    tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    node_type: 'argent_herald',    label: 'Argent Herald',
    position_x: 940,  position_y: 250,
    status: 'idle',   mana_burn: 0.0003, stamina_ms: 58,  token_count: 140,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
];

const DEMO_EDGES: SsEdge[] = [
  {
    id: 'e-1', tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    source_id: 'n-vanguard', target_id: 'n-scout',
    status: 'healthy', latency_ms: 112,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'e-2', tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    source_id: 'n-scout',    target_id: 'n-archmage',
    status: 'choked',  latency_ms: 1480,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'e-3', tenant_id: 'demo', pipeline_id: 'demo-pipeline',
    source_id: 'n-archmage', target_id: 'n-herald',
    status: 'healthy', latency_ms: 58,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
];

// Cycling schedule: [edgeId, payloadType, intervalMs]
const DEMO_SCHEDULE: Array<['e-1'|'e-2'|'e-3', 'json'|'text'|'error', number]> = [
  ['e-1', 'json',  0],
  ['e-2', 'text',  1800],
  ['e-1', 'json',  3400],
  ['e-3', 'json',  5200],
  ['e-2', 'error', 7000],
  ['e-3', 'text',  8600],
];

const DEMO_PAYLOADS: Record<string, Record<string, unknown>> = {
  'e-1': { event: 'task_received', project: 'patherle', model: 'claude-sonnet-4-6', tokens: 380 },
  'e-2': { research: 'competitor analysis', sources: 14, confidence: 0.87, summary: 'Market gap identified in SME segment' },
  'e-3': { structured_output: true, lead_score: 92, contact: 'anon@example.com', action: 'enqueue_sequence' },
};

function makeRunestone(edgeId: string, type: 'json'|'text'|'error'): SsRunestone {
  return {
    id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenant_id: 'demo',
    pipeline_id: 'demo-pipeline',
    edge_id: edgeId,
    payload_type: type,
    payload: type !== 'error' ? DEMO_PAYLOADS[edgeId] ?? null : { error: 'upstream_timeout', code: 504 },
    tokens_used: type === 'error' ? 0 : Math.floor(Math.random() * 600) + 80,
    latency_ms:  type === 'error' ? 0 : Math.floor(Math.random() * 900) + 120,
    status: 'transit',
    created_at: new Date().toISOString(),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useScryingData(): ScryingState & {
  dismissRunestone: (id: string) => void;
} {
  const [state, setState] = useState<ScryingState>({
    pipeline: null,
    nodes: [],
    edges: [],
    liveRunestones: [],
    loading: true,
    error: null,
    isDemo: false,
  });

  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const demoLoop   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Demo mode ──────────────────────────────────────────────────────────────
  function startDemoMode() {
    setState({
      pipeline: DEMO_PIPELINE,
      nodes: DEMO_NODES,
      edges: DEMO_EDGES,
      liveRunestones: [],
      loading: false,
      error: null,
      isDemo: true,
    });

    // Emit initial burst on schedule, then loop every ~10s
    let offset = 0;
    function emitCycle() {
      DEMO_SCHEDULE.forEach(([edgeId, type, delay]) => {
        const t = setTimeout(() => {
          setState(prev => ({
            ...prev,
            liveRunestones: [...prev.liveRunestones.slice(-15), makeRunestone(edgeId, type)],
          }));
        }, delay + offset);
        demoTimers.current.push(t);
      });
    }

    emitCycle();
    const loopDelay = (DEMO_SCHEDULE[DEMO_SCHEDULE.length - 1][2]) + 2000;
    demoLoop.current = setInterval(emitCycle, loopDelay);
  }

  // ── Supabase mode ──────────────────────────────────────────────────────────
  async function loadFromSupabase() {
    if (!supabase) { startDemoMode(); return; }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { startDemoMode(); return; }

    const [pipelineRes, nodesRes, edgesRes] = await Promise.all([
      supabase.from('ss_pipelines').select('*').order('created_at', { ascending: false }).limit(1),
      supabase.from('ss_nodes').select('*'),
      supabase.from('ss_edges').select('*'),
    ]);

    if (pipelineRes.error || nodesRes.error || edgesRes.error) {
      setState(prev => ({
        ...prev, loading: false,
        error: pipelineRes.error?.message ?? nodesRes.error?.message ?? 'Load failed',
      }));
      return;
    }

    const pipeline = pipelineRes.data?.[0] ?? null;
    setState({
      pipeline,
      nodes: nodesRes.data ?? [],
      edges: edgesRes.data ?? [],
      liveRunestones: [],
      loading: false,
      error: null,
      isDemo: false,
    });

    if (!pipeline) return;

    // Realtime: new runestones
    const rsChan = supabase
      .channel('ss_runestones_insert')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ss_runestones',
        filter: `pipeline_id=eq.${pipeline.id}`,
      }, (payload) => {
        setState(prev => ({
          ...prev,
          liveRunestones: [...prev.liveRunestones.slice(-15), payload.new as SsRunestone],
        }));
      })
      .subscribe();

    // Realtime: node metric updates
    const nodeChan = supabase
      .channel('ss_nodes_update')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'ss_nodes',
        filter: `pipeline_id=eq.${pipeline.id}`,
      }, (payload) => {
        const updated = payload.new as SsNode;
        setState(prev => ({
          ...prev,
          nodes: prev.nodes.map(n => n.id === updated.id ? updated : n),
        }));
      })
      .subscribe();

    // Realtime: edge health changes
    const edgeChan = supabase
      .channel('ss_edges_update')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'ss_edges',
        filter: `pipeline_id=eq.${pipeline.id}`,
      }, (payload) => {
        const updated = payload.new as SsEdge;
        setState(prev => ({
          ...prev,
          edges: prev.edges.map(e => e.id === updated.id ? updated : e),
        }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(rsChan);
      supabase.removeChannel(nodeChan);
      supabase.removeChannel(edgeChan);
    };
  }

  useEffect(() => {
    let cleanup: (() => void) | void;
    loadFromSupabase().then(fn => { cleanup = fn; });

    return () => {
      cleanup?.();
      demoTimers.current.forEach(clearTimeout);
      if (demoLoop.current) clearInterval(demoLoop.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismissRunestone(id: string) {
    setState(prev => ({
      ...prev,
      liveRunestones: prev.liveRunestones.filter(r => r.id !== id),
    }));
  }

  return { ...state, dismissRunestone };
}
