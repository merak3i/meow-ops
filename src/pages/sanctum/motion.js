export const EASE_ARCANE_OUT = 'cubic-bezier(0.16, 1, 0.30, 1)';
export const EASE_ANTICIPATE = 'cubic-bezier(0.36, 0, 0.66, -0.42)';
export const EASE_SETTLE = 'cubic-bezier(0.22, 1.36, 0.36, 1)';

export const PHASE_STEP = 2.39996;
export const TURN_DURATION = 0.08;
export const START_DURATION = 0.12;
export const SETTLE_DURATION = 0.15;

export function stepPeriodForSpeed(speed) {
  return Math.max(0.16, Math.min(0.9, 0.55 / Math.max(0.1, speed)));
}

export function nextWalkFrame(frame) {
  return (frame + 1) % 4;
}
