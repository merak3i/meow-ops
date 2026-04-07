import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Check } from 'lucide-react';
import { ACCESSORY_LIST, TIER_COLOR } from '../lib/companion-accessories';

export default function AccessoryWardrobe({ open, onClose, cat, onPurchase, onToggle }) {
  if (!cat) return null;
  const owned = new Set(cat.inventory.accessories || []);
  const equipped = new Set(cat.appearance?.equippedAccessories || []);
  const shine = cat.stats.shine;

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
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 100,
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
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 300, color: 'var(--text-primary)' }}>Wardrobe</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Shine balance: <span style={{ color: 'var(--purple)' }}>{Math.floor(shine)}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent', border: '1px solid var(--border)', borderRadius: 8,
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {ACCESSORY_LIST.map((a) => {
                const isOwned = owned.has(a.key);
                const isEquipped = equipped.has(a.key);
                const canAfford = shine >= a.cost;
                return (
                  <button
                    key={a.key}
                    onClick={() => (isOwned ? onToggle(a.key) : canAfford ? onPurchase(a.key) : null)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: 14,
                      background: isEquipped ? 'var(--bg-hover)' : 'var(--bg-page)',
                      border: '1px solid ' + (isEquipped ? 'var(--accent)' : 'var(--border)'),
                      borderRadius: 10,
                      cursor: !isOwned && !canAfford ? 'not-allowed' : 'pointer',
                      transition: 'all 0.3s var(--ease)',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      opacity: !isOwned && !canAfford ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <div
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: a.color, border: '1px solid var(--border)',
                        }}
                      />
                      {isOwned ? (
                        isEquipped ? <Check size={14} color="var(--accent)" /> : null
                      ) : !canAfford ? (
                        <Lock size={14} color="var(--text-muted)" />
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 9, color: TIER_COLOR[a.tier], textTransform: 'uppercase', letterSpacing: 0.6 }}>
                      {a.tier}
                    </div>
                    <div style={{ fontSize: 11, color: isOwned ? 'var(--text-muted)' : 'var(--purple)' }}>
                      {isOwned ? (isEquipped ? 'Equipped' : 'Owned') : `${a.cost} shine`}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
