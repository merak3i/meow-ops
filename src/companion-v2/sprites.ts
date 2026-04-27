// sprites.ts — Hand-coded 32×32 pixel art for the 2D companion cat.
// Each sprite is a row-major array of 32 strings, each exactly 32 chars wide.
// Characters are mapped to PALETTE indices via CHAR_MAP. Unknown chars are
// transparent.
//
// Phase 2: each state holds an eye-band animation track (multiple frames with
// per-frame durations). The renderer picks a frame based on elapsed time.

import type { CompanionState } from '@/state/companionMachine';

// ─── Palette ──────────────────────────────────────────────────────────────────
// Index 0 = transparent. Indices 1+ = CSS color strings.
export const PALETTE: readonly string[] = [
  'transparent',
  '#1a0d05', // 1 outline (near-black brown)
  '#d88846', // 2 fur main (orange tabby)
  '#8a4d22', // 3 fur shadow (dark brown)
  '#f0c890', // 4 fur highlight (tan)
  '#faecd0', // 5 chest cream
  '#f59999', // 6 pink (nose, inner ear)
  '#bce070', // 7 eye iris (yellow-green)
  '#0a0500', // 8 pupil / closed eye (black)
  '#888888', // 9 whisker grey
  '#62a8e8', // 10 sad blue glint (concerned state)
] as const;

const CHAR_MAP: Record<string, number> = {
  o: 1, F: 2, D: 3, L: 4, C: 5, P: 6, E: 7, K: 8, W: 9, S: 10,
};

// ─── Sprite type and helpers ──────────────────────────────────────────────────

export type Sprite = readonly string[];

export const SPRITE_SIZE = 32;

/** Resolve a single character to a palette index (0 if unknown). */
export function charToPaletteIndex(ch: string): number {
  return CHAR_MAP[ch] ?? 0;
}

/** Geometry of the cat sprite within a container of size (cw × ch).
 *  Block-pixel size is the largest integer that lets the sprite fit at
 *  ~78% of the smaller container axis — keeps pixel edges on device-pixel
 *  boundaries. Shared by PixelCat (cat draw) and ParticleOverlay (particle
 *  positioning), so particles always line up with the cat. */
export interface CatLayout {
  blockPx: number;
  drawnW:  number;
  drawnH:  number;
  offsetX: number;
  offsetY: number;
}

export function computeCatLayout(cw: number, ch: number): CatLayout {
  const targetFraction = 0.78;
  const blockPx = Math.max(
    2,
    Math.floor((Math.min(cw, ch) * targetFraction) / SPRITE_SIZE),
  );
  const drawnW = SPRITE_SIZE * blockPx;
  const drawnH = SPRITE_SIZE * blockPx;
  return {
    blockPx,
    drawnW,
    drawnH,
    offsetX: Math.floor((cw - drawnW) / 2),
    offsetY: Math.floor((ch - drawnH) / 2),
  };
}

