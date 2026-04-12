import { useEffect, useRef } from 'react';
import { RUNESTONE_COLOR, RUNESTONE_GLOW } from './championsConfig';
import type { PayloadType, SsRunestone } from './types';

interface Props {
  runestone: SsRunestone;
  pathD: string;
  onArrive: (id: string) => void;
  onClick: (runestone: SsRunestone) => void;
}

// Ease-in-out cubic — mimics spring deceleration without a dep
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const DURATION_MS: Record<PayloadType, number> = {
  json:  1600,
  text:  2000,
  error: 1200,
};

export function Runestone({ runestone, pathD, onArrive, onClick }: Props) {
  const circleRef = useRef<SVGCircleElement>(null);
  const ghostRef  = useRef<SVGPathElement>(null);
  const rafRef    = useRef<number>(0);

  const color    = RUNESTONE_COLOR[runestone.payload_type];
  const glow     = RUNESTONE_GLOW[runestone.payload_type];
  const duration = DURATION_MS[runestone.payload_type];
  const isError  = runestone.payload_type === 'error';

  useEffect(() => {
    const ghostPath = ghostRef.current;
    const circle    = circleRef.current;
    if (!ghostPath || !circle) return;

    const totalLen  = ghostPath.getTotalLength();
    let startTime   = 0;

    function step(ts: number) {
      if (!startTime) startTime = ts;
      const raw    = Math.min((ts - startTime) / duration, 1);
      const eased  = easeInOutCubic(raw);
      const pt     = ghostPath.getPointAtLength(eased * totalLen);

      circle.setAttribute('cx', String(pt.x));
      circle.setAttribute('cy', String(pt.y));

      if (raw < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        onArrive(runestone.id);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [duration, onArrive, runestone.id]);

  return (
    <g style={{ cursor: 'pointer' }} onClick={() => onClick(runestone)}>
      {/* Invisible ghost path for getPointAtLength — must match the LeyLine path */}
      <path ref={ghostRef} d={pathD} fill="none" stroke="none" />

      {/* Glow halo */}
      <circle
        ref={circleRef}
        r={isError ? 6 : 5}
        fill={color}
        className={isError ? 'runestone-error' : undefined}
        style={{
          filter: `drop-shadow(0 0 6px ${glow}) drop-shadow(0 0 12px ${glow})`,
          pointerEvents: 'all',
        }}
      />
    </g>
  );
}
