// particles.ts — Pixel-art particle bursts for action feedback.
// Each effect (feed, pet, play, groom, sleep, session, milestone, room)
// spawns a small swarm of sprites that drift with simple physics. Sprites
// reuse the cat's PALETTE/CHAR_MAP so colors stay coherent.

import type { Sprite } from './sprites';

// ─── Particle sprites (small N×N grids) ───────────────────────────────────────
// Char meanings come from the shared CHAR_MAP in sprites.ts:
//   o = outline   F = fur orange   D = fur shadow brown   L = fur tan/yellow
//   C = chest cream   P = pink   E = green iris   K = black   S = sad blue

const HEART: Sprite = [
  '.P.P.',
  'PPPPP',
  'PPPPP',
  '.PPP.',
  '..P..',
] as const;

const SPARKLE: Sprite = [
  '..L..',
  '.LLL.',
  'LLLLL',
  '.LLL.',
  '..L..',
] as const;

const ZZZ: Sprite = [
  'CCCC',
  '...C',
  '..C.',
  '.C..',
  'CCCC',
] as const;

const KIBBLE: Sprite = [
  '.D.',
  'DDD',
  '.D.',
] as const;

const PLUS: Sprite = [
  '..E..',
  '..E..',
  'EEEEE',
  '..E..',
  '..E..',
] as const;

const STAR: Sprite = [
  '..S..',
  '.SSS.',
  'SSSSS',
  '.SSS.',
  '..S..',
] as const;

// ─── Particle data + burst spawning ───────────────────────────────────────────

export interface SpawnedParticle {
  id:        number;
  sprite:    Sprite;
  x:         number; // canvas px (top-left of sprite)
  y:         number;
  vx:        number; // canvas px / ms
  vy:        number;
  ay:        number; // gravity (px / ms²)
  spawnedAt: number; // performance.now() at spawn
  lifeMs:    number;
}

/** Layout context the overlay passes in so spawn positions track the cat. */
export interface BurstContext {
  catCenterX:  number; // canvas px
  catTopY:     number; // top of cat sprite (canvas px)
  catBottomY:  number; // ground line (canvas px)
  blockPx:     number; // size of one sprite-pixel block
}

let nextId = 0;

/** Build the particle burst for a given effect. Caller appends the result to
 *  its live-particle list; physics + cleanup are the renderer's job. */
export function spawnBurst(
  effect: string,
  ctx:    BurstContext,
  now:    number,
): SpawnedParticle[] {
  const { catCenterX, catTopY, blockPx } = ctx;
  const out: SpawnedParticle[] = [];

  const push = (
    sprite:  Sprite,
    x:       number,
    y:       number,
    vx:      number,
    vy:      number,
    lifeMs:  number,
    ay = 0,
  ): void => {
    out.push({ id: ++nextId, sprite, x, y, vx, vy, ay, spawnedAt: now, lifeMs });
  };

  // Tuned for small canvases (blockPx ~5–10). Velocities roughly stay on-canvas
  // for at least 80% of life so the eye sees the full motion arc.
  switch (effect) {
    case 'feed': {
      // Kibble pellets fall onto the cat's head from above.
      for (let i = 0; i < 6; i++) {
        const xOffset = (i - 2.5) * blockPx * 3;
        push(
          KIBBLE,
          catCenterX + xOffset - blockPx,
          catTopY - blockPx * 6 - i * blockPx * 2,
          (Math.random() - 0.5) * 0.01 * blockPx,
          0.018 * blockPx,
          1500,
          0.00005 * blockPx,
        );
      }
      break;
    }
    case 'pet': {
      // One heart pops above the cat's head and drifts up.
      push(
        HEART,
        catCenterX - blockPx * 2.5,
        catTopY - blockPx * 1,
        0,
        -0.018 * blockPx,
        1300,
      );
      break;
    }
    case 'play': {
      // Sparkles burst outward from cat center.
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
        push(
          SPARKLE,
          catCenterX - blockPx * 2.5,
          catTopY + blockPx * 6,
          Math.cos(angle) * 0.020 * blockPx,
          Math.sin(angle) * 0.020 * blockPx - 0.005 * blockPx,
          1100,
        );
      }
      break;
    }
    case 'groom': {
      // Sparkles ring the head, drifting upward.
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        push(
          SPARKLE,
          catCenterX + Math.cos(angle) * blockPx * 6 - blockPx * 2.5,
          catTopY + blockPx * 2 + Math.sin(angle) * blockPx * 3,
          0,
          -0.012 * blockPx,
          1300,
        );
      }
      break;
    }
    case 'sleep': {
      // zZz drift up and slightly right.
      for (let i = 0; i < 3; i++) {
        push(
          ZZZ,
          catCenterX + (i - 1) * blockPx * 3,
          catTopY - blockPx * 2 - i * blockPx * 3,
          0.006 * blockPx,
          -0.014 * blockPx,
          1500 + i * 250,
        );
      }
      break;
    }
    case 'session': {
      // A small +1 pops above the cat.
      push(
        PLUS,
        catCenterX - blockPx * 2.5,
        catTopY + blockPx * 4,
        0,
        -0.022 * blockPx,
        1200,
      );
      break;
    }
    case 'milestone': {
      // Bigger burst — stars + sparkles in a ring.
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const sprite = i % 2 === 0 ? STAR : SPARKLE;
        push(
          sprite,
          catCenterX - blockPx * 2.5,
          catTopY + blockPx * 8,
          Math.cos(angle) * 0.030 * blockPx,
          Math.sin(angle) * 0.030 * blockPx - 0.008 * blockPx,
          1600,
        );
      }
      break;
    }
    case 'room': {
      // Three sparkles wave across the cat as the room re-tiers.
      for (let i = 0; i < 3; i++) {
        push(
          SPARKLE,
          catCenterX + (i - 1) * blockPx * 6 - blockPx * 2.5,
          catTopY + blockPx * 6,
          0,
          -0.010 * blockPx,
          1100,
        );
      }
      break;
    }
    default:
      break;
  }

  return out;
}