// ─── Base sitting cat (used for all 6 sitting states) ────────────────────────
// Front-facing, sitting upright. Per-state overrides:
//   • rows 1–4  (ears)  — picked from EARS_BY_STATE
//   • rows 9, 10 (eyes) — picked from the state's eye-frame track
//   • row 13   (mouth)  — picked from the state's eye-frame track
// Rows 5–8 (head/forehead/brow) and 14–31 (body/legs) stay upright across all
// states — keeps the cat consistently cute even when sad (decision Q3=c).
//
// Column ruler — counts from 0:
//                    1111111111222222222233
//          01234567890123456789012345678901
const BASE_BODY: Sprite = [
  '................................', //  0
  '......ooo..............ooo......', //  1  ear tips         (overridden)
  '.....oFFFo............oFFFo.....', //  2  ears widening    (overridden)
  '.....oFPFo............oFPFo.....', //  3  pink inner ear   (overridden)
  '....oFPFFo............oFFPFo....', //  4  ears widest      (overridden)
  '....oFFFFFooooooooooooFFFFFo....', //  5  head crown
  '...oFFLLFFFFFFFFFFFFFFFFLLFFo...', //  6  forehead with light streaks
  '...oFLLLFFFFFFFFFFFFFFFFLLLFo...', //  7  brow
  '...oFFLLFFFFFFFFFFFFFFFFFLLFo...', //  8  upper face
  '...oFFFFFF..eyes-row-replaced..o', //  9  EYES (overridden per frame)
  '...oFFFFFF..eyes-row-replaced..o', // 10  EYES (overridden per frame)
  '....oFFFFFFFFFFPPFFFFFFFFFFo....', // 11  nose top
  '....oFFFFFFFFFFPPFFFFFFFFFFo....', // 12  nose
  '....oFFFFFFFFooooFFFFFFFFFFo....', // 13  mouth (overridden per frame)
  '....oFFFFFFFFFFFFFFFFFFFFFFo....', // 14  jaw
  '.....oFFFFFFFFFFFFFFFFFFFFo.....', // 15  neck
  '.....oFFFFFFFFFFFFFFFFFFFo......', // 16  neck taper
  '......oFFFFFFFFFFFFFFFFFo.......', // 17  shoulder line
  '......oCCCCCCCCCCCCCCCFFo.......', // 18  chest cream begins
  '.....oCCCCCCCCCCCCCCCCCFFo......', // 19  body widens
  '....oCCCCCCCCCCCCCCCCCCCFFo.....', // 20
  '...oCCCCCCCCCCCCCCCCCCCCFFo.....', // 21
  '...oCCCCCCCCCCCCCCCCCCCCCFFo....', // 22  tail beginning right side
  '...oCCCCCCCCCCCCCCCCCCCCCCFFo...', // 23  tail curl
  '...oCCCCCCCCCCCCCCCCCCCCCCCFFFo.', // 24  tail extends
  '...oCCCCCCCCCCCCCCCCCCCCCCCCCFFo', // 25  tail tip
  '...oFCCCCCCCCCCCCCCCCCCCCCCCFFFo', // 26  body lower
  '...oFFCCCCCCCCCCCCCCCCCCCCCFFFo.', // 27  body bottom
  '...oFFoooFFCCCCCFCCCCFFoooFCCFo.', // 28  legs gap
  '...oFFoDDoFFCCCFFCCFFoDDoFFCFo..', // 29  paws darker
  '....oooooooFFCCCFFooooooooFFo...', // 30  ground line
  '...........oooooo...........o...', // 31  base
] as const;

// ─── Eye/mouth band animation tracks ──────────────────────────────────────────
// Each frame overrides rows 9, 10, 13 of BASE_BODY. Per-state durations control
// pacing — energetic states cycle fast, sad states cycle slow.

interface EyeFrame {
  row9: string;
  row10: string;
  row13: string;
  durationMs: number;
}

// Reusable rows.
const ROW9_CLOSED   = '...oFFFFFFFFFFFFFFFFFFFFFFFFFo..';
const ROW13_MOUTH_S = '....oFFFFFFFFFFooooFFFFFFFFFo...'; // small closed mouth
const ROW13_MOUTH_O = '....oFFFFFFFFFooooooFFFFFFFFo...'; // open mouth (yawn / pant)
const ROW13_MOUTH_T = '....oFFFFFFFFooFFFooooFFFFFFo...'; // tense / fatigue mouth
const ROW13_MOUTH_W = '....oFFFFFFFFFFooFFFFFFFFFFFo...'; // worried tight mouth

// ── ACTIVE: lively pant — alternating mouth, occasional blink ──
const ACTIVE_FRAMES: readonly EyeFrame[] = [
  {
    row9:  '...oFFFFFFFEEEFFFFFFEEEFFFFFFo..',
    row10: '...oFFFFFFFEKKEFFFFFEKKEFFFFFo..',
    row13: ROW13_MOUTH_S,
    durationMs: 500,
  },
  {
    row9:  '...oFFFFFFFEEEFFFFFFEEEFFFFFFo..',
    row10: '...oFFFFFFFEKKEFFFFFEKKEFFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 500,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFooooFFFFFooooFFFFFo..',
    row13: ROW13_MOUTH_S,
    durationMs: 100,
  },
];

// ── IDLE: calm, periodic blink ──
const IDLE_FRAMES: readonly EyeFrame[] = [
  {
    row9:  '...oFFFFFFFFEEFFFFFFFFEEFFFFFFo.',
    row10: '...oFFFFFFFFKKFFFFFFFFKKFFFFFFo.',
    row13: ROW13_MOUTH_S,
    durationMs: 2400,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFFooFFFFFFFFooFFFFFFo.',
    row13: ROW13_MOUTH_S,
    durationMs: 130,
  },
  {
    row9:  '...oFFFFFFFFEEFFFFFFFFEEFFFFFFo.',
    row10: '...oFFFFFFFFKKFFFFFFFFKKFFFFFFo.',
    row13: ROW13_MOUTH_S,
    durationMs: 1600,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFFooFFFFFFFFooFFFFFFo.',
    row13: ROW13_MOUTH_S,
    durationMs: 90,
  },
];

