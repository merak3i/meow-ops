import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Check } from 'lucide-react';
import { ROOM_LIST } from '../lib/companion-rooms';

export default function RoomDecorator({ open, onClose, cat, onSetRoom }) {
  if (!cat) return null;
  const unlocked = new Set(cat.inventory.unlockedRooms || []);
  const current = cat.room?.key;
  const adopted = new Date(cat.adoptedAt).getTime();
  const days = Math.floor((Date.now() - adopted) / 86_400_000);

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
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 300, color: 'var(--text-primary)' }}>Living Space</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Day {days} together
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {ROOM_LIST.map((r) => {
                const isUnlocked = unlocked.has(r.key);
                const isCurrent = current === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => isUnlocked && onSetRoom(r.key)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: 0,
                      background: isCurrent ? 'var(--bg-hover)' : 'var(--bg-page)',
                      border: '1px solid ' + (isCurrent ? 'var(--accent)' : 'var(--border)'),
                      borderRadius: 12,
                      cursor: isUnlocked ? 'pointer' : 'not-allowed',
                      transition: 'all 0.3s var(--ease)',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      opacity: isUnlocked ? 1 : 0.55,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: 80,
                        background: `radial-gradient(ellipse at center bottom, ${r.palette.accent} 0%, ${r.palette.base} 80%)`,
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.4) 100%)',
                        }}
                      />
                      {!isUnlocked && (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <Lock size={20} />
                        </div>
                      )}
                      {isCurrent && (
                        <div style={{ position: 'absolute', top: 8, right: 8, color: 'var(--accent)' }}>
                          <Check size={16} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '12px 14px 14px', width: '100%' }}>
                      <div style={{ fontSize: 14 }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                        {r.description}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                        {isUnlocked ? `Tier ${r.tier}` : `Unlocks day ${r.unlockDays}`}
                      </div>
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
