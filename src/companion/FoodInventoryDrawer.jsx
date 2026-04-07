import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { FOOD_LIST, TIER_LABELS, TIER_COLORS } from '../lib/companion-foods';

// Image probe cache — checks if /companion/foods/{key}.png exists
const foodImageCache = new Map();

function probeFoodImage(key) {
  if (foodImageCache.has(key)) return foodImageCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = `/companion/foods/${key}.png`;
  });
  foodImageCache.set(key, p);
  return p;
}

// Tier glow styling
const TIER_GLOW = {
  1: 'none',
  2: '0 0 10px rgba(127, 207, 229, 0.3)',
  3: '0 0 12px rgba(92, 195, 90, 0.35)',
  4: '0 0 16px rgba(255, 193, 70, 0.4)',
  5: '0 0 22px rgba(180, 130, 255, 0.5)',
};

const TIER_BORDER = {
  1: 'var(--border)',
  2: 'rgba(127, 207, 229, 0.4)',
  3: 'rgba(92, 195, 90, 0.4)',
  4: 'rgba(255, 193, 70, 0.45)',
  5: 'rgba(180, 130, 255, 0.55)',
};

export default function FoodInventoryDrawer({ open, onClose, cat, onFeed }) {
  if (!cat) return null;
  const inv = cat.inventory.foods || {};
  const ownedFoods = FOOD_LIST.filter((f) => (inv[f.key] || 0) > 0);

  const [foodImages, setFoodImages] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all(
      FOOD_LIST.map((f) => probeFoodImage(f.key).then((ok) => [f.key, ok]))
    ).then((results) => {
      if (!alive) return;
      const m = {};
      results.forEach(([k, ok]) => { m[k] = ok; });
      setFoodImages(m);
    });
    return () => { alive = false; };
  }, []);

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
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              zIndex: 100,
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
              maxHeight: '70vh',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 24,
              zIndex: 101,
              overflow: 'auto',
              boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 300, color: 'var(--text-primary)' }}>Pantry</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Earned by completing real coding sessions
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {ownedFoods.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No food yet. Complete some Claude Code sessions and click <b>Refresh data</b> in the sidebar.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 12,
                }}
              >
                {ownedFoods.map((f) => {
                  const count = inv[f.key];
                  const hasPng = foodImages[f.key];
                  return (
                    <motion.button
                      key={f.key}
                      onClick={() => onFeed(f.key)}
                      whileHover={{ y: -2 }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 6,
                        padding: 14,
                        background: 'var(--bg-page)',
                        border: `1px solid ${TIER_BORDER[f.tier]}`,
                        borderRadius: 10,
                        cursor: 'pointer',
                        transition: 'all 0.3s var(--ease)',
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        boxShadow: TIER_GLOW[f.tier],
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        {hasPng ? (
                          <img
                            src={`/companion/foods/${f.key}.png`}
                            alt={f.label}
                            width={48}
                            height={48}
                            style={{ objectFit: 'contain', borderRadius: 6 }}
                            draggable={false}
                          />
                        ) : (
                          <span style={{ fontSize: 28 }}>{f.icon}</span>
                        )}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: TIER_COLORS[f.tier],
                            background: 'var(--bg-hover)',
                            padding: '2px 8px',
                            borderRadius: 99,
                          }}
                        >
                          ×{count}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 400 }}>{f.label}</div>
                      <div
                        style={{
                          fontSize: 9,
                          color: TIER_COLORS[f.tier],
                          textTransform: 'uppercase',
                          letterSpacing: 0.7,
                        }}
                      >
                        {TIER_LABELS[f.tier]}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        {Object.entries(f.effect).map(([k, v]) => `${k} +${v}`).join(' · ')}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