// ── FOCUS: concentration with pupil darts ──
const FOCUS_FRAMES: readonly EyeFrame[] = [
  {
    row9:  '...oFFFFFFFKKKFFFFFKKKFFFFFFFo..',
    row10: '...oFFFFFFFEKKEFFFEKKEFFFFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 1600,
  },
  {
    row9:  '...oFFFFFFKKKFFFFFKKKFFFFFFFFo..',
    row10: '...oFFFFFFEKKEFFFEKKEFFFFFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 200,
  },
  {
    row9:  '...oFFFFFFFKKKFFFFFKKKFFFFFFFo..',
    row10: '...oFFFFFFFEKKEFFFEKKEFFFFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 1100,
  },
  {
    row9:  '...oFFFFFFFFKKKFFFFFKKKFFFFFFo..',
    row10: '...oFFFFFFFFEKKEFFFEKKEFFFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 200,
  },
];

// ── FATIGUE: drowsy, slow yawns ──
const FATIGUE_FRAMES: readonly EyeFrame[] = [
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFKKKKFFFFFFKKKKFFFFo..',
    row13: ROW13_MOUTH_T,
    durationMs: 1800,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFKKKKFFFFFFKKKKFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 700,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFKKKKFFFFFFKKKKFFFFo..',
    row13: ROW13_MOUTH_T,
    durationMs: 1400,
  },
];

// ── NEGLECTED: sad and very still, rare peek with blue glint ──
const NEGLECTED_FRAMES: readonly EyeFrame[] = [
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFKKKKFFFFFFKKKKFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 4000,
  },
  {
    row9:  '...oFFFFFFFFSSFFFFFFFFSSFFFFFFo.',
    row10: '...oFFFFFFFFKKFFFFFFFFKKFFFFFFo.',
    row13: ROW13_MOUTH_O,
    durationMs: 250,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFKKKKFFFFFFKKKKFFFFo..',
    row13: ROW13_MOUTH_O,
    durationMs: 3500,
  },
];

// ── CONCERNED: worried with blue glint, rare blink ──
const CONCERNED_FRAMES: readonly EyeFrame[] = [
  {
    row9:  '...oFFFFFFFEEEFFFFFFFEEEFFFFFo..',
    row10: '...oFFFFFFFEKSEFFFFFEKSEFFFFFo..',
    row13: ROW13_MOUTH_W,
    durationMs: 1500,
  },
  {
    row9:  ROW9_CLOSED,
    row10: '...oFFFFFFFoooFFFFFFFoooFFFFFo..',
    row13: ROW13_MOUTH_W,
    durationMs: 130,
  },
  {
    row9:  '...oFFFFFFFEEEFFFFFFFEEEFFFFFo..',
    row10: '...oFFFFFFFEKSEFFFFFEKSEFFFFFo..',
    row13: ROW13_MOUTH_W,
    durationMs: 1300,
  },
];

const FRAMES_BY_STATE: Record<CompanionState, readonly EyeFrame[]> = {
  active:    ACTIVE_FRAMES,
  idle:      IDLE_FRAMES,
  focus:     FOCUS_FRAMES,
  fatigue:   FATIGUE_FRAMES,
  neglected: NEGLECTED_FRAMES,
  concerned: CONCERNED_FRAMES,
};

// ─── Ear variants per state ───────────────────────────────────────────────────
// Posture cue: ears change shape per state to make state legible at a glance.
// Each variant is a 4-row tuple covering rows 1–4 of the sprite. Body stays
// upright across all states (decision Q3=c) so the cat reads "still cute" in
// fatigue/neglected — the ears do the emotional work.

type EarVariant = readonly [string, string, string, string];

// Tall, pointy ears — energetic baseline.
const EARS_ALERT: EarVariant = [
  '......ooo..............ooo......',
  '.....oFFFo............oFFFo.....',
  '.....oFPFo............oFPFo.....',
  '....oFPFFo............oFFPFo....',
];

