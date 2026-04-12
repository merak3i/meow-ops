import { useMemo } from 'react';
import {
  buildLeyLinePath,
  EDGE_COLOR,
  EDGE_OPACITY,
} from './championsConfig';
import { Runestone } from './Runestone';
import type { SsEdge, SsNode, SsRunestone } from './types';

interface Props {
  edge: SsEdge;
  source: SsNode;
  target: SsNode;
  activeRunestones: SsRunestone[];
  onRunestoneArrive: (id: string) => void;
  onRunestoneClick: (r: SsRunestone) => void;
}

export function LeyLine({
  edge, source, target,
  activeRunestones, onRunestoneArrive, onRunestoneClick,
}: Props) {
  const pathD = useMemo(
    () => buildLeyLinePath(source.position_x, source.position_y, target.position_x, target.position_y),
    [source.position_x, source.position_y, target.position_x, target.position_y],
  );

  const color   = EDGE_COLOR[edge.status];
  const opacity = EDGE_OPACITY[edge.status];

  // Background (dim) track — always visible
  const trackClass = edge.status === 'healthy' ? 'ley-line-healthy'
                   : edge.status === 'choked'  ? 'ley-line-choked'
                   : 'ley-line-severed';

  const strokeWidth = edge.status === 'severed' ? 1.5 : 2;

  return (
    <g>
      {/* Static dim underline — gives depth */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth + 3}
        opacity={0.06}
        strokeLinecap="round"
      />

      {/* Primary Ley Line with flow animation */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        strokeLinecap="round"
        className={trackClass}
        style={{
          filter: edge.status === 'healthy'
            ? `drop-shadow(0 0 4px ${color}88)`
            : undefined,
        }}
      />

      {/* Severed indicator — static red X at midpoint */}
      {edge.status === 'severed' && <SeveredMarker pathD={pathD} />}

      {/* Active runestones traversing this ley line */}
      {activeRunestones.map(r => (
        <Runestone
          key={r.id}
          runestone={r}
          pathD={pathD}
          onArrive={onRunestoneArrive}
          onClick={onRunestoneClick}
        />
      ))}
    </g>
  );
}

function SeveredMarker({ pathD }: { pathD: string }) {
  // Render a small "severed" sigil at ~50% along the path
  const ref = (el: SVGPathElement | null) => {
    if (!el) return;
    const len = el.getTotalLength();
    const pt  = el.getPointAtLength(len * 0.5);
    const g   = el.nextElementSibling as SVGGElement | null;
    if (g) {
      g.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
      g.style.display = 'block';
    }
  };

  return (
    <>
      <path ref={ref} d={pathD} fill="none" stroke="none" />
      <g style={{ display: 'none' }}>
        <circle r={8} fill="#0e0f14" stroke="#ff4a4a" strokeWidth={1} opacity={0.9} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fill="#ff4a4a"
          fontFamily="monospace"
          style={{ userSelect: 'none' }}
        >✕</text>
      </g>
    </>
  );
}
