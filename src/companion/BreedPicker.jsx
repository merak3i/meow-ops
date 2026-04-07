import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import CompanionCat from './CompanionCat';
import { BREED_LIST } from '../lib/companion-breeds';
import { adoptKitten } from '../lib/companion-store';

// First-run kitten picker. Carousel of all 20 breeds.
// User picks a breed, types a name, confirms.

export default function BreedPicker({ onAdopted }) {
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');

  const breed = BREED_LIST[index];
  const previewCat = {
    id: 'preview',
    breed: breed.key,
    stats: { hunger: 100, energy: 100, happiness: 100, health: 100, shine: 0 },
    growthXP: 0,
    appearance: { sizeMultiplier: 0.7, weight: 'normal', furQuality: 'normal', equippedAccessories: [] },
  };

  const next = () => setIndex((i) => (i + 1) % BREED_LIST.length);
  const prev = () => setIndex((i) => (i - 1 + BREED_LIST.length) % BREED_LIST.length);

  const handleAdopt = () => {
    if (!name.trim()) return;
    adoptKitten(breed.key, name.trim());
    onAdopted?.();
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        gap: 24,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', maxWidth: 560 }}>
        <h1 style={{ fontSize: 32, fontWeight: 300, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
          Choose your kitten
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.6 }}>
          You'll feed it, groom it, watch it grow. Every focused session feeds it. Neglect it for two weeks and it walks away.
        </p>
      </div>

      {/* Carousel */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 720,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}
      >
        <CarouselButton onClick={prev}><ChevronLeft size={20} /></CarouselButton>

        <div
          className="card"
          style={{
            position: 'relative',
            width: 420,
            height: 380,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: `radial-gradient(ellipse at center bottom, ${breed.palette.accent}33 0%, var(--bg-card) 70%)`,
            overflow: 'hidden',
          }}
        >
          {/* Subtle palette swatch */}
          <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 4 }}>
            {[breed.palette.body, breed.palette.accent, breed.palette.eyes].map((c, i) => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c, border: '1px solid var(--border)' }} />
            ))}
          </div>

          {/* Counter */}
          <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
            {index + 1} / {BREED_LIST.length}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={breed.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            >
              <CompanionCat cat={previewCat} mood="healthy" size={240} />
              <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--text-primary)', marginTop: -8 }}>
                {breed.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 280 }}>
                {breed.traits}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <CarouselButton onClick={next}><ChevronRight size={20} /></CarouselButton>
      </div>

      {/* Breed dots */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 480, justifyContent: 'center' }}>
        {BREED_LIST.map((b, i) => (
          <button
            key={b.key}
            onClick={() => setIndex(i)}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              padding: 0,
              border: 'none',
              background: i === index ? 'var(--accent)' : 'var(--bg-accent)',
              cursor: 'pointer',
              transition: 'all 0.3s var(--ease)',
            }}
            aria-label={b.label}
          />
        ))}
      </div>

      {/* Name + adopt */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder="Name your kitten..."
          style={{
            padding: '12px 16px',
            background: 'var(--bg-page)',
            border: '1px solid var(--border-input)',
            borderRadius: 10,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: 14,
            width: 240,
            outline: 'none',
            transition: 'border-color 0.3s var(--ease)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-input)')}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdopt(); }}
        />
        <button
          onClick={handleAdopt}
          disabled={!name.trim()}
          style={{
            padding: '12px 22px',
            background: name.trim() ? 'var(--accent)' : 'var(--bg-accent)',
            color: name.trim() ? '#fff' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontFamily: 'inherit',
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.3s var(--ease)',
          }}
        >
          <Heart size={14} />
          Adopt
        </button>
      </div>
    </div>
  );
}

function CarouselButton({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.3s var(--ease)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-hover)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      {children}
    </button>
  );
}
