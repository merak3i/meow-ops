// RoomDrawer.tsx — room selector showing unlock status and time-gated progress.

import { ROOM_LIST } from '@/lib/companion-rooms';
import type { CatState } from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RoomDrawerProps {
  open:       boolean;
  onClose:    () => void;
  cat:        CatState | null;
  onSetRoom:  (roomKey: string) => void;
}

// ─── Tier HDRI preview colors (match CompanionScene presets) ─────────────────
const ROOM_ACCENT: Record<number, string> = {
  1: '#c8a060',
  2: '#8060c8',
  3: '#c87040',
  4: '#40c880',
  5: '#6080c8',
  6: '#c04040',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function RoomDrawer({ open, onClose, cat, onSetRoom }: RoomDrawerProps) {
  if (!open || !cat) return null;

  const daysAdopted   = Math.floor((Date.now() - new Date(cat.adoptedAt).getTime()) / 86_400_000);
  const unlockedRooms = cat.inventory.unlockedRooms ?? [];
  const currentRoom   = cat.room?.key ?? 'corner_mat';

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
          maxWidth:     580,
          maxHeight:    '65vh',
          overflowY:    'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16 }}>🏠 Living space</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Day {daysAdopted} with {cat.name} · {unlockedRooms.length}/{ROOM_LIST.length} rooms unlocked
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ROOM_LIST.map((room) => {
            const isUnlocked = unlockedRooms.includes(room.key);
            const isCurrent  = currentRoom === room.key;
            const daysLeft   = Math.max(0, room.unlockDays - daysAdopted);
            const accent     = ROOM_ACCENT[room.tier] ?? 'var(--accent)';

            return (
              <button
                key={room.key}
                onClick={() => { if (isUnlocked) onSetRoom(room.key); }}
                disabled={!isUnlocked}
                style={{
                  display:     'flex',
                  alignItems:  'center',
                  gap:         14,
                  padding:     '12px 14px',
                  border:      `2px solid ${isCurrent ? accent : isUnlocked ? 'var(--border-hover)' : 'var(--border)'}`,
                  borderRadius: 8,
                  background:  isCurrent ? `${accent}18` : 'var(--bg-page)',
                  cursor:      isUnlocked ? 'pointer' : 'not-allowed',
                  opacity:     isUnlocked ? 1 : 0.5,
                  textAlign:   'left',
                  transition:  'all 0.15s',
                }}
              >
                {/* Color swatch */}
                <div style={{
                  width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                  background: `linear-gradient(135deg, ${accent}88, ${accent}22)`,
                  border: `2px solid ${accent}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  {room.tier <= 1 ? '🪵' : room.tier === 2 ? '🛋️' : room.tier === 3 ? '🏡' :
                   room.tier === 4 ? '🌳' : room.tier === 5 ? '🏰' : '👑'}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: isCurrent ? 600 : 400 }}>
                      {room.label}
                    </span>
                    {isCurrent && (
                      <span style={{ fontSize: 9, color: accent, fontWeight: 700, textTransform: 'uppercase' }}>current</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{room.description}</div>
                </div>

                <div style={{ fontSize: 10, color: isUnlocked ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>
                  {isUnlocked ? 'Unlocked' : `${daysLeft}d left`}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
