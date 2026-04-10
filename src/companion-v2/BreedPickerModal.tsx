// BreedPickerModal.tsx — first-time adoption flow.
// Shown when no companion has been adopted yet.

import { useState } from 'react';
import { COMPANION_BREEDS } from '@/lib/companion-breeds';

// ─── Props ────────────────────────────────────────────────────────────────────

interface BreedPickerModalProps {
  onAdopt: (breed: string, name: string) => void;
}

// ─── Breed card ───────────────────────────────────────────────────────────────

function BreedCard({
  breedKey,
  selected,
  onClick,
}: {
  breedKey: string;
  selected: boolean;
  onClick: () => void;
}) {
  const breed = COMPANION_BREEDS[breedKey as keyof typeof COMPANION_BREEDS];
  if (!breed) return null;

  return (
    <button
      onClick={onClick}
      style={{
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           6,
        padding:       '10px 8px',
        border:        `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius:  10,
        background:    selected ? 'var(--bg-hover)' : 'transparent',
        cursor:        'pointer',
        transition:    'all 0.2s',
        minWidth:      90,
      }}
    >
      {/* Colour swatch */}
      <div style={{
        width:        40,
        height:       40,
        borderRadius: '50%',
        background:   breed.palette.body,
        border:       `3px solid ${breed.palette.accent}`,
        boxShadow:    selected ? `0 0 10px ${breed.palette.accent}55` : 'none',
        transition:   'box-shadow 0.2s',
      }} />
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: selected ? 600 : 400 }}>
        {breed.label}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>
        {breed.traits}
      </span>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BreedPickerModal({ onAdopt }: BreedPickerModalProps) {
  const [selected, setSelected] = useState<string>('tabby');
  const [name,     setName]     = useState('');

  const breedKeys = Object.keys(COMPANION_BREEDS);

  const handleAdopt = () => {
    const trimmed = name.trim() || 'Kitten';
    onAdopt(selected, trimmed);
  };

  return (
    <div style={{
      position:        'fixed',
      inset:           0,
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      background:      'rgba(0,0,0,0.7)',
      backdropFilter:  'blur(6px)',
      zIndex:          200,
    }}>
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border)',
        borderRadius: 16,
        padding:      '32px 28px',
        maxWidth:     680,
        width:        '90vw',
        maxHeight:    '85vh',
        overflowY:    'auto',
        display:      'flex',
        flexDirection:'column',
        gap:          20,
      }}>
        {/* Header */}
        <div>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🐾 Adopt your companion</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Your companion will evolve based on how you code — body shape, personality,
            and growth driven by your real AI sessions.
          </p>
        </div>

        {/* Breed grid */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
          gap:                 8,
        }}>
          {breedKeys.map((key) => (
            <BreedCard
              key={key}
              breedKey={key}
              selected={selected === key}
              onClick={() => setSelected(key)}
            />
          ))}
        </div>

        {/* Name input */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Name your companion
          </label>
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder="e.g. Kernel, Byte, Pixel…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdopt(); }}
            style={{
              width:        '100%',
              padding:      '9px 12px',
              background:   'var(--bg-page)',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              color:        'var(--text-primary)',
              fontSize:     13,
              fontFamily:   'inherit',
              outline:      'none',
              boxSizing:    'border-box',
            }}
          />
        </div>

        {/* Selected breed info */}
        {selected && COMPANION_BREEDS[selected as keyof typeof COMPANION_BREEDS] && (
          <div style={{
            padding:      '10px 14px',
            background:   'var(--bg-page)',
            borderRadius: 8,
            fontSize:     12,
            color:        'var(--text-secondary)',
            lineHeight:   1.5,
          }}>
            <strong style={{ color: 'var(--text-primary)' }}>
              {COMPANION_BREEDS[selected as keyof typeof COMPANION_BREEDS].label}
            </strong>
            {' · '}
            {COMPANION_BREEDS[selected as keyof typeof COMPANION_BREEDS].traits}
          </div>
        )}

        {/* Adopt button */}
        <button
          onClick={handleAdopt}
          style={{
            padding:      '12px 0',
            background:   'var(--accent)',
            border:       'none',
            borderRadius: 8,
            color:        '#000',
            fontSize:     14,
            fontWeight:   600,
            cursor:       'pointer',
            fontFamily:   'inherit',
            transition:   'opacity 0.2s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
        >
          🐱 Adopt {name.trim() || 'your companion'}
        </button>
      </div>
    </div>
  );
}
