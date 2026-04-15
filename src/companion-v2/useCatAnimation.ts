import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { CompanionState } from '@/state/companionMachine';

// ─── Animation target state ───────────────────────────────────────────────────
// All values are written each frame via useFrame — no React re-renders.

export interface CatAnimTargets {
  breathY:        number;   // y-offset body bob
  breathScaleY:   number;   // y-scale for chest expansion
  bodyRoll:       number;   // z-rotation of whole body (idle sway)
  bodyY:          number;   // postural y-offset (slump in fatigue/neglected)
  headTilt:       number;   // head z-rotation (curious tilt for concerned)
  tailBaseAngle:  number;   // rotation.z of tail root
  tailTipAngle:   number;   // secondary rotation.z of mid-tail
  earLAngle:      number;   // rotation.x of left ear (forward+)
  earRAngle:      number;   // rotation.x of right ear
  eyeOpenness:    number;   // 1=open, 0=closed (eyelid scale.y)
  pupilScale:     number;   // iris/pupil scale (dilates on pet)
  pawLiftL:       number;   // 0–1 front-left paw raise
  pawLiftR:       number;   // 0–1 front-right paw raise
  furMuting:      number;   // 0=vibrant, 1=desaturated toward grey (neglected)
}

// ─── Per-state config ─────────────────────────────────────────────────────────

interface StateConfig {
  breathHz:       number;
  breathAmp:      number;
  bodyRollAmp:    number;
  tailSwayHz:     number;
  tailSwayAmp:    number;
  tailBaseOffset: number;
  earAngle:       number;
  earAsymmetry:   number;   // 'concerned': one ear tilts back
  eyeOpenness:    number;
  pupilScale:     number;
  bodySag:        number;   // postural Y-drop (0 = upright, 0.15 = heavy slump)
  headTilt:       number;   // head z-rotation in radians (curious tilt)
  furMuting:      number;   // 0 = saturated, 1 = desaturated (sadness signal)
}

