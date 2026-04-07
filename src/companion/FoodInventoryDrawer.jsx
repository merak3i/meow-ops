import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { COMPANION_FOODS, FOOD_LIST, TIER_LABELS, TIER_COLORS } from '../lib/companion-foods';

export default function FoodInventoryDrawer({ open, onClose, cat, onFeed }) {
  if (!cat) return null;
  const inv = cat.inventory.foods || {};
  const ownedFoods = FOOD_LIST.filter((f) => (inv[f.key] || 0) > 0);

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
                  return (
                    <button
                      key={f.key}
                      onClick={() => onFeed(f.key)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 6,
                        padding: 14,
                        background: 'var(--bg-page)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        cursor: 'pointer',
                        transition: 'all 0.3s var(--ease)',
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span style={{ fontSize: 22 }}>{f.icon}</span>
                        <span style={{ fontSize: 11, color: TIER_COLORS[f.tier] }}>
                          ×{count}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 400 }}>{f.label}</div>
                      <div
                        style={{
                          fontSize: 9,
                          color: TIER_COLORS[f.tier],
                          textTransform: 'uppercase',
                          letterSpacing: 0.6,
                        }}
                      >
                        {TIER_LABELS[f.tier]}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {Object.entries(f.effect).map(([k, v]) => `${k}+${v}`).join(' · ')}
                      </div>
                    </button>
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
