// CompanionScene.tsx — 2D pixel-art viewport for the companion cat.
// Renders the cat sprite plus an action-feedback particle overlay. The
// backdrop colour shifts with the cat's emotional state so the world
// breathes with the cat — warm when active, cool when focused, muted
// when idle, ashen when fatigued/neglected, amber when concerned. The
// gradient structure stays constant; only the hue stops change so the
// transition feels like atmosphere, not a hard cut.

import { PixelCat }        from './PixelCat';
import { ParticleOverlay } from './ParticleOverlay';
import type { CompanionState } from '@/state/companionMachine';

interface CompanionSceneProps {
  state:     CompanionState;
  /** Most recent effect type, e.g. 'feed' / 'pet'. Empty string disables. */
  effect:    string;
  /** Counter the parent bumps to retrigger the same effect. */
  effectKey: number;
  /** Forwarded to PixelCat so the click hit-test happens on opaque pixels
      only, not on the entire viewport rectangle. */
  onCatClick?: () => void;
}

interface ScenePalette {
  backdrop: string;
  wall:     string;
  floor:    string;
  accent:   string;
  glow:     string;
  window:   string;
}

const STATE_SCENES: Record<CompanionState, ScenePalette> = {
  active: {
    backdrop: 'linear-gradient(180deg, #221b14 0%, #111015 58%, #090706 100%)',
    wall:     'rgba(126, 85, 47, .24)',
    floor:    'rgba(37, 27, 19, .92)',
    accent:   '#f2b35c',
    glow:     'rgba(242,179,92,.24)',
    window:   '#98d8d4',
  },
  focus: {
    backdrop: 'linear-gradient(180deg, #122329 0%, #0b1419 58%, #04090c 100%)',
    wall:     'rgba(56, 124, 132, .20)',
    floor:    'rgba(9, 22, 26, .94)',
    accent:   '#67e8f9',
    glow:     'rgba(103,232,249,.18)',
    window:   '#c7f9ff',
  },
  idle: {
    backdrop: 'linear-gradient(180deg, #1b1a29 0%, #0d0d18 58%, #05050a 100%)',
    wall:     'rgba(104, 93, 154, .19)',
    floor:    'rgba(15, 14, 29, .94)',
    accent:   '#a78bfa',
    glow:     'rgba(167,139,250,.18)',
    window:   '#c4b5fd',
  },
  fatigue: {
    backdrop: 'linear-gradient(180deg, #242320 0%, #10100f 58%, #050505 100%)',
    wall:     'rgba(118, 116, 108, .14)',
    floor:    'rgba(17, 16, 15, .95)',
    accent:   '#c9b896',
    glow:     'rgba(201,184,150,.12)',
    window:   '#b7c0c7',
  },
  neglected: {
    backdrop: 'linear-gradient(180deg, #1b1a18 0%, #0b0b0a 58%, #020202 100%)',
    wall:     'rgba(104, 97, 82, .11)',
    floor:    'rgba(8, 8, 7, .96)',
    accent:   '#a59a83',
    glow:     'rgba(165,154,131,.10)',
    window:   '#8c96a0',
  },
  concerned: {
    backdrop: 'linear-gradient(180deg, #261c14 0%, #140e08 58%, #080504 100%)',
    wall:     'rgba(159, 94, 43, .20)',
    floor:    'rgba(30, 18, 10, .95)',
    accent:   '#f59e0b',
    glow:     'rgba(245,158,11,.20)',
    window:   '#ffd27a',
  },
};

export function CompanionScene({ state, effect, effectKey, onCatClick }: CompanionSceneProps) {
  const scene = STATE_SCENES[state] ?? STATE_SCENES.idle;
  const catClickProps = onCatClick ? { onClick: onCatClick } : {};

  return (
    <div
      style={{
        width:    '100%',
        height:   '100%',
        position: 'relative',
        overflow: 'hidden',
        background: scene.backdrop,
        transition: 'background 1.2s var(--ease, ease)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(circle at 50% 53%, ${scene.glow} 0%, transparent 27%),
            linear-gradient(180deg, transparent 0%, transparent 55%, ${scene.floor} 55%, ${scene.floor} 100%)
          `,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          top: '10%',
          height: '52%',
          border: `1px solid color-mix(in oklab, ${scene.accent} 24%, transparent)`,
          borderBottomColor: 'rgba(255,255,255,.04)',
          borderRadius: 10,
          background: `
            linear-gradient(135deg, ${scene.wall}, transparent 70%),
            repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 42px)
          `,
          boxShadow: `0 0 42px ${scene.glow} inset`,
          opacity: 0.88,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '12%',
          top: '15%',
          width: 92,
          height: 116,
          borderRadius: 8,
          border: `1px solid color-mix(in oklab, ${scene.window} 40%, transparent)`,
          background: `
            linear-gradient(90deg, transparent 48%, rgba(255,255,255,.22) 49%, rgba(255,255,255,.22) 51%, transparent 52%),
            linear-gradient(180deg, transparent 48%, rgba(255,255,255,.18) 49%, rgba(255,255,255,.18) 51%, transparent 52%),
            radial-gradient(circle at 50% 42%, color-mix(in oklab, ${scene.window} 72%, white 28%), ${scene.window} 42%, rgba(0,0,0,.22) 100%)
          `,
          boxShadow: `0 0 28px color-mix(in oklab, ${scene.window} 35%, transparent)`,
          opacity: 0.62,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: '12%',
          top: '22%',
          width: 132,
          height: 10,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent, color-mix(in oklab, ${scene.accent} 42%, #1b120a 58%), transparent)`,
          boxShadow: `0 12px 24px ${scene.glow}`,
          opacity: 0.74,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '13%',
          width: '38%',
          minWidth: 240,
          maxWidth: 460,
          height: 74,
          transform: 'translateX(-50%) perspective(380px) rotateX(56deg)',
          borderRadius: '50%',
          background: `
            radial-gradient(ellipse at 50% 45%, color-mix(in oklab, ${scene.accent} 22%, transparent), transparent 62%),
            repeating-radial-gradient(ellipse at 50% 50%, rgba(255,255,255,.08) 0 2px, transparent 2px 14px)
          `,
          border: `1px solid color-mix(in oklab, ${scene.accent} 28%, transparent)`,
          opacity: 0.78,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: '55% 0 0',
          background: `
            repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 48px),
            repeating-linear-gradient(0deg, rgba(255,255,255,.028) 0 1px, transparent 1px 44px)
          `,
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.08))',
        }}
      />
      <PixelCat state={state} {...catClickProps} />
      <ParticleOverlay effect={effect} effectKey={effectKey} />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 48%, transparent 48%, rgba(0,0,0,.38) 100%)',
        }}
      />
    </div>
  );
}
