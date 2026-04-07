import { motion } from 'framer-motion';
import { CAT_BREEDS, SHINY_VARIANTS } from '../../lib/pomodoro-store';

function CatSVG({ colors, size, earShape }) {
  const s = size;
  return (
    <svg viewBox="0 0 100 120" width={s} height={s * 1.2}>
      {/* Body */}
      <ellipse cx="50" cy="85" rx="28" ry="25" fill={colors.body} />
      {/* Head */}
      <ellipse cx="50" cy="45" rx="22" ry="20" fill={colors.body} />
      {/* Ears */}
      {earShape === 'folded' ? (
        <>
          <polygon points="30,35 20,18 38,30" fill={colors.body} />
          <polygon points="70,35 80,18 62,30" fill={colors.body} />
          <polygon points="32,33 24,22 37,30" fill={colors.accent} opacity="0.5" />
          <polygon points="68,33 76,22 63,30" fill={colors.accent} opacity="0.5" />
        </>
      ) : (
        <>
          <polygon points="30,35 18,10 42,28" fill={colors.body} />
          <polygon points="70,35 82,10 58,28" fill={colors.body} />
          <polygon points="32,33 22,15 40,28" fill={colors.accent} opacity="0.4" />
          <polygon points="68,33 78,15 60,28" fill={colors.accent} opacity="0.4" />
        </>
      )}
      {/* Eyes */}
      <ellipse cx="40" cy="42" rx="4" ry="4.5" fill={colors.eyes} />
      <ellipse cx="60" cy="42" rx="4" ry="4.5" fill={colors.eyes} />
      <ellipse cx="41" cy="41" rx="1.5" ry="1.5" fill="#fff" opacity="0.8" />
      <ellipse cx="61" cy="41" rx="1.5" ry="1.5" fill="#fff" opacity="0.8" />
      {/* Nose */}
      <polygon points="48,50 52,50 50,53" fill={colors.accent} />
      {/* Mouth */}
      <path d="M 46 55 Q 50 58 54 55" fill="none" stroke={colors.accent} strokeWidth="1" opacity="0.6" />
      {/* Whiskers */}
      <line x1="20" y1="48" x2="38" y2="50" stroke={colors.accent} strokeWidth="0.7" opacity="0.3" />
      <line x1="20" y1="52" x2="38" y2="52" stroke={colors.accent} strokeWidth="0.7" opacity="0.3" />
      <line x1="80" y1="48" x2="62" y2="50" stroke={colors.accent} strokeWidth="0.7" opacity="0.3" />
      <line x1="80" y1="52" x2="62" y2="52" stroke={colors.accent} strokeWidth="0.7" opacity="0.3" />
      {/* Tail */}
      <path d="M 75 90 Q 90 70 85 55" fill="none" stroke={colors.body} strokeWidth="5" strokeLinecap="round" />
      {/* Paws */}
      <ellipse cx="35" cy="108" rx="8" ry="5" fill={colors.accent} opacity="0.6" />
      <ellipse cx="65" cy="108" rx="8" ry="5" fill={colors.accent} opacity="0.6" />
      {/* Stripes for tabby */}
      {colors.body === '#e8943a' && (
        <>
          <path d="M 35 38 Q 50 32 65 38" fill="none" stroke={colors.accent} strokeWidth="1.5" opacity="0.4" />
          <path d="M 38 42 Q 50 36 62 42" fill="none" stroke={colors.accent} strokeWidth="1.5" opacity="0.3" />
        </>
      )}
      {/* Tuxedo chest patch */}
      {colors.body === '#2a2a2a' && (
        <ellipse cx="50" cy="75" rx="14" ry="18" fill={colors.accent} opacity="0.9" />
      )}
    </svg>
  );
}

function WarningEyes({ colors, size }) {
  return (
    <svg viewBox="0 0 100 120" width={size} height={size * 1.2} style={{ position: 'absolute', top: 0, left: 0 }}>
      <ellipse cx="40" cy="42" rx="5.5" ry="6" fill={colors.eyes} />
      <ellipse cx="60" cy="42" rx="5.5" ry="6" fill={colors.eyes} />
      <ellipse cx="41" cy="40" rx="2" ry="2" fill="#fff" />
      <ellipse cx="61" cy="40" rx="2" ry="2" fill="#fff" />
    </svg>
  );
}

const RARITY_STYLES = {
  common: null,
  uncommon: { bg: 'var(--text-secondary)', label: 'silver' },
  rare: { bg: 'var(--amber)', label: 'gold' },
  legendary: { bg: 'var(--purple)', label: 'purple', glow: true },
};

export default function CatBreedSprite({ breedKey, growthProgress = 1, state = 'growing', shinyVariant = null }) {
  const breed = CAT_BREEDS[breedKey] || CAT_BREEDS.persian;
  const shiny = shinyVariant ? SHINY_VARIANTS[shinyVariant] : null;

  const scale = growthProgress < 0.33 ? 0.55 : growthProgress < 0.66 ? 0.75 : 1;
  const stageLabel = growthProgress < 0.33 ? 'Kitten' : growthProgress < 0.66 ? 'Young' : 'Adult';
  const earShape = breedKey === 'scottishFold' ? 'folded' : 'normal';
  const rarityStyle = RARITY_STYLES[breed.rarity];
  const baseSize = 100;

  const animVariants = {
    growing: {
      y: [0, -4, 0],
      rotate: [0, 0, 0],
      transition: { y: { duration: 3, repeat: Infinity, ease: 'easeInOut' } },
    },
    warning: {
      x: [-3, 3, -3, 0],
      transition: { x: { duration: 0.3, repeat: Infinity } },
    },
    ghost: {
      opacity: 0.15,
      filter: 'grayscale(1)',
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <motion.div
        animate={state === 'ghost' ? animVariants.ghost : state === 'warning' ? animVariants.warning : animVariants.growing}
        style={{
          position: 'relative',
          filter: shiny ? shiny.filter : 'none',
        }}
      >
        <motion.div
          animate={{ scale }}
          transition={{ type: 'spring', stiffness: 100, damping: 15 }}
          style={{ transformOrigin: 'bottom center' }}
        >
          <CatSVG colors={breed.colors} size={baseSize} earShape={earShape} />
          {state === 'warning' && <WarningEyes colors={breed.colors} size={baseSize} />}
        </motion.div>

        {shiny && (
          <motion.div
            style={{
              position: 'absolute',
              inset: -8,
              borderRadius: '50%',
              boxShadow: `0 0 20px ${shiny.glow}, 0 0 40px ${shiny.glow}40`,
              pointerEvents: 'none',
            }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {state === 'ghost' && (
          <div style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 32,
            opacity: 0.6,
          }}>
            👻
          </div>
        )}
      </motion.div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          {shiny && <span style={{ color: shiny.glow, marginRight: 4 }}>✦</span>}
          {shiny ? `${shiny.label} ` : ''}{breed.label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stageLabel}</div>
        {rarityStyle && (
          <div style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: rarityStyle.bg,
            marginTop: 4,
            boxShadow: rarityStyle.glow ? `0 0 6px ${rarityStyle.bg}` : 'none',
          }} />
        )}
      </div>
    </div>
  );
}
