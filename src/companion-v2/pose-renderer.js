export const COMPANION_POSES = [
  'sit', 'loaf', 'curl', 'eat', 'pounce', 'play', 'groom', 'stretch', 'desk',
];

const EMPTY_ROW = '.'.repeat(48);

function emptySprite() {
  return Array.from({ length: 48 }, () => EMPTY_ROW.split(''));
}

function scaled48(source) {
  return Array.from({ length: 48 }, (_, y) => (
    Array.from({ length: 48 }, (_, x) => {
      const row = source[Math.min(source.length - 1, Math.floor(y * source.length / 48))] ?? '';
      return row[Math.min(row.length - 1, Math.floor(x * row.length / 48))] ?? '.';
    })
  ));
}

function posePoint(pose, x, y) {
  switch (pose) {
    case 'loaf':
      return [24 + (x - 24) * 1.08, y < 25 ? y + 8 : 33 + (y - 25) * 0.45];
    case 'curl':
      return [24 + (x - 24) * 1.20, 28 + (y - 22) * 0.58];
    case 'eat':
      return [x + (y < 24 ? 3 : 0), y + (y < 24 ? 13 : 0)];
    case 'pounce':
      return [x + (y < 25 ? -5 : 4), 7 + y * 0.82];
    case 'play':
      return [x + (y < 25 ? 6 : -3), 4 + y * 0.88];
    case 'groom':
      return [x - (y < 24 ? 2 : 0), y + (y < 18 ? 3 : 0)];
    case 'stretch':
      return [24 + (x - 24) * 1.28 - (y < 22 ? 5 : 0), 8 + y * 0.78];
    case 'desk':
      return [23 + (x - 24) * 0.82 + (y < 24 ? 5 : 0), y];
    default:
      return [x, y];
  }
}

function stamp(out, x, y, pixel) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= 48 || iy < 0 || iy >= 48 || pixel === '.') return;
  out[iy][ix] = pixel;
}

/** Convert the authored 32-grid cat into one 48-grid body pose. */
export function buildPoseSprite(source, pose = 'sit', elapsedMs = 0) {
  const input = scaled48(source);
  const out = emptySprite();
  const breathe = Math.floor(elapsedMs / 800) % 4 === 2 ? 1 : 0;
  const earFlick = elapsedMs % 14000 > 12100 && elapsedMs % 14000 < 12300 ? 1 : 0;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const pixel = input[y][x];
      if (pixel === '.') continue;
      let [tx, ty] = posePoint(pose, x, y);
      if (y >= 25 && y <= 34) ty += breathe;
      if (y < 8) tx += x < 24 ? earFlick : -earFlick;
      stamp(out, tx, ty, pixel);
    }
  }

  // Pose-specific foreground paw acting, authored after the body transform.
  if (pose === 'groom') {
    for (let y = 18; y < 29; y++) for (let x = 15; x < 20; x++) stamp(out, x, y, y < 21 ? 'C' : 'F');
  }
  if (pose === 'desk') {
    for (let y = 30; y < 36; y++) for (let x = 30; x < 40; x++) stamp(out, x, y, 'C');
  }
  return out.map((row) => row.join(''));
}

const TAIL_PROFILES = {
  upright: { lift: 22, sway: 2, spread: 1 },
  sway:    { lift: 8,  sway: 7, spread: 1 },
  tucked:  { lift: 2,  sway: 3, spread: 1 },
  flick:   { lift: 5,  sway: 10, spread: 1 },
  puffed:  { lift: 12, sway: 5, spread: 3 },
};

/** Build one of eight independent tail frames behind the body. */
export function buildTailSprite(tailState = 'sway', frame = 0) {
  const out = emptySprite();
  const profile = TAIL_PROFILES[tailState] ?? TAIL_PROFILES.sway;
  const phase = (frame % 8) / 8 * Math.PI * 2;
  const baseX = 34;
  const baseY = 37;
  for (let step = 0; step <= 18; step++) {
    const progress = step / 18;
    const x = baseX + step * 0.55 + Math.sin(phase + progress * 2.4) * profile.sway * progress;
    const y = baseY - profile.lift * progress + Math.sin(phase * 0.5 + progress * Math.PI) * 2;
    for (let ox = -profile.spread; ox <= profile.spread; ox++) {
      stamp(out, x + ox, y, Math.abs(ox) === profile.spread ? 'D' : 'F');
    }
  }
  return out.map((row) => row.join(''));
}

export function poseForState(state) {
  return ({ active: 'pounce', focus: 'desk', fatigue: 'loaf', neglected: 'curl' })[state] ?? 'sit';
}

export function tailForState(state) {
  return ({ active: 'upright', focus: 'sway', fatigue: 'tucked', neglected: 'tucked', concerned: 'flick' })[state] ?? 'sway';
}