const STATE_CONFIG: Record<string, StateConfig> = {
  idle: {
    breathHz: 0.40, breathAmp: 0.010, bodyRollAmp: 0.018,
    tailSwayHz: 0.30, tailSwayAmp: 0.22, tailBaseOffset: 0.05,
    earAngle: 0.00, earAsymmetry: 0, eyeOpenness: 0.92, pupilScale: 0.80,
    bodySag: 0.00, headTilt: 0.00, furMuting: 0.00,
  },
  active: {
    breathHz: 0.90, breathAmp: 0.009, bodyRollAmp: 0.008,
    tailSwayHz: 0.80, tailSwayAmp: 0.32, tailBaseOffset: 0.12,
    earAngle: 0.18, earAsymmetry: 0, eyeOpenness: 1.00, pupilScale: 0.75,
    bodySag: -0.02, headTilt: 0.00, furMuting: 0.00,   // perked, slight lift
  },
  focus: {
    breathHz: 0.28, breathAmp: 0.006, bodyRollAmp: 0.004,
    tailSwayHz: 0.12, tailSwayAmp: 0.07, tailBaseOffset: -0.18,
    earAngle: 0.06, earAsymmetry: 0, eyeOpenness: 0.62, pupilScale: 0.60,
    bodySag: 0.00, headTilt: 0.00, furMuting: 0.00,
  },
  fatigue: {
    breathHz: 0.50, breathAmp: 0.017, bodyRollAmp: 0.025,
    tailSwayHz: 0.15, tailSwayAmp: 0.10, tailBaseOffset: -0.30,
    earAngle: -0.28, earAsymmetry: 0, eyeOpenness: 0.44, pupilScale: 0.70,
    bodySag: 0.07, headTilt: -0.05, furMuting: 0.15,    // slumps + slight head droop
  },
  neglected: {
    breathHz: 0.24, breathAmp: 0.021, bodyRollAmp: 0.030,
    tailSwayHz: 0.06, tailSwayAmp: 0.05, tailBaseOffset: -0.42,
    earAngle: -0.38, earAsymmetry: 0, eyeOpenness: 0.32, pupilScale: 0.65,
    bodySag: 0.13, headTilt: -0.10, furMuting: 0.42,    // heavy slump, matted look
  },
  concerned: {
    breathHz: 0.60, breathAmp: 0.013, bodyRollAmp: 0.012,
    tailSwayHz: 0.50, tailSwayAmp: 0.16, tailBaseOffset: 0.00,
    earAngle: -0.05, earAsymmetry: 0.38, eyeOpenness: 0.88, pupilScale: 0.85,
    bodySag: 0.00, headTilt: 0.22, furMuting: 0.00,     // signature curious head tilt
  },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCatAnimation(
  state: CompanionState,
  petSignalRef: React.MutableRefObject<boolean>,
): React.MutableRefObject<CatAnimTargets> {
  const targets = useRef<CatAnimTargets>({
    breathY: 0, breathScaleY: 1, bodyRoll: 0,
    bodyY: 0, headTilt: 0,
    tailBaseAngle: 0, tailTipAngle: 0,
    earLAngle: 0, earRAngle: 0,
    eyeOpenness: 1, pupilScale: 0.8,
    pawLiftL: 0, pawLiftR: 0,
    furMuting: 0,
  });

  // Smoothed postural targets — crossfade between states over ~1.2s
  const bodySagSm   = useRef(0);
  const headTiltSm  = useRef(0);
  const furMuteSm   = useRef(0);

  // Blink state
  const blinkTimer    = useRef(2 + Math.random() * 4);
  const blinkPhase    = useRef<'open' | 'closing' | 'opening'>('open');
  const blinkProgress = useRef(0);

  // Ear twitch state
  const earTimer    = useRef(5 + Math.random() * 8);
  const earSide     = useRef<0 | 1>(0);
  const earImpulse  = useRef(0);

  // Pet paw lift
  const petProgress = useRef(0);
  const petSide     = useRef<0 | 1>(0);

  useFrame((_, delta) => {
    const cfg = STATE_CONFIG[state] ?? STATE_CONFIG['idle']!;
    const tgt = targets.current;

    // Global elapsed — use clock from fiber
    const t = performance.now() / 1000;

    // ── Postural crossfade — smooth state transitions (≈1.2s half-life) ────
    const k = 1 - Math.exp(-delta * 1.8);
    bodySagSm.current  += (cfg.bodySag    - bodySagSm.current)  * k;
    headTiltSm.current += (cfg.headTilt   - headTiltSm.current) * k;
    furMuteSm.current  += (cfg.furMuting  - furMuteSm.current)  * k;

    // ── Breathing ──────────────────────────────────────────────────────────
    const breath = Math.sin(t * cfg.breathHz * Math.PI * 2);
    tgt.breathY      = breath * cfg.breathAmp;
    tgt.breathScaleY = 1 + breath * cfg.breathAmp * 0.6;
    tgt.bodyRoll     = Math.sin(t * cfg.breathHz * Math.PI * 2 * 0.7) * cfg.bodyRollAmp;
    tgt.bodyY        = -bodySagSm.current;
    tgt.headTilt     = headTiltSm.current;
    tgt.furMuting    = furMuteSm.current;

    // ── Tail ───────────────────────────────────────────────────────────────
    const tailSway     = Math.sin(t * cfg.tailSwayHz * Math.PI * 2);
    tgt.tailBaseAngle  = cfg.tailBaseOffset + tailSway * cfg.tailSwayAmp;
    tgt.tailTipAngle   = Math.sin(t * cfg.tailSwayHz * Math.PI * 2 * 1.4 + 0.8) * cfg.tailSwayAmp * 0.45;

    // ── Ears ───────────────────────────────────────────────────────────────
    tgt.earLAngle = cfg.earAngle + cfg.earAsymmetry * 0.5;
    tgt.earRAngle = cfg.earAngle - cfg.earAsymmetry * 0.5;

    earTimer.current -= delta;
    if (earTimer.current <= 0) {
      earTimer.current = 5 + Math.random() * 9;
      earSide.current  = Math.random() > 0.5 ? 1 : 0;
      earImpulse.current = 1;
    }
    if (earImpulse.current > 0) {
      earImpulse.current = Math.max(0, earImpulse.current - delta * 6);
      const twitch = Math.sin(earImpulse.current * Math.PI) * 0.38;
      if (earSide.current === 0) tgt.earLAngle += twitch;
      else tgt.earRAngle += twitch;
    }

    // ── Blink ──────────────────────────────────────────────────────────────
    blinkTimer.current -= delta;
    if (blinkTimer.current <= 0 && blinkPhase.current === 'open') {
      blinkTimer.current = 2.5 + Math.random() * 4;
      blinkPhase.current = 'closing';
      blinkProgress.current = 0;
    }
    if (blinkPhase.current === 'closing') {
      blinkProgress.current += delta / 0.10;
      if (blinkProgress.current >= 1) { blinkProgress.current = 1; blinkPhase.current = 'opening'; }
    } else if (blinkPhase.current === 'opening') {
      blinkProgress.current -= delta / 0.08;
      if (blinkProgress.current <= 0) { blinkProgress.current = 0; blinkPhase.current = 'open'; }
    }
    const blinkClose = blinkPhase.current !== 'open' ? blinkProgress.current * 0.95 : 0;
    tgt.eyeOpenness  = Math.max(0.02, cfg.eyeOpenness * (1 - blinkClose));
    tgt.pupilScale   = cfg.pupilScale;

    // ── Pet paw lift ───────────────────────────────────────────────────────
    if (petSignalRef.current) {
      petSignalRef.current  = false;
      petProgress.current   = 1;
      petSide.current       = Math.random() > 0.5 ? 1 : 0;
    }
    if (petProgress.current > 0) {
      petProgress.current = Math.max(0, petProgress.current - delta * 2.8);
      const lift = Math.sin(petProgress.current * Math.PI);
      tgt.pawLiftL = petSide.current === 0 ? lift : 0;
      tgt.pawLiftR = petSide.current === 1 ? lift : 0;
    } else {
      tgt.pawLiftL = 0;
      tgt.pawLiftR = 0;
    }
  });

  return targets;
}
