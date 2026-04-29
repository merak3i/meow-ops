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

  // Base — deep violet marble
  ctx.fillStyle = '#1c1430';
  ctx.fillRect(0, 0, 512, 512);

  // Mottle — many small radial splotches, alternating darker/lighter so the
  // surface has organic tone variation instead of looking flat.
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 8 + Math.random() * 36;
    const isLight = Math.random() < 0.5;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, isLight ? 'rgba(80,60,120,0.18)' : 'rgba(8,4,18,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Gold veins — thin curved lines tracing through the marble. Each is a
  // gradient-stroked quadratic bezier so the vein fades in/out along its
  // length (mimics natural mineral cracks).
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  for (let i = 0; i < 28; i++) {
    const x1 = Math.random() * 512;
    const y1 = Math.random() * 512;
    const x2 = Math.random() * 512;
    const y2 = Math.random() * 512;
    const cx = (x1 + x2) / 2 + (Math.random() - 0.5) * 220;
    const cy = (y1 + y2) / 2 + (Math.random() - 0.5) * 220;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0,   'rgba(200,168,85,0)');
    grad.addColorStop(0.5, 'rgba(200,168,85,0.7)');
    grad.addColorStop(1,   'rgba(200,168,85,0)');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
  }

  // Polish highlights — sparse soft spots so the marble reads as wet/glossy
  // under the violet ambient.
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 32 + Math.random() * 50;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(124,90,204,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
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
// 128×192 hand-drawn pixel sprite for the permanent Lich King figure.
// Composition matches the WotLK Arthas reference: horned helm with glowing
// eye slits, skull pauldrons, chest skull motif, ornate cape, belt skull
// buckle, gauntlets at hip-level, sabatons, frost mist around the boots.
// Frostmourne is a separate 3D mesh planted in front (lore: oath sword).

let LICH_KING_TEXTURE: THREE.CanvasTexture | null = null;
export function getLichKingTexture(): THREE.CanvasTexture {
  if (LICH_KING_TEXTURE) return LICH_KING_TEXTURE;
  const W = 128, H = 192;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Palette — D5 Dalaran armor with Arthas frost accents
  const ARMOR_DK   = '#0a0518';
  const ARMOR      = '#1a0f2e';
  const ARMOR_MD   = '#2a1a40';
  const ARMOR_HI   = '#3a2a5a';
  const ARMOR_RIM  = '#5a4a7a';
  const BONE_LT    = '#d8d8c8';
  const BONE_MD    = '#a0a08c';
  const BONE_DK    = '#3a3a30';
  const CAPE_DK    = '#06020c';
  const CAPE       = '#0e0820';
  const CAPE_RIM   = '#1c1235';
  const RUNE       = '#5cd2ff';
  const RUNE_DIM   = '#2a6090';
  const FROST      = '#bce5ff';
  const FROST_DIM  = '#5b8cb8';

  const lpx = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  ctx.clearRect(0, 0, W, H);

  // ── Cape (drawn first, behind body) — wide trapezoid widening downward
  lpx(40,  46, 48, 4,  CAPE_DK);
  lpx(36,  50, 56, 8,  CAPE);
  lpx(32,  58, 64, 10, CAPE_DK);
  lpx(28,  68, 72, 12, CAPE);
  lpx(24,  80, 80, 16, CAPE_DK);
  lpx(20,  96, 88, 20, CAPE);
  lpx(16, 116, 96, 24, CAPE_DK);
  lpx(12, 140, 104, 28, CAPE);
  lpx(10, 168, 108, 16, CAPE_DK);
  // cape rim accents
  lpx(12, 168, 104, 1, CAPE_RIM);
  lpx(10, 182, 108, 1, CAPE_RIM);
  // cape vertical fold lines
  lpx(40,  60, 1, 110, CAPE_RIM);
  lpx(86,  60, 1, 110, CAPE_RIM);

  // ── Horns (Arthas helmet, curving up and outward)
  lpx(38,  4, 6, 4, ARMOR_DK);
  lpx(34,  8, 6, 4, ARMOR_DK);
  lpx(30, 12, 6, 6, ARMOR_DK);
  lpx(28, 18, 4, 4, ARMOR);
  lpx(84,  4, 6, 4, ARMOR_DK);
  lpx(88,  8, 6, 4, ARMOR_DK);
  lpx(92, 12, 6, 6, ARMOR_DK);
  lpx(96, 18, 4, 4, ARMOR);

  // ── Helm crown spike
  lpx(60,  0, 8, 4, ARMOR_DK);
  lpx(62,  4, 4, 4, ARMOR);

  // ── Helm dome
  lpx(46, 14, 36, 4, ARMOR_DK);
  lpx(42, 18, 44, 6, ARMOR);
  lpx(40, 24, 48, 6, ARMOR_MD);
  lpx(40, 30, 48, 4, ARMOR);
  lpx(40, 34, 48, 2, ARMOR_DK);
  lpx(40, 18, 2, 16, ARMOR_RIM);
  lpx(86, 18, 2, 16, ARMOR_RIM);

  // ── Face cavity + eye glow
  lpx(46, 36, 36, 12, '#000000');
  lpx(50, 40, 8, 4, RUNE);
  lpx(70, 40, 8, 4, RUNE);
  lpx(48, 44, 12, 2, RUNE_DIM);
  lpx(68, 44, 12, 2, RUNE_DIM);

  // ── Helm jaw + gorget
  lpx(46, 46, 36, 4, ARMOR_DK);
  lpx(50, 50, 28, 4, ARMOR_MD);
  lpx(54, 54, 20, 2, ARMOR_DK);
  lpx(54, 56, 20, 4, ARMOR_MD);
  lpx(56, 58, 16, 2, ARMOR_HI);
  lpx(54, 60, 20, 1, ARMOR_RIM);

  // ── Pauldrons with skulls
  lpx(18, 52, 26, 18, ARMOR_DK);
  lpx(20, 54, 24,  4, ARMOR);
  lpx(16, 46,  8,  6, ARMOR_DK);
  lpx(18, 44,  4,  4, ARMOR_DK);
  lpx(22, 56, 16, 12, BONE_MD);
  lpx(24, 58, 12,  8, BONE_LT);
  lpx(26, 60, 3, 3, BONE_DK);
  lpx(31, 60, 3, 3, BONE_DK);
  lpx(26, 64, 8, 1, BONE_MD);
  lpx(18, 68, 26, 2, ARMOR_HI);
  lpx(84, 52, 26, 18, ARMOR_DK);
  lpx(84, 54, 24,  4, ARMOR);
  lpx(104, 46, 8,  6, ARMOR_DK);
  lpx(106, 44, 4,  4, ARMOR_DK);
  lpx(90, 56, 16, 12, BONE_MD);
  lpx(92, 58, 12,  8, BONE_LT);
  lpx(94, 60, 3, 3, BONE_DK);
  lpx(99, 60, 3, 3, BONE_DK);
  lpx(94, 64, 8, 1, BONE_MD);
  lpx(84, 68, 26, 2, ARMOR_HI);

  // ── Chest plate
  lpx(44, 60, 40, 40, ARMOR_DK);
  lpx(46, 62, 36, 36, ARMOR);
  lpx(62, 62, 4, 36, ARMOR_MD);
  lpx(63, 64, 2, 32, RUNE_DIM);
  lpx(63, 70, 2, 4,  RUNE);
  lpx(63, 84, 2, 4,  RUNE);
  lpx(44, 60, 2, 38, ARMOR_HI);
  lpx(82, 60, 2, 38, ARMOR_HI);
  lpx(56, 74, 16, 12, ARMOR_DK);
  lpx(58, 76, 12,  8, BONE_MD);
  lpx(60, 78,  8,  6, BONE_LT);
  lpx(60, 79,  2,  2, BONE_DK);
  lpx(66, 79,  2,  2, BONE_DK);
  lpx(42, 58, 4, 2, ARMOR_RIM);
  lpx(82, 58, 4, 2, ARMOR_RIM);

  // ── Belt
  lpx(40, 100, 48, 6, ARMOR_DK);
  lpx(40, 100, 48, 1, ARMOR_HI);
  lpx(40, 105, 48, 1, ARMOR_HI);
  lpx(58, 101, 12, 4, BONE_MD);
  lpx(60, 102,  8, 2, BONE_LT);
  lpx(61, 102,  2, 2, BONE_DK);
  lpx(65, 102,  2, 2, BONE_DK);

  // ── Arms + gauntlets
  lpx(34, 70, 8, 30, ARMOR_DK);
  lpx(36, 72, 4, 26, ARMOR);
  lpx(32, 96, 14, 14, ARMOR_DK);
  lpx(34, 98, 10, 10, ARMOR_MD);
  lpx(32, 108, 14, 2, ARMOR_HI);
  lpx(86, 70, 8, 30, ARMOR_DK);
  lpx(88, 72, 4, 26, ARMOR);
  lpx(82, 96, 14, 14, ARMOR_DK);
  lpx(84, 98, 10, 10, ARMOR_MD);
  lpx(82, 108, 14, 2, ARMOR_HI);

  // ── Skirt / tassets
  lpx(44, 106, 40, 28, ARMOR_DK);
  lpx(46, 108, 36, 24, ARMOR);
  lpx(56, 108, 1, 24, ARMOR_RIM);
  lpx(72, 108, 1, 24, ARMOR_RIM);
  lpx(48, 128, 2, 2, RUNE);
  lpx(78, 128, 2, 2, RUNE);
  lpx(44, 132, 40, 2, ARMOR_HI);

  // ── Greaves
  lpx(48, 134, 12, 28, ARMOR_DK);
  lpx(50, 136,  8, 24, ARMOR);
  lpx(48, 158, 12,  2, ARMOR_HI);
  lpx(68, 134, 12, 28, ARMOR_DK);
  lpx(70, 136,  8, 24, ARMOR);
  lpx(68, 158, 12,  2, ARMOR_HI);

  // ── Sabatons
  lpx(44, 162, 16, 16, ARMOR_DK);
  lpx(46, 164, 12, 12, ARMOR);
  lpx(44, 174, 16,  4, ARMOR_MD);
  lpx(40, 174,  6,  4, ARMOR_DK);
  lpx(68, 162, 16, 16, ARMOR_DK);
  lpx(70, 164, 12, 12, ARMOR);
  lpx(68, 174, 16,  4, ARMOR_MD);
  lpx(82, 174,  6,  4, ARMOR_DK);

  // ── Frost mist + ice spikes around feet
  lpx(36, 178, 4, 4, FROST_DIM);
  lpx(40, 180, 4, 6, FROST);
  lpx(46, 178, 4, 6, FROST_DIM);
  lpx(52, 182, 4, 4, FROST);
  lpx(60, 184, 8, 2, FROST_DIM);
  lpx(72, 182, 4, 4, FROST);
  lpx(78, 178, 4, 6, FROST_DIM);
  lpx(84, 180, 4, 6, FROST);
  lpx(88, 178, 4, 4, FROST_DIM);
  lpx(30, 186, 68, 2, FROST_DIM);
  lpx(38, 188, 52, 2, FROST);
  lpx(28, 184, 2, 4, FROST);
  lpx(98, 184, 2, 4, FROST);
  lpx(34, 188, 2, 2, FROST);
  lpx(94, 188, 2, 2, FROST);

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
