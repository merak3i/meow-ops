// Pixel-art texture builders for the Scrying Sanctum.
//
// Lazy-singleton CanvasTextures generated at first use, then cached. Cheaper
// than custom GLSL, plays nice with existing meshBasicMaterial, and keeps
// the "no external assets" promise of D1-D4. Pulled out of the monolithic
// ScryingSanctum.tsx so future texture work (new champion classes, banner
// variants, ground decals) lives here without bloating the main file.
//
//   getShadowTexture()       — soft radial alpha for the champion shadows
//   getMarbleTexture()       — violet marble + gold veins, the floor disc
//   getStainedGlassTexture() — gold/violet/indigo stained-glass strip for
//                              citadel + spire windows
//   getLichKingTexture()     — 128x192 hand-drawn pixel sprite of Arthas
//   buildClassTexture()      — per-cat-type 2-frame walk cycle (idle + step)
//                              for every champion class

import * as THREE from 'three';
import { CLASS_MAP, FALLBACK_CLASS } from './classes';

// ─── Cache ───────────────────────────────────────────────────────────────────

const TEXTURE_CACHE = new Map<string, [THREE.CanvasTexture, THREE.CanvasTexture]>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Auto-outline: expand silhouette by 1px in 4 directions, fill dark, then redraw original on top */
function addOutline(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const src = ctx.getImageData(0, 0, W, H);
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const t = tmp.getContext('2d')!;
  for (const off of [[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,-1],[-1,1],[1,1]] as const) {
    t.drawImage(ctx.canvas, off[0], off[1]);
  }
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = '#0a0515';
  t.fillRect(0, 0, W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0);
  ctx.putImageData(src, 0, 0);
}

// ─── Shadow ──────────────────────────────────────────────────────────────────

let SHADOW_TEXTURE: THREE.CanvasTexture | null = null;
export function getShadowTexture(): THREE.CanvasTexture {
  if (SHADOW_TEXTURE) return SHADOW_TEXTURE;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.00, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  SHADOW_TEXTURE = new THREE.CanvasTexture(c);
  return SHADOW_TEXTURE;
}

// ─── Marble (floor) ──────────────────────────────────────────────────────────

let MARBLE_TEXTURE: THREE.CanvasTexture | null = null;
export function getMarbleTexture(): THREE.CanvasTexture {
  if (MARBLE_TEXTURE) return MARBLE_TEXTURE;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d')!;

  let seed = 0x5a17c0de;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // Base — smoother violet-blue marble. The color remains rich, but the
  // surface is calmer so the floor reads as one ritual material.
  ctx.fillStyle = '#271d49';
  ctx.fillRect(0, 0, 512, 512);
  const baseGrad = ctx.createRadialGradient(256, 236, 20, 256, 256, 330);
  baseGrad.addColorStop(0, 'rgba(92,70,148,0.28)');
  baseGrad.addColorStop(0.55, 'rgba(32,24,64,0.12)');
  baseGrad.addColorStop(1, 'rgba(8,5,22,0.18)');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Mottle — sparse and low contrast now; enough stone depth without
  // creating a noisy patchwork under the agent silhouettes.
  for (let i = 0; i < 72; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 18 + rand() * 48;
    const isLight = rand() < 0.58;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, isLight ? 'rgba(116,92,184,0.09)' : 'rgba(9,6,24,0.13)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Gold / cyan veins — thin curved lines tracing through the
  // marble. Each is a gradient-stroked quadratic bezier so the vein fades
  // in/out along its length (mimics natural mineral cracks).
  ctx.lineWidth = 0.65;
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const x1 = rand() * 512;
    const y1 = rand() * 512;
    const x2 = rand() * 512;
    const y2 = rand() * 512;
    const cx = (x1 + x2) / 2 + (rand() - 0.5) * 180;
    const cy = (y1 + y2) / 2 + (rand() - 0.5) * 180;
    const vein = i % 4 === 0 ? '92,210,255' : '242,211,106';
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0,   `rgba(${vein},0)`);
    grad.addColorStop(0.5, `rgba(${vein},0.30)`);
    grad.addColorStop(1,   `rgba(${vein},0)`);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
  }

  // Polish highlights — sparse soft spots so the marble reads as wet/glossy
  // under the violet ambient.
  for (let i = 0; i < 10; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 46 + rand() * 64;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, i % 3 === 0 ? 'rgba(92,210,255,0.055)' : 'rgba(167,139,250,0.075)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.35, 1.35);
  MARBLE_TEXTURE = tex;
  return tex;
}

// ─── Stained glass ───────────────────────────────────────────────────────────

