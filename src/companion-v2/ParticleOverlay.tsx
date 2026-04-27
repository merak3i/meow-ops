// ParticleOverlay.tsx — Canvas overlay that draws action-feedback particles
// above the cat. Reads (effect, effectKey) from CompanionPageV2: each bump
// of effectKey spawns a fresh burst. The renderer runs a single rAF loop
// for physics + draw, keyed off the cat's shared layout helper so particles
// always line up with the cat sprite.

import { useEffect, useRef } from 'react';

import {
  PALETTE,
  charToPaletteIndex,
  computeCatLayout,
} from './sprites';
import {
  spawnBurst,
  type BurstContext,
  type SpawnedParticle,
} from './particles';

interface ParticleOverlayProps {
  /** Most recent effect type, e.g. 'feed', 'pet', 'milestone'. */
  effect: string;
  /** Counter — bump to retrigger. Same effect type with a new key spawns again. */
  effectKey: number;
}

interface OverlayLayout {
  cw: number;
  ch: number;
  blockPx: number;
  offsetY: number;
  drawnH: number;
}

const EMPTY_LAYOUT: OverlayLayout = { cw: 0, ch: 0, blockPx: 0, offsetY: 0, drawnH: 0 };

export function ParticleOverlay({ effect, effectKey }: ParticleOverlayProps) {
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const canvasRef     = useRef<HTMLCanvasElement | null>(null);
  const particlesRef  = useRef<SpawnedParticle[]>([]);
  const layoutRef     = useRef<OverlayLayout>(EMPTY_LAYOUT);
  const lastKeyRef    = useRef<number>(effectKey);

  // Canvas setup + physics/render loop. One effect, runs for the lifetime
  // of the component.
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const measure = (): void => {
      const dpr = window.devicePixelRatio ?? 1;
      const cw  = container.clientWidth;
      const ch  = container.clientHeight;
      if (cw === 0 || ch === 0) return;

      const layout = computeCatLayout(cw, ch);
      layoutRef.current = {
        cw,
        ch,
        blockPx: layout.blockPx,
        offsetY: layout.offsetY,
        drawnH:  layout.drawnH,
      };

      canvas.width  = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      canvas.style.width  = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);

    let rafId  = 0;
    let lastT  = performance.now();

    const tick = (now: number): void => {
      const dt = now - lastT;
      lastT = now;

      const { cw, ch, blockPx } = layoutRef.current;

      // Step physics + drop expired particles.
      const live: SpawnedParticle[] = [];
      for (const p of particlesRef.current) {
        const age = now - p.spawnedAt;
        if (age > p.lifeMs) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.ay) p.vy += p.ay * dt;
        live.push(p);
      }
      particlesRef.current = live;

      // Draw — clear and repaint each tick. Cheap: particle counts are small.
      ctx.clearRect(0, 0, cw, ch);
      for (const p of live) {
        const age = now - p.spawnedAt;
        // Fade in the final 30% of life.
        const fadeStart = p.lifeMs * 0.7;
        const alpha = age > fadeStart
          ? Math.max(0, 1 - (age - fadeStart) / (p.lifeMs - fadeStart))
          : 1;
        ctx.globalAlpha = alpha;
        for (let row = 0; row < p.sprite.length; row++) {
          const r = p.sprite[row];
          if (!r) continue;
          for (let col = 0; col < r.length; col++) {
            const c = r[col];
            if (!c) continue;
            const idx = charToPaletteIndex(c);
            if (idx === 0) continue;
            ctx.fillStyle = PALETTE[idx]!;
            ctx.fillRect(
              p.x + col * blockPx,
              p.y + row * blockPx,
              blockPx,
              blockPx,
            );
          }
        }
      }
      ctx.globalAlpha = 1;

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  // Spawn a burst whenever effectKey changes. A repeated effect with the
  // same key (or empty key) is a no-op — the parent must bump.
  useEffect(() => {
    if (effectKey === lastKeyRef.current) return;
    lastKeyRef.current = effectKey;
    if (!effect) return;

    const { cw, ch, blockPx, offsetY, drawnH } = layoutRef.current;
    if (cw === 0 || blockPx === 0) return; // not measured yet

    const burstCtx: BurstContext = {
      catCenterX: cw / 2,
      catTopY:    offsetY,
      catBottomY: offsetY + drawnH,
      blockPx,
    };
    const burst = spawnBurst(effect, burstCtx, performance.now());
    particlesRef.current.push(...burst);
    void ch; // keep typing happy; ch reserved for future use
  }, [effect, effectKey]);

  return (
    <div
      ref={containerRef}
      style={{
        position:      'absolute',
        inset:         0,
        pointerEvents: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position:       'absolute',
          inset:          0,
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}