// Tips shift one column toward center — alert, leaning-in posture.
const EARS_FORWARD: EarVariant = [
  '.......oo..............oo.......',
  '.....oFFFo............oFFFo.....',
  '.....oFPFo............oFPFo.....',
  '....oFPFFo............oFFPFo....',
];

// One row shorter from the top — natural resting cat ears.
const EARS_RELAXED: EarVariant = [
  '................................',
  '......ooo..............ooo......',
  '.....oFPFo............oFPFo.....',
  '....oFPFFo............oFFPFo....',
];

// No tips, flopped one column outward — drowsy, heavy ears.
const EARS_DROOP: EarVariant = [
  '................................',
  '................................',
  '....oFFFFo............oFFFFo....',
  '...oFFPFFo............oFFPFFo...',
];

// Tips lower and smaller — pulled back from worry.
const EARS_HALF_BACK: EarVariant = [
  '................................',
  '................................',
  '......ooo..............ooo......',
  '.....oFFFo............oFFFo.....',
];

// Just outline hints poking above the head — fully pinned back.
const EARS_FLAT_BACK: EarVariant = [
  '................................',
  '................................',
  '................................',
  '......ooo..............ooo......',
];

const EARS_BY_STATE: Record<CompanionState, EarVariant> = {
  active:    EARS_ALERT,
  idle:      EARS_RELAXED,
  focus:     EARS_FORWARD,
  fatigue:   EARS_DROOP,
  neglected: EARS_FLAT_BACK,
  concerned: EARS_HALF_BACK,
};

// ─── Frame picker + sprite composition ────────────────────────────────────────

/** Pick the active eye frame for `state` at `elapsedMs`. Returns frame index
 *  alongside the frame itself, so the renderer can skip redraws when the index
 *  hasn't changed. */
function pickEyeFrame(
  state: CompanionState,
  elapsedMs: number,
): { idx: number; frame: EyeFrame } {
  const frames = FRAMES_BY_STATE[state] ?? IDLE_FRAMES;
  let total = 0;
  for (const f of frames) total += f.durationMs;
  const t = ((elapsedMs % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < frames.length; i++) {
    acc += frames[i]!.durationMs;
    if (t < acc) return { idx: i, frame: frames[i]! };
  }
  return { idx: 0, frame: frames[0]! };
}

/** Compose the full 32-row sprite for `state` at `elapsedMs`. Returns the
 *  current frame index so the renderer can short-circuit on no-change. */
export function spriteForState(
  state: CompanionState,
  elapsedMs = 0,
): { frameIdx: number; sprite: Sprite } {
  const { idx, frame } = pickEyeFrame(state, elapsedMs);
  const ears = EARS_BY_STATE[state] ?? EARS_ALERT;
  const out = BASE_BODY.slice();
  out[1]  = ears[0];
  out[2]  = ears[1];
  out[3]  = ears[2];
  out[4]  = ears[3];
  out[9]  = frame.row9;
  out[10] = frame.row10;
  out[13] = frame.row13;
  return { frameIdx: idx, sprite: out };
}

// ─── Sanity check ─────────────────────────────────────────────────────────────
// Surface sprite-sizing errors early instead of silent half-drawn pixel art.
if (import.meta.env.DEV) {
  const checkRow = (label: string, row: string): void => {
    if (row.length !== SPRITE_SIZE) {
      console.warn(`[sprites] ${label} has ${row.length} chars, expected ${SPRITE_SIZE}: "${row}"`);
    }
  };

  if (BASE_BODY.length !== SPRITE_SIZE) {
    console.warn(`[sprites] BASE_BODY has ${BASE_BODY.length} rows, expected ${SPRITE_SIZE}`);
  }
  BASE_BODY.forEach((row, i) => checkRow(`BASE_BODY[${i}]`, row));

  for (const [state, frames] of Object.entries(FRAMES_BY_STATE)) {
    frames.forEach((f, i) => {
      checkRow(`${state}[${i}].row9`,  f.row9);
      checkRow(`${state}[${i}].row10`, f.row10);
      checkRow(`${state}[${i}].row13`, f.row13);
    });
  }

  for (const [state, ears] of Object.entries(EARS_BY_STATE)) {
    ears.forEach((row, i) => checkRow(`${state}-ears[${i + 1}]`, row));
  }
}