let STAINED_GLASS_TEXTURE: THREE.CanvasTexture | null = null;
export function getStainedGlassTexture(): THREE.CanvasTexture {
  if (STAINED_GLASS_TEXTURE) return STAINED_GLASS_TEXTURE;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d')!;

  // Six horizontal panes. Each pane is a vertical gradient that lights
  // toward the middle so the glass reads as backlit by interior light.
  // Sequence: gold, violet, indigo, gold, rose, violet — repeats up the
  // window for a "tall narrow stained-glass" feel.
  const panes = ['#f5c518', '#a78bfa', '#6b8fff', '#f5c518', '#fb7185', '#7c5acc'];
  const stripeH = 256 / panes.length;
  for (let i = 0; i < panes.length; i++) {
    const top = i * stripeH;
    const grad = ctx.createLinearGradient(0, top, 0, top + stripeH);
    grad.addColorStop(0,    panes[i]!);
    grad.addColorStop(0.5,  '#ffffff');
    grad.addColorStop(1,    panes[(i + 1) % panes.length]!);
    ctx.fillStyle = grad;
    ctx.fillRect(0, top, 64, stripeH);
  }

  // Lead lines — dark bars between panes (the cames in real stained glass).
  ctx.fillStyle = '#1a0f28';
  for (let i = 0; i <= panes.length; i++) {
    ctx.fillRect(0, i * stripeH - 1, 64, 2);
  }
  // Vertical lead — single bar down the middle so each pane has a bisected
  // diamond pattern.
  ctx.fillRect(31, 0, 2, 256);

  const tex = new THREE.CanvasTexture(c);
  STAINED_GLASS_TEXTURE = tex;
  return tex;
}

// ─── Lich King ───────────────────────────────────────────────────────────────
//
// 256x192 hand-drawn mounted sprite for the permanent Lich King figure.
// Reference notes: armored undead horse facing right, horned rider, sword
// stretched left, torn cloak, bronze/steel horse barding, chains, and an icy
// plinth. Frostmourne also has a small 3D glow in LichKing.tsx.

