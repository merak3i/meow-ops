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

const STATE_BACKDROPS: Record<CompanionState, string> = {
  active:    'radial-gradient(ellipse at 50% 35%, #2a2218 0%, #16110a 70%, #0a0805 100%)', // warm orange
  focus:     'radial-gradient(ellipse at 50% 35%, #182228 0%, #0a1116 70%, #04090c 100%)', // cool teal
  idle:      'radial-gradient(ellipse at 50% 35%, #1a1a26 0%, #0a0a14 70%, #05050a 100%)', // muted blue
  fatigue:   'radial-gradient(ellipse at 50% 35%, #1c1c1c 0%, #080808 70%, #030303 100%)', // ashen grey
  neglected: 'radial-gradient(ellipse at 50% 35%, #1a1a1a 0%, #050505 70%, #020202 100%)', // deeper ash
  concerned: 'radial-gradient(ellipse at 50% 35%, #261c14 0%, #140e08 70%, #0a0604 100%)', // amber dusk
};

export function CompanionScene({ state, effect, effectKey, onCatClick }: CompanionSceneProps) {
  return (
    <div
      style={{
        width:    '100%',
        height:   '100%',
        position: 'relative',
        background: STATE_BACKDROPS[state] ?? STATE_BACKDROPS.idle,
        transition: 'background 1.2s var(--ease, ease)',
      }}
    >
      <PixelCat state={state} onClick={onCatClick} />
      <ParticleOverlay effect={effect} effectKey={effectKey} />
    </div>
  );
}
