// WardrobeDrawer.tsx — accessories shop + equip/unequip.

import { COMPANION_ACCESSORIES, TIER_COLOR, TIER_RANK } from '@/lib/companion-accessories';
import type { CatState } from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface WardrobeDrawerProps {
  open:       boolean;
  onClose:    () => void;
  cat:        CatState | null;
  onToggle:   (key: string) => void;
  onPurchase: (key: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WardrobeDrawer({ open, onClose, cat, onToggle, onPurchase }: WardrobeDrawerProps) {
  if (!open || !cat) return null;

  const owned    = cat.inventory.accessories ?? [];
  const equipped = cat.appearance.equippedAccessories ?? [];
  const shine    = cat.stats.shine;

  const allAccessories = Object.values(COMPANION_ACCESSORIES).sort((a, b) => {
    const rankA = TIER_RANK[a.tier as keyof typeof TIER_RANK] ?? 0;
    const rankB = TIER_RANK[b.tier as keyof typeof TIER_RANK] ?? 0;
    return rankA - rankB;
  });

  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      display:        'flex',
      alignItems:     'flex-end',
      justifyContent: 'center',
      background:     'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      zIndex:         150,
    }} onClick={onClose}>
      <div
        style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border)',
          borderRadius: '12px 12px 0 0',
          padding:      '20px 24px 32px',
          width:        '100%',
          maxWidth:     640,
          maxHeight:    '70vh',
          overflowY:    'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16 }}>👒 Wardrobe</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Shine: {shine.toFixed(0)} · {equipped.length} equipped
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {allAccessories.map((acc) => {
            const isOwned    = owned.includes(acc.key);
            const isEquipped = equipped.includes(acc.key);
            const canAfford  = shine >= acc.cost;
            const tierColor  = TIER_COLOR[acc.tier as keyof typeof TIER_COLOR] ?? 'var(--text-muted)';

            return (
              <button
                key={acc.key}
                onClick={() => {
                  if (isOwned) onToggle(acc.key);
                  else if (canAfford) onPurchase(acc.key);
                }}
                disabled={!isOwned && !canAfford}
                style={{
                  display:       'flex',
                  flexDirection: 'column',
                  alignItems:    'center',
                  gap:           4,
                  padding:       '10px 8px',
                  border:        `2px solid ${isEquipped ? tierColor : isOwned ? 'var(--border-hover)' : 'var(--border)'}`,
                  borderRadius:  8,
                  background:    isEquipped ? `${tierColor}18` : isOwned ? 'var(--bg-hover)' : 'var(--bg-page)',
                  cursor:        (!isOwned && !canAfford) ? 'not-allowed' : 'pointer',
                  opacity:       (!isOwned && !canAfford) ? 0.45 : 1,
                  transition:    'all 0.15s',
                  position:      'relative',
                }}
              >
                {/* Tier badge */}
                <span style={{ fontSize: 9, color: tierColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {acc.tier}
                </span>

                {/* Colour swatch */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: acc.color,
                  border: `2px solid ${tierColor}`,
                }} />

                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>
                  {acc.label}
                </span>

                {/* Lore */}
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
                  {acc.lore}
                </span>

                {/* State indicator */}
                <span style={{ fontSize: 10, marginTop: 2, color: isEquipped ? tierColor : isOwned ? 'var(--green)' : 'var(--text-muted)' }}>
                  {isEquipped ? '✓ Equipped' : isOwned ? 'Owned — equip' : `✦ ${acc.cost} shine`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