let LICH_KING_TEXTURE: THREE.CanvasTexture | null = null;
export function getLichKingTexture(): THREE.CanvasTexture {
  if (LICH_KING_TEXTURE) return LICH_KING_TEXTURE;
  const W = 256, H = 192;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const OUTLINE   = '#080612';
  const BLACK     = '#020309';
  const IRON_DK   = '#070b12';
  const IRON      = '#111827';
  const IRON_MD   = '#27364a';
  const IRON_HI   = '#5f7896';
  const STEEL     = '#8ea4bd';
  const STEEL_HI  = '#d9e8f6';
  const GOLD_DK   = '#6f4b22';
  const GOLD      = '#c19a45';
  const BLUE      = '#5cd2ff';
  const BLUE_DIM  = '#286999';
  const ICE       = '#94efff';
  const ICE_DK    = '#1683b3';
  const SNOW      = '#dbeaf2';
  const BONE      = '#d6dde4';
  const CAPE_DK   = '#05020b';
  const CAPE      = '#170822';
  const CAPE_HI   = '#402148';
  const HORSE_DK  = '#05070d';
  const HORSE     = '#111722';
  const HORSE_HI  = '#26384d';
  const CLOTH     = '#35142e';

  const lpx = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const poly = (points: Array<[number, number]>, color: string) => {
    const [sx, sy] = points[0]!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  };
  const stroke = (points: Array<[number, number]>, color: string, width = 2) => {
    const [sx, sy] = points[0]!;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  };

  ctx.clearRect(0, 0, W, H);

  // Long runeblade, drawn behind the gauntlet so it reads as extended left.
  stroke([[6, 58], [60, 57], [93, 61]], '#091321', 5);
  stroke([[7, 57], [58, 56], [91, 60]], STEEL_HI, 2);
  stroke([[8, 59], [60, 58], [92, 62]], BLUE_DIM, 1);
  poly([[4, 58], [16, 54], [16, 61]], STEEL_HI);
  lpx(83, 57, 10, 9, GOLD_DK);
  lpx(87, 55, 5, 13, GOLD);

  // Torn black cloak flowing behind rider and horse.
  poly([[55, 47], [88, 39], [122, 52], [139, 84], [132, 121],
        [101, 132], [86, 119], [59, 143], [66, 111], [37, 126],
        [45, 93], [20, 88], [50, 73]], CAPE_DK);
  poly([[70, 54], [112, 56], [129, 84], [119, 114], [95, 124],
        [85, 104], [58, 123], [66, 94], [39, 88], [63, 76]], CAPE);
  poly([[42, 91], [55, 94], [47, 118]], CAPE_HI);
  poly([[81, 112], [94, 117], [81, 136]], CAPE_HI);
  stroke([[63, 64], [75, 86], [71, 116]], CAPE_HI, 2);
  stroke([[98, 58], [111, 86], [106, 119]], '#241033', 2);

  // Ice and iron display base.
  poly([[41, 143], [195, 130], [219, 155], [194, 174],
        [61, 177], [22, 163]], '#eef6fb');
  poly([[57, 151], [194, 139], [211, 154], [187, 166],
        [66, 169], [36, 160]], SNOW);
  poly([[50, 158], [204, 154], [226, 170], [199, 187],
        [43, 187], [19, 172]], BLACK);
  lpx(43, 175, 156, 7, '#11131b');
  for (let x = 42; x < 200; x += 13) {
    poly([[x, 174], [x + 4, 166], [x + 8, 174]], IRON_DK);
    lpx(x + 2, 176, 5, 8, IRON_MD);
  }
  poly([[26, 164], [40, 123], [53, 165]], ICE_DK);
  poly([[39, 166], [60, 111], [73, 167]], BLUE);
  poly([[58, 166], [75, 129], [87, 168]], ICE);
  poly([[77, 166], [92, 139], [103, 169]], ICE_DK);
  lpx(55, 128, 8, 35, '#dffaff');
  lpx(68, 142, 6, 20, '#c8f8ff');

  // Horse legs and raised foreleg.
  poly([[91, 116], [105, 119], [102, 155], [94, 168], [86, 167], [91, 147]], HORSE);
  poly([[128, 119], [141, 119], [146, 153], [140, 166], [130, 164], [132, 144]], HORSE_DK);
  poly([[163, 115], [174, 119], [190, 150], [184, 164], [174, 162], [174, 143]], HORSE);
  poly([[176, 111], [189, 112], [218, 129], [213, 141], [194, 136], [181, 126]], HORSE_DK);
  lpx(84, 165, 18, 6, BLACK);
  lpx(128, 163, 18, 6, BLACK);
  lpx(173, 161, 18, 6, BLACK);
  lpx(203, 138, 14, 5, BLACK);
  lpx(91, 139, 8, 20, IRON_MD);
  lpx(132, 138, 8, 21, IRON_MD);
  lpx(176, 137, 8, 22, IRON_MD);

  // Horse body, saddle cloth, armored neck, and barding.
  poly([[78, 91], [101, 76], [150, 73], [183, 83], [194, 105],
        [178, 128], [110, 131], [81, 116]], HORSE_DK);
  poly([[92, 88], [118, 80], [154, 82], [181, 92], [186, 107],
        [170, 121], [113, 123], [91, 111]], HORSE);
  poly([[105, 87], [145, 82], [171, 91], [174, 112], [150, 119],
        [107, 116], [92, 104]], HORSE_HI);
  poly([[94, 103], [160, 101], [174, 118], [158, 139],
        [128, 132], [113, 146], [96, 130]], CLOTH);
  poly([[107, 108], [164, 107], [159, 127], [135, 126], [124, 139], [111, 125]], '#4b1d39');
  lpx(109, 96, 54, 5, GOLD_DK);
  lpx(113, 97, 46, 2, GOLD);
  for (let x = 112; x < 160; x += 12) lpx(x, 97, 4, 16, GOLD_DK);
  poly([[153, 76], [170, 58], [194, 48], [221, 55], [233, 70],
        [221, 88], [190, 91], [166, 84]], HORSE_DK);
  poly([[166, 62], [191, 52], [217, 58], [226, 70], [216, 82],
        [190, 83], [171, 77]], HORSE);
  poly([[181, 50], [213, 54], [224, 66], [216, 75], [186, 72]], IRON_MD);
  poly([[184, 48], [202, 42], [221, 53], [211, 59], [190, 55]], GOLD_DK);
  lpx(188, 52, 29, 4, GOLD);
  lpx(211, 60, 12, 5, STEEL);
  lpx(217, 63, 7, 4, BLUE);
  poly([[198, 43], [205, 24], [212, 47]], IRON_HI);
  poly([[221, 54], [239, 48], [228, 64]], STEEL);
  poly([[177, 59], [170, 42], [187, 55]], IRON_HI);
  for (let i = 0; i < 5; i++) lpx(180 + i * 8, 78, 5, 8, GOLD_DK);

  // Saddle chains and reins.
  stroke([[117, 92], [138, 109], [164, 115], [189, 105]], '#161c27', 3);
  stroke([[118, 91], [139, 108], [164, 114], [190, 104]], STEEL, 1);
  for (let i = 0; i < 8; i++) lpx(124 + i * 8, 101 + (i % 2) * 4, 4, 4, STEEL);
  stroke([[109, 58], [146, 76], [206, 68]], '#1c2532', 2);
  stroke([[110, 57], [147, 75], [207, 67]], GOLD, 1);

  // Rider legs and armored torso.
  poly([[105, 88], [118, 88], [126, 126], [116, 132], [103, 103]], IRON_DK);
  poly([[132, 86], [144, 88], [153, 122], [145, 130], [131, 105]], IRON_DK);
  lpx(107, 91, 8, 30, IRON_MD);
  lpx(136, 91, 8, 29, IRON_MD);
  lpx(111, 121, 15, 6, STEEL);
  lpx(141, 120, 14, 6, STEEL);
  poly([[103, 45], [130, 39], [154, 51], [156, 82], [139, 98],
        [112, 94], [97, 74]], IRON_DK);
  poly([[112, 48], [130, 43], [148, 53], [147, 78], [134, 89],
        [115, 86], [104, 70]], IRON);
  lpx(127, 48, 5, 38, IRON_HI);
  lpx(128, 56, 3, 22, BLUE_DIM);
  lpx(126, 64, 7, 4, BLUE);
  poly([[78, 46], [105, 40], [114, 58], [94, 70], [72, 62]], IRON_DK);
  poly([[145, 48], [172, 50], [174, 68], [153, 74], [139, 62]], IRON_DK);
  poly([[83, 50], [103, 47], [109, 57], [94, 64], [78, 59]], STEEL);
  poly([[149, 53], [169, 55], [168, 65], [153, 69], [145, 61]], STEEL);
  lpx(90, 55, 6, 6, OUTLINE);
  lpx(158, 58, 6, 6, OUTLINE);
  lpx(91, 56, 4, 3, BONE);
  lpx(159, 59, 4, 3, BONE);

  // Rider arm stretched left to the blade; right arm grips reins.
  stroke([[106, 60], [82, 58], [58, 57]], IRON_DK, 9);
  stroke([[107, 59], [82, 57], [58, 56]], IRON_HI, 4);
  lpx(56, 53, 10, 10, IRON_DK);
  lpx(58, 55, 7, 6, STEEL);
  stroke([[150, 62], [165, 73], [176, 86]], IRON_DK, 8);
  stroke([[150, 61], [166, 72], [176, 85]], IRON_HI, 3);

  // Helm, crown, horns, and face glow.
  poly([[116, 21], [130, 15], [145, 22], [150, 41],
        [143, 54], [123, 55], [114, 42]], IRON_DK);
  lpx(121, 25, 25, 22, IRON_MD);
  lpx(124, 28, 19, 14, IRON);
  lpx(119, 42, 29, 6, BLACK);
  poly([[124, 18], [129, 1], [134, 18]], STEEL);
  poly([[116, 24], [103, 7], [113, 31]], STEEL);
  poly([[143, 24], [160, 9], [149, 32]], STEEL);
  poly([[121, 20], [111, 13], [119, 28]], IRON_HI);
  poly([[142, 20], [152, 14], [145, 29]], IRON_HI);
  lpx(123, 35, 8, 3, BLUE);
  lpx(136, 35, 8, 3, BLUE);
  lpx(126, 43, 15, 2, STEEL_HI);
  lpx(121, 49, 25, 4, IRON_MD);

  addOutline(ctx, W, H);

  // Late bright pass: glows, ornaments, and tiny high-contrast details.
  lpx(123, 35, 8, 3, '#dcfbff');
  lpx(136, 35, 8, 3, '#dcfbff');
  lpx(126, 65, 7, 3, '#dcfbff');
  lpx(217, 63, 7, 4, '#9ff4ff');
  lpx(56, 55, 7, 3, '#eefbff');
  stroke([[7, 57], [58, 56], [91, 60]], '#e6fbff', 1);
  stroke([[9, 61], [58, 60], [90, 64]], BLUE, 1);
  for (let x = 39; x < 205; x += 18) lpx(x, 180, 9, 2, '#3a4356');
  for (let x = 34; x < 100; x += 13) lpx(x, 160 - (x % 3), 5, 5, '#dffaff');
  lpx(22, 168, 184, 3, 'rgba(92,210,255,0.25)');
  lpx(60, 185, 128, 2, 'rgba(188,245,255,0.28)');

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  LICH_KING_TEXTURE = tex;
  return tex;
}

