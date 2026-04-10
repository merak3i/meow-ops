// FarewellOverlay.tsx — shown when cat.status === 'lost' (ran away).

import { COMPANION_BREEDS } from '@/lib/companion-breeds';
import type { CatState } from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FarewellOverlayProps {
  cat:    CatState;
  onBury: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FarewellOverlay({ cat, onBury }: FarewellOverlayProps) {
  const breedData = COMPANION_BREEDS[cat.breed as keyof typeof COMPANION_BREEDS];

  const adoptedMs = new Date(cat.adoptedAt).getTime();
  const lastFedMs = new Date(cat.lastFedAt).getTime();
  const daysTogether = Math.max(1, Math.floor((lastFedMs - adoptedMs) / 86_400_000));

  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'rgba(0,0,0,0.82)',
      backdropFilter: 'blur(12px) grayscale(100%)',
      zIndex:         300,
    }}>
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border)',
        borderRadius: 16,
        padding:      '40px 36px',
        maxWidth:     460,
        width:        '88vw',
        textAlign:    'center',
        display:      'flex',
        flexDirection:'column',
        gap:          18,
        filter:       'grayscale(0.7)',
      }}>
        {/* Greyscale cat emoji */}
        <div style={{ fontSize: 56, filter: 'grayscale(1)' }}>🐾</div>

        <div>
          <h2 style={{ fontSize: 20, fontWeight: 300, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            {cat.name} is gone
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
            They waited as long as they could. After {daysTogether} day{daysTogether !== 1 ? 's' : ''} together,
            {breedData ? ` your ${breedData.label}` : ' your companion'} couldn't wait any longer.
          </p>
        </div>

        {/* Stats card */}
        <div style={{
          background:   'var(--bg-page)',
          border:       '1px solid var(--border)',
          borderRadius: 8,
          padding:      '12px 16px',
          fontSize:     11,
          color:        'var(--text-muted)',
          lineHeight:   1.8,
          textAlign:    'left',
        }}>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Name:</strong> {cat.name}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Breed:</strong> {breedData?.label ?? cat.breed}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Life stage:</strong> {cat.lifeStage}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Days together:</strong> {daysTogether}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Growth XP:</strong> {cat.growthXP}</div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          They are remembered. You can adopt a new companion whenever you're ready.
        </p>

        <button
          onClick={onBury}
          style={{
            padding:      '12px 0',
            background:   'transparent',
            border:       '1px solid var(--border)',
            borderRadius: 8,
            color:        'var(--text-secondary)',
            fontSize:     13,
            cursor:       'pointer',
            fontFamily:   'inherit',
            transition:   'all 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
          }}
        >
          🌿 Lay them to rest & adopt a new companion
        </button>
      </div>
    </div>
  );
}
