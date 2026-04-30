// Minimap — circular HTML canvas overlay in the bottom-right of the Sanctum
// viewport. Reads live champion positions from livePosMap each frame and
// projects them onto a 110×110 disc for a top-down "where's who" view.
// Selected champion gets a slightly larger dot + a teal selection halo.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import type { PositionedNode } from './types';

export function Minimap({ livePosMap, nodes, selectedId }: {
  livePosMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
  nodes: PositionedNode[];
  selectedId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SIZE = 110;
  const WORLD_R = 13; // world radius to show

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Background
      ctx.fillStyle = 'rgba(4,2,16,0.75)';
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
      ctx.fill();

      // Border ring
      ctx.strokeStyle = '#c8a85533';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Floor circle hint
      ctx.strokeStyle = '#c8a85518';
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, (11 / WORLD_R) * (SIZE / 2 - 4), 0, Math.PI * 2);
      ctx.stroke();

      // Draw character dots
      nodes.forEach((pn) => {
        const pos = livePosMap.current.get(pn.session.session_id);
        if (!pos) return;
        // Isometric projection to 2D: use x and z
        const mx = SIZE / 2 + (pos.x / WORLD_R) * (SIZE / 2 - 6);
        const my = SIZE / 2 + (pos.z / WORLD_R) * (SIZE / 2 - 6);
        const isSel = pn.session.session_id === selectedId;
        const r = isSel ? 3.5 : 2.5;

        ctx.fillStyle = pn.cls.color;
        ctx.globalAlpha = isSel ? 1.0 : 0.7;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();

        if (isSel) {
          ctx.strokeStyle = '#63f7b3';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [livePosMap, nodes, selectedId]);

  return (
    <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{
      position: 'absolute', bottom: 12, right: 12, zIndex: 10,
      width: SIZE, height: SIZE, borderRadius: '50%',
      border: '1px solid #c8a85522', pointerEvents: 'none',
    }} />
  );
}
