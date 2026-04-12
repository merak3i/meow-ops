import * as d3 from 'd3';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_H, CANVAS_W } from './championsConfig';
import { ChampionNode } from './ChampionNode';
import { LeyLine } from './LeyLine';
import { LootBoxModal } from './LootBoxModal';
import './scrying-sanctum.css';
import type { SsNode, SsRunestone } from './types';
import { useScryingData } from './useScryingData';

// SVG filter defs — shared glow filters for nodes and paths
function Defs() {
  return (
    <defs>
      <filter id="ss-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="ss-glow-green" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <radialGradient id="ss-bg-grad" cx="50%" cy="50%" r="70%">
        <stop offset="0%"   stopColor="#111320" />
        <stop offset="100%" stopColor="#0a0b0f" />
      </radialGradient>
    </defs>
  );
}

export default function ScryingSanctum() {
  const {
    pipeline, nodes, edges, liveRunestones,
    loading, error, isDemo, dismissRunestone,
  } = useScryingData();

  const [selectedRunestone, setSelectedRunestone] = useState<SsRunestone | null>(null);

  // D3 zoom/pan
  const svgRef     = useRef<SVGSVGElement>(null);
  const canvasRef  = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg    = d3.select(svgRef.current!);
    const canvas = d3.select(canvasRef.current!);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on('zoom', (e) => canvas.attr('transform', e.transform.toString()));

    svg.call(zoom);

    // Center the default view: nodes span x 100-940, center at x=520 y=250
    const svgEl  = svgRef.current!;
    const { width, height } = svgEl.getBoundingClientRect();
    const tx = width / 2  - (CANVAS_W / 2);
    const ty = height / 2 - (CANVAS_H / 2);
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty));

    return () => { svg.on('.zoom', null); };
  }, []);

  // Map runestones → their edge
  const runestonesPerEdge = useCallback(
    (edgeId: string) => liveRunestones.filter(r => r.edge_id === edgeId),
    [liveRunestones],
  );

  const nodeById = useCallback(
    (id: string) => nodes.find(n => n.id === id),
    [nodes],
  );

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0b0f', color: '#555667', fontFamily: 'monospace', fontSize: 12,
        letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Scrying…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0b0f', color: '#ff4a4a', fontFamily: 'monospace', fontSize: 12 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0b0f', minHeight: 0 }}>
      {/* Header bar */}
      <div className="sanctum-header">
        <span className="sanctum-title">Scrying Sanctum</span>
        {pipeline && (
          <span className="sanctum-pipeline-name">/ {pipeline.name}</span>
        )}
        {isDemo && (
          <span style={{
            fontFamily: 'monospace', fontSize: 9, color: '#555667',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            border: '1px solid #2a2b38', padding: '2px 7px', borderRadius: 4,
          }}>demo</span>
        )}
        {pipeline && (
          <span className={`sanctum-status-pill ${pipeline.status}`}>
            {pipeline.status}
          </span>
        )}
      </div>

      {/* D3 SVG canvas */}
      <svg
        ref={svgRef}
        className="sanctum-svg"
        style={{ flex: 1, display: 'block' }}
      >
        <Defs />

        {/* Background gradient */}
        <rect width="100%" height="100%" fill="url(#ss-bg-grad)" />

        {/* Zoomable / pannable layer */}
        <g ref={canvasRef}>
          {/* Faint grid */}
          <SanctumGrid />

          {/* Ley Lines (edges) — rendered behind nodes */}
          <g>
            {edges.map(edge => {
              const src = nodeById(edge.source_id);
              const tgt = nodeById(edge.target_id);
              if (!src || !tgt) return null;
              return (
                <LeyLine
                  key={edge.id}
                  edge={edge}
                  source={src}
                  target={tgt}
                  activeRunestones={runestonesPerEdge(edge.id)}
                  onRunestoneArrive={dismissRunestone}
                  onRunestoneClick={setSelectedRunestone}
                />
              );
            })}
          </g>

          {/* Champion Nodes */}
          <g>
            {nodes.map(node => (
              <ChampionNode key={node.id} node={node} />
            ))}
          </g>
        </g>
      </svg>

      {/* Loot Box modal */}
      {selectedRunestone && (
        <LootBoxModal
          runestone={selectedRunestone}
          onClose={() => setSelectedRunestone(null)}
        />
      )}

      {/* Legend */}
      <SanctumLegend />
    </div>
  );
}

// Faint grid lines for depth
function SanctumGrid() {
  const lines = [];
  const step  = 60;
  for (let x = 0; x <= CANVAS_W; x += step) {
    lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={CANVAS_H} />);
  }
  for (let y = 0; y <= CANVAS_H; y += step) {
    lines.push(<line key={`h${y}`} x1={0} y1={y} x2={CANVAS_W} y2={y} />);
  }
  return (
    <g stroke="#1a1b24" strokeWidth={0.5}>
      {lines}
    </g>
  );
}

// Bottom legend strip
function SanctumLegend() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 20,
      padding: '8px 20px', borderTop: '1px solid #1e1f2a',
      background: '#0e0f14', flexShrink: 0,
      fontFamily: 'monospace', fontSize: 9, color: '#555667',
      letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>
      {[
        { color: '#4a9eff', label: 'Healthy Ley Line' },
        { color: '#4a9eff33', label: 'Choked Ley Line' },
        { color: '#ff4a4a', label: 'Severed' },
        { color: '#4aff8c', label: 'JSON Runestone' },
        { color: '#4a9eff', label: 'Text Runestone' },
        { color: '#ff4a4a', label: 'Error Runestone' },
      ].map(({ color, label }) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: color, flexShrink: 0,
          }} />
          {label}
        </span>
      ))}
      <span style={{ marginLeft: 'auto' }}>scroll to zoom · drag to pan</span>
    </div>
  );
}

// Named re-export for lazy loading compatibility
export { ScryingSanctum };
