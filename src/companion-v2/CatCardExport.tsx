// CatCardExport.tsx — Exports the companion as a shareable PNG card.
// Captures the WebGL canvas, overlays name/breed/stats with canvas2D,
// then triggers a PNG download.

import type { CatState, PersonalityTrait } from './useCompanionGame';
import type { DeveloperProfile } from '@/types/session';

// ─── Export function ──────────────────────────────────────────────────────────

export function exportCatCard(
  viewportEl: HTMLDivElement | null,
  cat: CatState,
  profile: DeveloperProfile,
  trait: PersonalityTrait | null,
): void {
  if (!viewportEl) return;

  const glCanvas = viewportEl.querySelector<HTMLCanvasElement>('canvas');
  if (!glCanvas) {
    console.warn('[CatCard] WebGL canvas not found in viewport');
    return;
  }

  let imgData: string;
  try {
    imgData = glCanvas.toDataURL('image/png');
  } catch {
    console.warn('[CatCard] toDataURL failed — preserveDrawingBuffer may be false');
    return;
  }

  const W = 800;
  const H = 600;

  const overlay = document.createElement('canvas');
  overlay.width  = W;
  overlay.height = H;
  const ctx = overlay.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = imgData;
  img.onload = () => {
    // Background frame
    ctx.drawImage(img, 0, 0, W, H);

    // Bottom info bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, H - 130, W, 130);

    // Left column: name + breed
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 26px "JetBrains Mono", monospace';
    ctx.fillText(cat.name, 24, H - 90);

    ctx.fillStyle = '#aaaaaa';
    ctx.font      = '14px "JetBrains Mono", monospace';
    ctx.fillText(
      `${cat.breed.replace('youngAdult', 'Young Adult')} · ${cat.lifeStage} · ${cat.streakDays}d streak`,
      24,
      H - 68,
    );

    // Analytics row
    const totalM = (profile.total_tokens / 1_000_000).toFixed(1);
    ctx.fillText(`${totalM}M tokens · $${profile.total_cost_usd.toFixed(2)} · ${profile.total_sessions} sessions`, 24, H - 46);

    // Trait badge
    if (trait) {
      ctx.fillStyle = trait.color;
      ctx.font      = '13px "JetBrains Mono", monospace';
      ctx.fillText(`${trait.badge} ${trait.name}`, 24, H - 22);
    }

    // Stat bars (right side)
    const statEntries: [string, number][] = [
      ['H', cat.stats.hunger],
      ['E', cat.stats.energy],
      ['♥', cat.stats.happiness],
      ['✚', cat.stats.health],
      ['✦', cat.stats.shine],
    ];
    const barX = W - 160;
    const barW = 140;
    statEntries.forEach(([label, val], i) => {
      const y = H - 116 + i * 22;
      ctx.fillStyle = '#666';
      ctx.fillRect(barX, y, barW, 8);
      const pct = Math.max(0, Math.min(100, val));
      ctx.fillStyle = pct < 25 ? '#f87171' : pct < 50 ? '#fbbf24' : '#4ade80';
      ctx.fillRect(barX, y, barW * pct / 100, 8);
      ctx.fillStyle = '#aaa';
      ctx.font      = '10px monospace';
      ctx.fillText(label, barX - 14, y + 8);
    });

    // meow-ops watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font      = '11px monospace';
    const wm = 'meow-ops';
    ctx.fillText(wm, W - ctx.measureText(wm).width - 14, H - 12);

    // Download
    const a       = document.createElement('a');
    a.download    = `${cat.name.toLowerCase().replace(/\s+/g, '-')}-companion-card.png`;
    a.href        = overlay.toDataURL('image/png');
    a.click();
  };

  img.onerror = () => {
    console.warn('[CatCard] Failed to load captured frame');
  };
}
