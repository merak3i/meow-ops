// FoodDrawer.tsx — slide-up drawer showing food inventory.

import { COMPANION_FOODS, TIER_LABELS, TIER_COLORS } from '@/lib/companion-foods';
import type { CatState } from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoodDrawerProps {
  open:     boolean;
  onClose:  () => void;
  cat:      CatState | null;
  onFeed:   (foodKey: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FoodDrawer({ open, onClose, cat, onFeed }: FoodDrawerProps) {
  if (!open || !cat) return null;

  const inventory = cat.inventory.foods ?? {};
  const owned = Object.entries(inventory).filter(([, qty]) => qty > 0);

  return (
    <div style={{
      position:        'fixed',
      inset:           0,
      display:         'flex',
      alignItems:      'flex-end',
      justifyContent:  'center',
      background:      'rgba(0,0,0,0.6)',
      backdropFilter:  'blur(4px)',
      zIndex:          150,
    }} onClick={onClose}>
      <div
        style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border)',
          borderRadius: '12px 12px 0 0',
          padding:      '20px 24px 32px',
          width:        '100%',
          maxWidth:     560,
          maxHeight:    '60vh',
          overflowY:    'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16 }}>🍖 Food inventory</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Hunger: {cat.stats.hunger.toFixed(0)} · {owned.length} types available
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }}>✕</button>
        </div>

        {owned.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
            No food in inventory. Complete AI sessions to earn food rewards.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {owned.map(([key, qty]) => {
              const food = COMPANION_FOODS[key as keyof typeof COMPANION_FOODS];
              if (!food) return null;
              const tierColor = TIER_COLORS[food.tier as keyof typeof TIER_COLORS] ?? 'var(--text-muted)';
              const tierLabel = TIER_LABELS[food.tier as keyof typeof TIER_LABELS] ?? '';
              return (
                <button
                  key={key}
                  onClick={() => onFeed(key)}
                  style={{
                    display:       'flex',
                    flexDirection: 'column',
                    alignItems:    'center',
                    gap:           4,
                    padding:       '10px 8px',
                    border:        '1px solid var(--border)',
                    borderRadius:  8,
                    background:    'var(--bg-page)',
                    cursor:        'pointer',
                    transition:    'all 0.15s',
                    position:      'relative',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-page)';
                  }}
                >
                  {/* Quantity badge */}
                  <span style={{
                    position:    'absolute', top: 4, right: 6,
                    fontSize:    9, color: tierColor,
                    fontFamily:  'JetBrains Mono, monospace', fontWeight: 700,
                  }}>×{qty}</span>

                  <span style={{ fontSize: 26 }}>{food.icon}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>{food.label}</span>
                  <span style={{ fontSize: 9, color: tierColor }}>{tierLabel}</span>

                  {/* Effects */}
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.5, textAlign: 'center' }}>
                    {Object.entries(food.effect ?? {}).map(([stat, val]) => (
                      <div key={stat}>{stat} +{val}</div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
