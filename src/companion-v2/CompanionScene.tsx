// CompanionScene.tsx — 2D pixel-art viewport for the companion cat.
// Renders the cat sprite plus an action-feedback particle overlay.

import { PixelCat }        from './PixelCat';
import { ParticleOverlay } from './ParticleOverlay';
import type { CompanionState } from '@/state/companionMachine';

interface CompanionSceneProps {
  state:     CompanionState;
  /** Most recent effect type, e.g. 'feed' / 'pet'. Empty string disables. */
  effect:    string;
  /** Counter the parent bumps to retrigger the same effect. */
  effectKey: number;
}

export function CompanionScene({ state, effect, effectKey }: CompanionSceneProps) {
  return (
    <div
      style={{
        width:    '100%',
        height:   '100%',
        position: 'relative',
        // Soft vertical gradient backdrop so the sprite has depth without art assets.
        background:
          'radial-gradient(ellipse at 50% 35%, #2a2218 0%, #16110a 70%, #0a0805 100%)',
      }}
    >
      <PixelCat state={state} />
      <ParticleOverlay effect={effect} effectKey={effectKey} />
    </div>
  );
}