// ─── Champion class textures ─────────────────────────────────────────────────
//
// Per cat_type, returns a [idle, walking] pair of CanvasTextures with the
// signature character pose for each class. Cached per cat_type so a 50-agent
// run group still only rasterises 7 sprite pairs total. Each `case` below
// hand-draws the iconic look for one class — Wolverine, Batman, Dr. Strange,
// Vader, Captain America, Gandalf, Terminator (default/ghost).

export function buildClassTexture(catType: string): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const cached = TEXTURE_CACHE.get(catType);
  if (cached) return cached;

  const cls   = CLASS_MAP[catType] ?? FALLBACK_CLASS;
  const color = cls.color;
  // The original implementation pulled `dark` here for use inside the
  // switch but only Vader's branch happens to need it; keep the binding
  // for parity with the legacy file (the unused-var warning was already
  // pre-existing).
  // const dark  = cls.emissive || '#111';
  const W = 128, H = 192;

  function drawFrame(walking: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    const aL = walking ? 72 : 68;   // arm L Y
    const aR = walking ? 76 : 68;   // arm R Y
    const lL = walking ? 124 : 120; // leg L Y
    const lR = walking ? 116 : 120; // leg R Y

    switch (catType) {
      case 'builder': { // WOLVERINE — yellow/blue suit, mask points, adamantium claws
        px(ctx, 40, 0,  8, 16, color);
        px(ctx, 80, 0,  8, 16, color);
        px(ctx, 44, 8,  40, 24, color);
        px(ctx, 46, 10, 36, 20, '#d4a800');
        px(ctx, 48, 16, 12, 10, '#1a1a1a');
        px(ctx, 68, 16, 12, 10, '#1a1a1a');
        px(ctx, 50, 18, 8,  6,  '#ffffff');
        px(ctx, 70, 18, 8,  6,  '#ffffff');
        px(ctx, 52, 19, 4,  4,  '#2a1a0a');
        px(ctx, 72, 19, 4,  4,  '#2a1a0a');
        px(ctx, 50, 32, 28, 20, '#d4a47c');
        px(ctx, 52, 34, 24, 16, '#c4946c');
        px(ctx, 56, 44, 16, 4,  '#a07050');
        px(ctx, 24, 56, 80, 14, color);
        px(ctx, 26, 58, 76, 4,  '#ffffff22');
        px(ctx, 38, 70, 52, 44, '#1a3a8a');
        px(ctx, 40, 72, 48, 40, '#152e6e');
        px(ctx, 54, 74, 20, 36, color);
        px(ctx, 56, 76, 16, 4,  '#ffffff22');
        px(ctx, 20, aL, 18, 36, color);
        px(ctx, 90, aR, 18, 36, color);
        px(ctx, 12, aL - 4,  3, 28, '#d0d8e0');
        px(ctx, 17, aL - 6,  3, 30, '#d0d8e0');
        px(ctx, 22, aL - 4,  3, 28, '#d0d8e0');
        px(ctx, 13, aL - 2,  1, 24, '#ffffff');
        px(ctx, 18, aL - 4,  1, 26, '#ffffff');
        px(ctx, 23, aL - 2,  1, 24, '#ffffff');
        px(ctx, 103, aR - 4, 3, 28, '#d0d8e0');
        px(ctx, 108, aR - 6, 3, 30, '#d0d8e0');
        px(ctx, 113, aR - 4, 3, 28, '#d0d8e0');
        px(ctx, 104, aR - 2, 1, 24, '#ffffff');
        px(ctx, 109, aR - 4, 1, 26, '#ffffff');
        px(ctx, 114, aR - 2, 1, 24, '#ffffff');
        px(ctx, 40, 110, 48, 6, '#8b7a5e');
        px(ctx, 58, 111, 12, 4, '#d4a800');
        px(ctx, 44, 116, 18, 36, '#1a3a8a');
        px(ctx, 66, 116, 18, 36, '#152e6e');
        px(ctx, 40, lL + 26, 24, 12, color);
        px(ctx, 64, lR + 26, 24, 12, color);
        break;
      }
      case 'detective': { // BATMAN
        px(ctx, 20, 52, 88, 96, '#0a0a14');
        px(ctx, 12, 80, 104, 72, '#0a0a14');
        px(ctx, 44, 0,  8, 20, '#1a1a2a');
        px(ctx, 76, 0,  8, 20, '#1a1a2a');
        px(ctx, 44, 8,  40, 28, '#1a1a2a');
        px(ctx, 46, 10, 36, 24, '#101018');
        px(ctx, 50, 20, 10, 5, '#ffffff');
        px(ctx, 68, 20, 10, 5, '#ffffff');
        px(ctx, 51, 21, 8,  3, '#ddeeff');
        px(ctx, 69, 21, 8,  3, '#ddeeff');
        px(ctx, 50, 36, 28, 16, '#d4a47c');
        px(ctx, 52, 38, 24, 12, '#c4946c');
        px(ctx, 58, 46, 12, 4, '#a07050');
        px(ctx, 30, 52, 68, 12, '#1a1a2a');
        px(ctx, 32, 54, 64, 4,  '#2a2a3a');
        px(ctx, 40, 64, 48, 44, '#2a2a3a');
        px(ctx, 42, 66, 44, 40, '#222230');
        px(ctx, 50, 72, 28, 16, '#f5c518');
        px(ctx, 52, 74, 24, 12, '#f5c518');
        px(ctx, 56, 74, 16, 4,  '#1a1a1a');
        px(ctx, 52, 76, 24, 4,  '#1a1a1a');
        px(ctx, 60, 78, 8,  6,  '#1a1a1a');
        px(ctx, 24, aL, 16, 34, '#1a1a2a');
        px(ctx, 88, aR, 16, 34, '#1a1a2a');
        px(ctx, 22, aL + 20, 20, 14, '#2a2a3a');
        px(ctx, 86, aR + 20, 20, 14, '#2a2a3a');
        px(ctx, 18, aL + 22, 4, 8, '#3a3a4a');
        px(ctx, 106, aR + 22, 4, 8, '#3a3a4a');
        px(ctx, 40, 108, 48, 6, '#d4a800');
        px(ctx, 44, 109, 8,  4, '#8b7a5e');
        px(ctx, 58, 109, 12, 4, '#d4a800');
        px(ctx, 76, 109, 8,  4, '#8b7a5e');
        px(ctx, 44, 114, 18, 38, '#1a1a2a');
        px(ctx, 66, 114, 18, 38, '#1a1a2a');
        px(ctx, 40, lL + 28, 24, 10, '#101018');
        px(ctx, 64, lR + 28, 24, 10, '#101018');
        break;
      }
      case 'commander': { // DR. STRANGE
        px(ctx, 46, 4,  36, 12, '#1a1a2a');
        px(ctx, 44, 8,  4,  8,  '#aaaaaa');
        px(ctx, 80, 8,  4,  8,  '#aaaaaa');
        px(ctx, 48, 16, 32, 32, '#d4a47c');
        px(ctx, 50, 18, 28, 28, '#c4946c');
        px(ctx, 54, 26, 6,  5,  '#2a3a2a');
        px(ctx, 68, 26, 6,  5,  '#2a3a2a');
        px(ctx, 55, 27, 3,  3,  '#44aaff');
        px(ctx, 69, 27, 3,  3,  '#44aaff');
        px(ctx, 58, 38, 12, 8,  '#2a1a0a');
        px(ctx, 60, 40, 8,  8,  '#1a0a00');
        px(ctx, 36, 48, 56, 12, color);
        px(ctx, 32, 50, 8,  16, color);
        px(ctx, 88, 50, 8,  16, color);
        px(ctx, 34, 50, 6,  14, '#ff4455');
        px(ctx, 88, 50, 6,  14, '#ff4455');
        px(ctx, 24, 56, 80, 8,  color);
        px(ctx, 16, 64, 96, 80, color);
        px(ctx, 18, 66, 92, 76, '#b82030');
        px(ctx, 42, 60, 44, 52, '#1a3a6a');
        px(ctx, 44, 62, 40, 48, '#152e5a');
        ctx.fillStyle = '#22cc44';
        ctx.beginPath(); ctx.arc(64, 72, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#44ff66';
        ctx.beginPath(); ctx.arc(64, 72, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff88';
        ctx.beginPath(); ctx.arc(63, 70, 2, 0, Math.PI * 2); ctx.fill();
        px(ctx, 24, aL, 16, 32, color);
        px(ctx, 88, aR, 16, 32, color);
        ctx.strokeStyle = '#ffaa22cc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(18, aL + 34, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffaa2266'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(18, aL + 34, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffaa22cc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(110, aR + 34, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffaa2266'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(110, aR + 34, 6, 0, Math.PI * 2); ctx.stroke();
        px(ctx, 46, 112, 16, 36, '#1a3a6a');
        px(ctx, 66, 112, 16, 36, '#152e5a');
        px(ctx, 42, lL + 26, 22, 12, '#3a2a1a');
        px(ctx, 64, lR + 26, 22, 12, '#3a2a1a');
        break;
      }
      case 'architect': { // DARTH VADER
        px(ctx, 16, 48, 96, 104, '#0a0a0a');
        px(ctx, 10, 80, 108, 72, '#0a0a0a');
        px(ctx, 42, 0,  44, 40, '#1a1a1a');
        px(ctx, 44, 2,  40, 36, '#222222');
        px(ctx, 46, 4,  36, 8,  '#333333');
        px(ctx, 50, 18, 10, 6,  '#0a0a0a');
        px(ctx, 68, 18, 10, 6,  '#0a0a0a');
        px(ctx, 52, 19, 6,  4,  '#cc2222');
        px(ctx, 70, 19, 6,  4,  '#cc2222');
        px(ctx, 52, 28, 24, 10, '#0a0a0a');
        px(ctx, 54, 30, 20, 2,  '#333333');
        px(ctx, 54, 33, 20, 2,  '#333333');
        px(ctx, 54, 36, 20, 2,  '#333333');
        px(ctx, 48, 68, 32, 16, '#2a2a2a');
        px(ctx, 52, 70, 6,  4,  '#ff3333');
        px(ctx, 60, 70, 6,  4,  '#33ff33');
        px(ctx, 68, 70, 6,  4,  '#3388ff');
        px(ctx, 52, 76, 24, 4,  '#444444');
        px(ctx, 28, 48, 72, 16, '#1a1a1a');
        px(ctx, 30, 50, 68, 4,  '#2a2a2a');
        px(ctx, 40, 64, 48, 44, '#1a1a1a');
        px(ctx, 42, 66, 44, 40, '#111111');
        px(ctx, 24, aL, 16, 34, '#1a1a1a');
        px(ctx, 88, aR, 16, 34, '#1a1a1a');
        px(ctx, 100, aR - 4, 6, 12, '#888888');
        px(ctx, 101, aR - 40, 4, 36, '#ff2222');
        px(ctx, 102, aR - 38, 2, 32, '#ff6666');
        ctx.fillStyle = '#ff222244';
        ctx.fillRect(99, aR - 40, 8, 36);
        px(ctx, 40, 108, 48, 6, '#2a2a2a');
        px(ctx, 58, 109, 12, 4, '#444444');
        px(ctx, 44, 114, 18, 38, '#1a1a1a');
        px(ctx, 66, 114, 18, 38, '#111111');
        px(ctx, 40, lL + 28, 24, 10, '#0a0a0a');
        px(ctx, 64, lR + 28, 24, 10, '#0a0a0a');
        break;
      }
      case 'guardian': { // CAPTAIN AMERICA
        px(ctx, 44, 2,  40, 32, color);
        px(ctx, 46, 4,  36, 28, '#1e4fc0');
        px(ctx, 60, 4,  8, 16, '#ffffff');
        px(ctx, 56, 12, 16, 4,  '#ffffff');
        px(ctx, 40, 14, 8, 4, '#ffffff');
        px(ctx, 80, 14, 8, 4, '#ffffff');
        px(ctx, 50, 34, 28, 24, '#d4a47c');
        px(ctx, 52, 36, 24, 20, '#c4946c');
        px(ctx, 56, 40, 5,  5,  '#1a3a6a');
        px(ctx, 67, 40, 5,  5,  '#1a3a6a');
        px(ctx, 57, 41, 2,  2,  '#4488ff');
        px(ctx, 68, 41, 2,  2,  '#4488ff');
        px(ctx, 56, 50, 16, 4,  '#b08060');
        px(ctx, 28, 58, 72, 12, color);
        px(ctx, 30, 60, 68, 4,  '#ffffff22');
        px(ctx, 40, 70, 48, 40, color);
        px(ctx, 42, 72, 44, 36, '#1e4fc0');
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const cx = 64, cy = 82;
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const method = i === 0 ? 'moveTo' : 'lineTo';
          ctx[method](cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
          const a2 = a + Math.PI / 5;
          ctx.lineTo(cx + Math.cos(a2) * 4, cy + Math.sin(a2) * 4);
        }
        ctx.closePath(); ctx.fill();
        px(ctx, 42, 96, 44, 4, '#cc2222');
        px(ctx, 42, 100, 44, 4, '#ffffff');
        px(ctx, 42, 104, 44, 4, '#cc2222');
        px(ctx, 22, aL, 16, 34, color);
        px(ctx, 90, aR, 16, 34, color);
        px(ctx, 22, aL + 22, 16, 12, '#cc2222');
        px(ctx, 90, aR + 22, 16, 12, '#cc2222');
        const sx = 14, sy = aL + 4;
        ctx.fillStyle = '#cc2222';
        ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#cc2222';
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2563eb';
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          const method = i === 0 ? 'moveTo' : 'lineTo';
          ctx[method](sx + Math.cos(a) * 3, sy + Math.sin(a) * 3);
          const a2 = a + Math.PI / 5;
          ctx.lineTo(sx + Math.cos(a2) * 1.5, sy + Math.sin(a2) * 1.5);
        }
        ctx.closePath(); ctx.fill();
        px(ctx, 42, 108, 44, 5, '#8b4513');
        px(ctx, 58, 109, 12, 3, '#d4a800');
        px(ctx, 44, 113, 18, 38, color);
        px(ctx, 66, 113, 18, 38, '#1e4fc0');
        px(ctx, 40, lL + 26, 24, 12, '#cc2222');
        px(ctx, 64, lR + 26, 24, 12, '#cc2222');
        break;
      }
      case 'storyteller': { // GANDALF
        px(ctx, 58, 0,  12, 8,  '#6b7280');
        px(ctx, 54, 8,  20, 8,  '#6b7280');
        px(ctx, 48, 16, 32, 12, '#6b7280');
        px(ctx, 42, 24, 44, 8,  '#7a838f');
        px(ctx, 60, 2,  8,  6,  '#8a939f');
        px(ctx, 50, 32, 28, 24, '#e8d4b8');
        px(ctx, 52, 34, 24, 20, '#d8c4a8');
        px(ctx, 56, 38, 5,  4,  '#4a4a5a');
        px(ctx, 67, 38, 5,  4,  '#4a4a5a');
        px(ctx, 57, 39, 2,  2,  '#88ccff');
        px(ctx, 68, 39, 2,  2,  '#88ccff');
        px(ctx, 54, 36, 8, 2, '#cccccc');
        px(ctx, 66, 36, 8, 2, '#cccccc');
        px(ctx, 50, 48, 28, 8,  '#e8e8e8');
        px(ctx, 48, 56, 32, 12, '#dddddd');
        px(ctx, 52, 68, 24, 16, '#d0d0d0');
        px(ctx, 56, 84, 16, 8,  '#cccccc');
        px(ctx, 50, 50, 4,  6,  '#ffffff44');
        px(ctx, 36, 56, 56, 8, color);
        px(ctx, 34, 64, 60, 56, color);
        px(ctx, 28, 88, 72, 32, '#8a939f');
        px(ctx, 36, 66, 56, 52, '#7a838f');
        px(ctx, 44, 70, 40, 8,  '#ffffff11');
        px(ctx, 24, aL, 12, 32, color);
        px(ctx, 92, aR, 12, 32, color);
        px(ctx, 98, aR - 40, 6, 72, '#8b7a5e');
        px(ctx, 96, aR - 44, 10, 8, '#8b7a5e');
        ctx.fillStyle = '#ffffff88';
        ctx.beginPath(); ctx.arc(101, aR - 48, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#aaddff';
        ctx.beginPath(); ctx.arc(101, aR - 48, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(100, aR - 50, 2, 0, Math.PI * 2); ctx.fill();
        px(ctx, 40, 96, 48, 4, '#8b7a5e');
        px(ctx, 44, lL + 8, 20, 8, '#7a838f');
        px(ctx, 68, lR + 8, 20, 8, '#7a838f');
        break;
      }
      default: { // TERMINATOR T-800 (also handles 'ghost')
        px(ctx, 44, 2,  40, 12, '#2a2018');
        px(ctx, 42, 6,  44, 8,  '#1a1008');
        px(ctx, 44, 14, 20, 28, '#d4a47c');
        px(ctx, 64, 14, 20, 28, '#8090a0');
        px(ctx, 46, 16, 16, 24, '#c4946c');
        px(ctx, 66, 16, 16, 24, '#6a7a8a');
        px(ctx, 50, 22, 6,  5,  '#2a2a2a');
        px(ctx, 51, 23, 4,  3,  '#4a3a2a');
        px(ctx, 72, 22, 6,  5,  '#ff0000');
        px(ctx, 73, 23, 4,  3,  '#ff4444');
        px(ctx, 74, 24, 2,  1,  '#ffffff');
        px(ctx, 66, 34, 16, 8,  '#607080');
        px(ctx, 68, 36, 12, 4,  '#8090a0');
        px(ctx, 46, 34, 18, 8,  '#c4946c');
        px(ctx, 62, 14, 4, 28, '#8a3030');
        px(ctx, 63, 16, 2, 24, '#aa4040');
        px(ctx, 28, 48, 72, 16, '#1a1a1a');
        px(ctx, 30, 50, 68, 4,  '#2a2a2a');
        px(ctx, 40, 64, 48, 44, '#1a1a1a');
        px(ctx, 42, 66, 44, 40, '#111111');
        px(ctx, 34, 44, 12, 12, '#1a1a1a');
        px(ctx, 82, 44, 12, 12, '#1a1a1a');
        px(ctx, 48, 68, 32, 12, '#0a0a0a');
        px(ctx, 22, aL, 16, 36, '#1a1a1a');
        px(ctx, 90, aR, 16, 36, '#1a1a1a');
        px(ctx, 90, aR + 28, 16, 8, '#8090a0');
        px(ctx, 92, aR + 30, 12, 4, '#a0b0c0');
        px(ctx, 14, aL - 8, 8, 40, '#4a4a4a');
        px(ctx, 12, aL + 24, 12, 12, '#3a3a3a');
        px(ctx, 15, aL - 6, 2, 36, '#666666');
        px(ctx, 40, 108, 48, 6, '#2a2a2a');
        px(ctx, 56, 109, 16, 4, '#888888');
        px(ctx, 44, 114, 18, 38, '#1a1a1a');
        px(ctx, 66, 114, 18, 38, '#111111');
        px(ctx, 40, lL + 28, 24, 10, '#0a0a0a');
        px(ctx, 64, lR + 28, 24, 10, '#0a0a0a');
        px(ctx, 42, lL + 30, 20, 4,  '#2a2a2a');
        px(ctx, 66, lR + 30, 20, 4,  '#2a2a2a');
        break;
      }
    }

    // Auto-outline for crisp visibility
    addOutline(ctx, W, H);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  const result: [THREE.CanvasTexture, THREE.CanvasTexture] = [drawFrame(false), drawFrame(true)];
  TEXTURE_CACHE.set(catType, result);
  return result;
}
