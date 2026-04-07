import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Check, Sparkles } from 'lucide-react';
import { ACCESSORY_LIST, TIER_COLOR, TIER_GLOW, TIER_RANK } from '../lib/companion-accessories';
import CompanionCat from './CompanionCat';

export default function AccessoryWardrobe({ open, onClose, cat, onPurchase, onToggle }) {
  if (!cat) return null;
  const owned = new Set(cat.inventory.accessories || []);
  const equipped = new Set(cat.appearance?.equippedAccessories || []);
  const shine = cat.stats.shine;

  const sorted = [...ACCESSORY_LIST].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.cost - b.cost);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 100,
            }}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            style={{
              position: 'fixed',
              left: 'calc(var(--sidebar-w) + 24px)',
              right: 24,
              bottom: 24,
              maxHeight: '78vh',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 24,
              zIndex: 101,
              overflow: 'auto',
              boxShadow: '0 32px 80px rgba(0,0,0,0.65)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 300, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
                  Wardrobe of the Old Gods
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Adornments won from long nights of focus. Equipped items passively feed their stat.
                </div>
                <div style={{ fontSize: 13, color: 'var(--purple)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={13} />
                  Shine balance: {Math.floor(shine)}
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent', border: '1px solid var(--border)', borderRadius: 8,
                  width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 14,
              }}
            >
              {sorted.map((a) => (
                <AccessoryCard
                  key={a.key}
                  acc={a}
                  cat={cat}
                  owned={owned.has(a.key)}
                  equipped={equipped.has(a.key)}
                  canAfford={shine >= a.cost}
                  onClick={() => {
                    if (owned.has(a.key)) onToggle(a.key);
                    else if (shine >= a.cost) onPurchase(a.key);
                  }}
                />
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Individual accessory card — renders the cat WITH that accessory equipped
// as a preview, plus lore, passives, and purchase state.
function AccessoryCard({ acc, cat, owned, equipped, canAfford, onClick }) {
  // Preview cat: same breed, base appearance, overriding equipped to just this one accessory
  const previewCat = {
    ...cat,
    id: `preview-${acc.key}`,
    appearance: {
      ...cat.appearance,
      equippedAccessories: [acc.key],
      sizeMultiplier: 0.7,
      weight: 'normal',
      furQuality: 'normal',
    },
    stats: { hunger: 100, energy: 100, happiness: 100, health: 100, shine: 0 },
    growthXP: 300,
  };

  const clickable = owned || canAfford;
  return (
    <motion.button
      onClick={onClick}
      whileHover={clickable ? { y: -2 } : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 0,
        padding: 0,
        background: equipped ? 'var(--bg-hover)' : 'var(--bg-page)',
        border: '1px solid ' + (equipped ? 'var(--accent)' : 'var(--border)'),
        borderRadius: 12,
        cursor: clickable ? 'pointer' : 'not-allowed',
        transition: 'all 0.3s var(--ease)',
        textAlign: 'left',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        opacity: clickable ? 1 : 0.55,
        overflow: 'hidden',
        boxShadow: equipped ? TIER_GLOW[acc.tier] : 'none',
      }}
    >
      {/* Preview stage */}
      <div
        style={{
          width: '100%',
          height: 150,
          position: 'relative',
          background: `radial-gradient(ellipse at center bottom, rgba(255,255,255,0.04), var(--bg-page))`,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div style={{ transform: 'translateY(20px)', pointerEvents: 'none' }}>
          <CompanionCat cat={previewCat} mood="healthy" size={160} />
        </div>
        {/* State badge */}
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          {equipped ? (
            <Check size={16} color="var(--accent)" />
          ) : owned ? (
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '3px 8px', background: 'rgba(0,0,0,0.5)', borderRadius: 99 }}>
              Owned
            </span>
          ) : !canAfford ? (
            <Lock size={14} color="var(--text-muted)" />
          ) : null}
        </div>
        {/* Tier chip */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            fontSize: 9,
            color: TIER_COLOR[acc.tier],
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            padding: '3px 8px',
            background: 'rgba(0,0,0,0.5)',
            border: `1px solid ${TIER_COLOR[acc.tier]}`,
            borderRadius: 99,
            fontWeight: 500,
          }}
        >
          {acc.tier}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.3 }}>{acc.label}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>
          {acc.lore}
        </div>
        {acc.passive && Object.keys(acc.passive).length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              marginTop: 4,
            }}
          >
            {Object.entries(acc.passive).map(([stat, amt]) => (
              <span
                key={stat}
                style={{
                  fontSize: 9,
                  padding: '2px 6px',
                  background: 'rgba(124, 199, 79, 0.12)',
                  color: 'var(--green)',
                  borderRadius: 4,
                  fontFamily: 'var(--font-mono, monospace)',
                  textTransform: 'capitalize',
                }}
              >
                +{amt}/hr {stat}
              </span>
            ))}
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            marginTop: 6,
            color: owned ? (equipped ? 'var(--accent)' : 'var(--text-secondary)') : 'var(--purple)',
            fontWeight: 500,
          }}
        >
          {owned ? (equipped ? 'Equipped — click to remove' : 'Click to equip') : `${acc.cost} shine`}
        </div>
      </div>
    </motion.button>
  );
}
