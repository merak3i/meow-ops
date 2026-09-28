// Pixel-art texture builders for the Scrying Sanctum.
//
// Lazy-singleton CanvasTextures generated at first use, then cached. Cheaper
// than custom GLSL, plays nice with existing meshBasicMaterial, and keeps
// the "no external assets" promise of D1-D4. Pulled out of the monolithic
// ScryingSanctum.tsx so future texture work (new champion classes, banner
// variants, ground decals) lives here without bloating the main file.
//
//   getShadowTexture()       — soft radial alpha for the champion shadows
//   getMarbleTexture()       — graphite stone with teal and copper seams
//   buildClassTexture()      — per-cat-type 4-frame walk cycle
//                              for every champion class

import * as THREE from 'three';
import { drawArchiveSealVector } from './archive-seal-mark';

// ─── Cache ───────────────────────────────────────────────────────────────────

type WalkTextures = [THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture];
const TEXTURE_CACHE = new Map<string, WalkTextures>();

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

  // Pale green-gray limestone keeps the archive floor visible beneath the roster.
  ctx.fillStyle = '#73796f';
  ctx.fillRect(0, 0, 512, 512);
  const baseGrad = ctx.createRadialGradient(256, 236, 20, 256, 256, 330);
  baseGrad.addColorStop(0, 'rgba(225,217,191,0.16)');
  baseGrad.addColorStop(0.55, 'rgba(91,108,96,0.08)');
  baseGrad.addColorStop(1, 'rgba(34,43,39,0.12)');
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
    grad.addColorStop(0, isLight ? 'rgba(230,226,207,0.08)' : 'rgba(20,30,28,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // A staggered limestone block pattern gives the civic archive a grounded floor.
  const tileSize = 64;
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(28,37,32,0.24)';
  for (let row = 0; row < 8; row += 1) {
    const rowOffset = row % 2 === 0 ? 0 : tileSize / 2;
    for (let col = -1; col < 9; col += 1) {
      ctx.strokeRect(col * tileSize + rowOffset, row * tileSize, tileSize, tileSize);
    }
  }

  // Copper / teal seams — thin curved lines tracing through the
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
    const vein = i % 4 === 0 ? '100,229,194' : '215,164,99';
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

  // Sparse mineral sheen adds surface variation without making the floor glossy.
  for (let i = 0; i < 10; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 46 + rand() * 64;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, i % 3 === 0 ? 'rgba(100,229,194,0.035)' : 'rgba(215,164,99,0.04)');
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


// ─── Champion class textures ─────────────────────────────────────────────────
//
// Per cat_type, returns four CanvasTextures (contact, down, passing, up) with the
// signature character pose for each class. Cached per cat_type so a 50-agent
// run group still only rasterises 7 sprite pairs total. Each `case` below
// Draw the original seven-cat session silhouettes.

const SESSION_CAT_STYLE: Record<string, { fur: string; shade: string; eye: string; accent: string; mark: string }> = {
  builder:     { fur: '#bc7543', shade: '#70482e', eye: '#f5d891', accent: '#d7a463', mark: 'belt' },
  detective:   { fur: '#263638', shade: '#101b1d', eye: '#9cebd8', accent: '#64e5c2', mark: 'lens' },
  commander:   { fur: '#a75d4d', shade: '#633d38', eye: '#f5d891', accent: '#ef705e', mark: 'orb' },
  architect:   { fur: '#344247', shade: '#172327', eye: '#9cebd8', accent: '#64e5c2', mark: 'index' },
  guardian:    { fur: '#496a75', shade: '#273e47', eye: '#d7f3ff', accent: '#64e5c2', mark: 'shield' },
  storyteller: { fur: '#a9a38f', shade: '#625f55', eye: '#f5d891', accent: '#d7a463', mark: 'staff' },
  ghost:       { fur: '#67777a', shade: '#39474a', eye: '#ef9a81', accent: '#64e5c2', mark: 'seam' },
};

export function buildClassTexture(catType: string): WalkTextures {
  const cacheKey = `session-cats:${catType}`;
  const cached = TEXTURE_CACHE.get(cacheKey);
  if (cached) return cached;
  const style = SESSION_CAT_STYLE[catType] ?? SESSION_CAT_STYLE.ghost!;
  const W = 128, H = 192;
  const draw = (phase: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const bob = phase === 1 ? 4 : phase === 3 ? -3 : 0;
    const leftFoot = phase < 2 ? 112 : 120;
    const rightFoot = phase < 2 ? 120 : 112;
    // Tail, body, head, ears: a readable cat silhouette at 40px display size.
    px(ctx, 88, 84 + bob, 24, 12, style.shade); px(ctx, 104, 72 + bob, 10, 28, style.shade);
    px(ctx, 34, 58 + bob, 60, 72, style.fur); px(ctx, 40, 28 + bob, 50, 46, style.fur);
    px(ctx, 38, 14 + bob, 14, 24, style.fur); px(ctx, 78, 14 + bob, 14, 24, style.fur);
    px(ctx, 45, 16 + bob, 8, 16, style.shade); px(ctx, 77, 16 + bob, 8, 16, style.shade);
    px(ctx, 49, 44 + bob, 9, 7, style.eye); px(ctx, 72, 44 + bob, 9, 7, style.eye);
    px(ctx, 61, 55 + bob, 8, 5, '#231820'); px(ctx, 58, 61 + bob, 14, 3, style.shade);
    px(ctx, 42, 76 + bob, 10, 36, style.shade); px(ctx, 78, 76 + bob, 10, 36, style.shade);
    px(ctx, 40, leftFoot + bob, 22, 18, style.fur); px(ctx, 68, rightFoot + bob, 22, 18, style.fur);
    // One profession prop per silhouette; all are original, compact signals.
    if (style.mark === 'belt') { px(ctx, 35, 91 + bob, 58, 8, style.accent); px(ctx, 58, 89 + bob, 12, 12, '#3d2b20'); }
    if (style.mark === 'lens') { ctx.strokeStyle = style.accent; ctx.lineWidth = 4; ctx.strokeRect(68, 40 + bob, 18, 15); }
    if (style.mark === 'orb') { ctx.fillStyle = style.accent; ctx.beginPath(); ctx.arc(101, 70 + bob, 10, 0, Math.PI * 2); ctx.fill(); }
    if (style.mark === 'index') { px(ctx, 78, 83 + bob, 18, 5, style.accent); px(ctx, 84, 76 + bob, 8, 20, style.accent); }
    if (style.mark === 'shield') { px(ctx, 19, 76 + bob, 20, 34, style.accent); px(ctx, 25, 82 + bob, 8, 18, '#d7f3ff'); }
    if (style.mark === 'staff') { px(ctx, 99, 38 + bob, 6, 88, '#70543a'); px(ctx, 96, 32 + bob, 12, 12, style.accent); }
    if (style.mark === 'seam') { px(ctx, 64, 30 + bob, 3, 96, style.accent); px(ctx, 58, 74 + bob, 15, 3, style.accent); }
    drawArchiveSealVector(ctx, 64, 86 + bob, 32, '#172327');
    addOutline(ctx, W, H);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return tex;
  };
  const result: WalkTextures = [draw(0), draw(1), draw(2), draw(3)];
  TEXTURE_CACHE.set(cacheKey, result);
  return result;
}
