// Minimap — circular HTML canvas overlay in the bottom-right of the Sanctum
// viewport. Reads live champion positions from livePosMap each frame and
// projects them onto a 110×110 disc for a top-down "where's who" view.
// Selected champion gets a slightly larger dot + a teal selection halo.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import type { PositionedNode } from './types';

export function Minimap({ livePosMap, nodes, selectedId, compact = false }: {
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
  nodes: PositionedNode[];
  selectedId: string | null;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = compact ? 76 : 110;
  const WORLD_R = 13; // world radius to show

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, size, size);

      // Background
      ctx.fillStyle = 'rgba(8,18,23,0.82)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();

      // Border ring
      ctx.strokeStyle = '#64e5c266';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Floor circle hint
      ctx.strokeStyle = '#d7a46333';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, (11 / WORLD_R) * (size / 2 - 4), 0, Math.PI * 2);
      ctx.stroke();

      // Draw character dots
      nodes.forEach((pn) => {
        const pos = livePosMap.current.get(pn.session.session_id);
        if (!pos) return;
        // Isometric projection to 2D: use x and z
        const mx = size / 2 + (pos.x / WORLD_R) * (size / 2 - 6);
        const my = size / 2 + (pos.z / WORLD_R) * (size / 2 - 6);
        const isSel = pn.session.session_id === selectedId;
        const r = isSel ? 3.5 : 2.5;

        ctx.fillStyle = pn.cls.color;
        ctx.globalAlpha = isSel ? 1.0 : 0.7;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();

        if (isSel) {
          ctx.strokeStyle = '#64e5c2';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, compact ? 4.5 : 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [livePosMap, nodes, selectedId, size, compact]);

  return (
    <canvas className="sanctum-hud-panel sanctum-hud-round" ref={canvasRef} width={size} height={size} style={{
      position: 'absolute', bottom: 12, right: 12, zIndex: 10,
      width: size, height: size, borderRadius: '50%',
      border: '1px solid #64e5c244', pointerEvents: 'none',
    }} />
  );
}
