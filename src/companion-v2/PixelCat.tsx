// PixelCat.tsx — Renders the hand-coded pixel-art cat sprite to a 2D canvas.
// Pixels are drawn via fillRect with imageSmoothingEnabled = false, so the
// output is crisp at any scale — Mario-overworld feel.
//
// Phase 2: a requestAnimationFrame loop advances the per-state eye-frame
// cycle (blinks, mouth twitches, pupil darts). Redraws fire only when the
// active frame index changes, so the canvas idles cheaply between blinks.

import { useEffect, useRef } from 'react';

import {
  PALETTE,
  charToPaletteIndex,
  computeCatLayout,
  spriteForState,
  type Sprite,
} from './sprites';
import type { CompanionState } from '@/state/companionMachine';

interface PixelCatProps {
  state: CompanionState;
  /** Optional click handler — fires when the user clicks on any opaque pixel. */
  onClick?: () => void;
  /** Soft floor shadow under the cat. Defaults to true. */
  showShadow?: boolean;
}

export function PixelCat({ state, onClick, showShadow = true }: PixelCatProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef    = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Geometry recomputed on resize and reused across rAF ticks.
    let cw = 0, ch = 0;
    let blockPx = 0;
    let drawnW = 0, drawnH = 0;
    let offsetX = 0, offsetY = 0;
    let lastFrameIdx = -1;

    const measure = (): void => {
      const dpr = window.devicePixelRatio ?? 1;
      cw = container.clientWidth;
      ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;

      const layout = computeCatLayout(cw, ch);
      blockPx = layout.blockPx;
      drawnW  = layout.drawnW;
      drawnH  = layout.drawnH;
      offsetX = layout.offsetX;
      offsetY = layout.offsetY;

      canvas.width  = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      canvas.style.width  = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      // Force redraw on next tick after a resize.
      lastFrameIdx = -1;
    };

    const drawSprite = (sprite: Sprite): void => {
      ctx.clearRect(0, 0, cw, ch);

      // Soft elliptical floor shadow so the cat doesn't float.
      if (showShadow) {
        ctx.save();
        const shadowCx = cw / 2;
        const shadowCy = offsetY + drawnH - blockPx * 1.5;
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath();
        ctx.ellipse(shadowCx, shadowCy, drawnW * 0.32, blockPx * 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Paint the sprite, one block per source pixel.
      for (let y = 0; y < sprite.length; y++) {
        const row = sprite[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          if (!c) continue;
          const idx = charToPaletteIndex(c);
          if (idx === 0) continue;
          ctx.fillStyle = PALETTE[idx]!;
          ctx.fillRect(offsetX + x * blockPx, offsetY + y * blockPx, blockPx, blockPx);
        }
      }
    };

    measure();

    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number): void => {
      const elapsedMs = now - startTime;
      const { frameIdx, sprite } = spriteForState(state, elapsedMs);
      if (frameIdx !== lastFrameIdx) {
        lastFrameIdx = frameIdx;
        drawSprite(sprite);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const ro = new ResizeObserver(measure);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [state, showShadow]);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}
