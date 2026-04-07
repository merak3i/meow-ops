import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getBreed } from '../lib/companion-breeds';
import { getAccessory } from '../lib/companion-accessories';

// CompanionCat — premium animated cat renderer.
//
// Two render paths:
// 1. PNG override: if /companion/breeds/{breed}.png exists, use it as a real
//    painted portrait (Imagen / Flux / Midjourney). Same animation wrapper.
// 2. SVG fallback: anime-style vector cat with gradient body, big anime
//    eyes, automatic blinking, breathing, ear twitching, and tail swish.
//
// Props:
//   cat   — the cat object from companion-store
//   mood  — derived mood string ('healthy' | 'concerned' | 'distressed' | 'critical' | 'glowing')
//   size  — pixel canvas size

const breedImageCache = new Map();

function checkBreedImage(key) {
  if (breedImageCache.has(key)) return breedImageCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = `/companion/breeds/${key}.png`;
  });
  breedImageCache.set(key, p);
  return p;
}

export default function CompanionCat({ cat, mood = 'healthy', size = 380 }) {
  if (!cat) return null;
  const breed = getBreed(cat.breed);
  const palette = breed.palette;
  const sizeMult = cat.appearance?.sizeMultiplier ?? 1;
  const fur = cat.appearance?.furQuality || 'normal';
  const equipped = cat.appearance?.equippedAccessories || [];

  const [hasImage, setHasImage] = useState(false);
  useEffect(() => {
    let alive = true;
    checkBreedImage(cat.breed).then((ok) => alive && setHasImage(ok));
    return () => { alive = false; };
  }, [cat.breed]);

  const glow = mood === 'glowing' || fur === 'glowing';
  const isCurled = mood === 'critical';

  return (
    <motion.div
      animate={{
        scale: sizeMult,
        scaleY: isCurled ? sizeMult : [sizeMult, sizeMult * 1.025, sizeMult],
        y: isCurled ? 0 : [0, -3, 0],
      }}
      transition={{
        scale: { type: 'spring', stiffness: 90, damping: 14 },
        scaleY: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
        y: { duration: 4.6, repeat: Infinity, ease: 'easeInOut' },
      }}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        filter: glow
          ? `drop-shadow(0 0 28px ${palette.eyes}aa) drop-shadow(0 0 60px ${palette.eyes}55) drop-shadow(0 12px 24px rgba(0,0,0,0.5))`
          : 'drop-shadow(0 12px 28px rgba(0,0,0,0.55))',
      }}
    >
      {hasImage ? (
        <img
          src={`/companion/breeds/${cat.breed}.png`}
          alt={breed.label}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      ) : (
        <CatSvg cat={cat} breed={breed} mood={mood} equipped={equipped} />
      )}
    </motion.div>
  );
}

// ─── SVG cat ──────────────────────────────────────────────────────

function CatSvg({ cat, breed, mood, equipped }) {
  const { palette, silhouette } = breed;
  const id = (cat.id || 'preview').replace(/[^a-z0-9]/gi, '');

  const eyeOpen = mood === 'critical' ? 0.15 : mood === 'distressed' ? 0.65 : mood === 'concerned' ? 0.92 : 1;
  const isCurled = mood === 'critical';
  const earTilt = mood === 'concerned' ? -8 : mood === 'distressed' ? -14 : isCurled ? -22 : 0;

  const bodyW = silhouette.body === 'plush' ? 78 : silhouette.body === 'sleek' ? 60 : 70;
  const bodyH = silhouette.body === 'plush' ? 52 : silhouette.body === 'sleek' ? 42 : 48;

  return (
    <svg viewBox="0 0 280 280" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id={`body-${id}`} cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor={lighten(palette.body, 0.28)} />
          <stop offset="55%" stopColor={palette.body} />
          <stop offset="100%" stopColor={darken(palette.body, 0.28)} />
        </radialGradient>
        <radialGradient id={`head-${id}`} cx="42%" cy="32%" r="78%">
          <stop offset="0%" stopColor={lighten(palette.body, 0.32)} />
          <stop offset="50%" stopColor={palette.body} />
          <stop offset="100%" stopColor={darken(palette.body, 0.3)} />
        </radialGradient>
        <linearGradient id={`eye-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={lighten(palette.eyes, 0.45)} />
          <stop offset="50%" stopColor={palette.eyes} />
          <stop offset="100%" stopColor={darken(palette.eyes, 0.45)} />
        </linearGradient>
        <radialGradient id={`pink-${id}`} cx="50%" cy="50%">
          <stop offset="0%" stopColor="#ffc8c8" />
          <stop offset="100%" stopColor="#e88a8a" />
        </radialGradient>
        {silhouette.pattern === 'stripes' && (
          <pattern id={`pat-${id}`} x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
            <rect width="14" height="14" fill="transparent" />
            <path d="M-2 7 Q 7 2 16 7" stroke={darken(palette.body, 0.4)} strokeWidth="3" fill="none" opacity="0.7" />
          </pattern>
        )}
        {silhouette.pattern === 'spots' && (
          <pattern id={`pat-${id}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill="transparent" />
            <circle cx="6" cy="7" r="2.6" fill={darken(palette.body, 0.45)} opacity="0.75" />
            <circle cx="14" cy="13" r="1.8" fill={darken(palette.body, 0.45)} opacity="0.65" />
          </pattern>
        )}
      </defs>

      {/* Ground shadow */}
      <ellipse cx="140" cy="252" rx="84" ry="6" fill="rgba(0,0,0,0.45)" />

      {/* Tail */}
      {!isCurled && (
        <motion.path
          d={
            silhouette.tail === 'long'
              ? `M ${140 + bodyW * 0.6} 198 Q ${140 + bodyW * 1.2} 130 ${140 + bodyW * 0.95} 68`
              : `M ${140 + bodyW * 0.5} 196 Q ${140 + bodyW * 0.95} 150 ${140 + bodyW * 0.75} 100`
          }
          stroke={palette.body}
          strokeWidth={silhouette.fur === 'long' ? 26 : silhouette.fur === 'medium' ? 22 : 18}
          strokeLinecap="round"
          fill="none"
          animate={{ rotate: [0, 7, -3, 0] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' }}
          style={{ transformOrigin: `${140 + bodyW * 0.5}px 200px` }}
        />
      )}

      {/* Body */}
      <ellipse cx="140" cy="195" rx={bodyW} ry={bodyH} fill={`url(#body-${id})`} />
      {(silhouette.pattern === 'stripes' || silhouette.pattern === 'spots') && (
        <ellipse cx="140" cy="195" rx={bodyW} ry={bodyH} fill={`url(#pat-${id})`} />
      )}

      {/* Belly */}
      <ellipse cx="140" cy="218" rx={bodyW * 0.55} ry={bodyH * 0.5} fill={lighten(palette.belly, 0.05)} opacity="0.9" />

      {/* Tuxedo chest */}
      {silhouette.pattern === 'tuxedo' && (
        <ellipse cx="140" cy="200" rx={bodyW * 0.42} ry={bodyH * 0.7} fill="#fafafa" />
      )}

      {/* Calico patches */}
      {silhouette.pattern === 'patches' && (
        <>
          <ellipse cx="115" cy="180" rx="18" ry="13" fill={palette.accent} opacity="0.85" />
          <ellipse cx="160" cy="200" rx="14" ry="11" fill="#3a2410" opacity="0.7" />
        </>
      )}

      {/* Front paws */}
      <ellipse cx="118" cy="240" rx="14" ry="9" fill={palette.body} />
      <ellipse cx="162" cy="240" rx="14" ry="9" fill={palette.body} />
      <ellipse cx="116" cy="241" rx="6" ry="3" fill={lighten(palette.belly, 0.1)} opacity="0.7" />
      <ellipse cx="164" cy="241" rx="6" ry="3" fill={lighten(palette.belly, 0.1)} opacity="0.7" />

      {/* Head group */}
      <g>
        {/* Ears with gentle twitch every 6s */}
        <motion.g
          animate={{ rotate: [0, 0, 0, -3, 1, 0, 0, 0] }}
          transition={{ duration: 6.5, repeat: Infinity, times: [0, 0.4, 0.5, 0.53, 0.56, 0.6, 0.7, 1], ease: 'easeOut' }}
          style={{ transformOrigin: '140px 110px' }}
        >
          <EarPair shape={silhouette.ear} palette={palette} pinkId={`pink-${id}`} earTilt={earTilt} />
        </motion.g>

        {/* Cheek fluff for long-fur breeds */}
        {silhouette.fur === 'long' && (
          <>
            <ellipse cx="78" cy="138" rx="14" ry="20" fill={palette.body} />
            <ellipse cx="202" cy="138" rx="14" ry="20" fill={palette.body} />
          </>
        )}

        {/* Skull (head) */}
        <ellipse cx="140" cy="118" rx="58" ry="50" fill={`url(#head-${id})`} />

        {/* Colorpoint mask */}
        {silhouette.pattern === 'colorpoint' && (
          <ellipse cx="140" cy="135" rx="40" ry="28" fill={palette.accent} opacity="0.55" />
        )}

        {/* Forehead highlight */}
        <ellipse cx="125" cy="92" rx="16" ry="8" fill={lighten(palette.body, 0.4)} opacity="0.35" />
        <ellipse cx="155" cy="92" rx="16" ry="8" fill={lighten(palette.body, 0.4)} opacity="0.35" />

        {/* Nose bridge subtle highlight */}
        <ellipse cx="140" cy="118" rx="10" ry="22" fill={lighten(palette.body, 0.18)} opacity="0.35" />

        {/* Eyes — anime style with auto blink */}
        <Eyes id={id} eyeOpen={eyeOpen} mood={mood} />

        {/* Nose */}
        <path
          d="M 132 148 Q 140 158 148 148 Q 145 154 140 154 Q 135 154 132 148 Z"
          fill={palette.nose}
        />
        <ellipse cx="138" cy="150" rx="2" ry="1.2" fill="#ffffff" opacity="0.55" />

        {/* Mouth */}
        <Mouth mood={mood} />

        {/* Whiskers */}
        <Whiskers />
      </g>

      {/* Accessories layered last */}
      {equipped.map((key) => (
        <Accessory key={key} accKey={key} />
      ))}

      {/* Sleeping zzz when critical */}
      {mood === 'critical' && (
        <motion.text
          x="200"
          y="80"
          fontSize="22"
          fill="var(--text-secondary)"
          animate={{ opacity: [0.3, 1, 0.3], y: [80, 64, 80] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          z
        </motion.text>
      )}
    </svg>
  );
}

// ─── Eyes ─────────────────────────────────────────────────────────

function Eyes({ id, eyeOpen, mood }) {
  // Periodic blink — scaleY drops to nearly 0 for ~120ms every ~4.5s
  return (
    <motion.g
      animate={{ scaleY: [1, 1, 1, 0.06, 1] }}
      transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.86, 0.94, 0.96, 1], ease: 'linear' }}
      style={{ transformOrigin: '140px 132px' }}
    >
      <SingleEye cx={108} cy={132} rx={15} ry={20 * eyeOpen} id={id} mood={mood} />
      <SingleEye cx={172} cy={132} rx={15} ry={20 * eyeOpen} id={id} mood={mood} />
    </motion.g>
  );
}

function SingleEye({ cx, cy, rx, ry, id, mood }) {
  if (ry < 1.5) {
    return (
      <path
        d={`M ${cx - rx} ${cy} Q ${cx} ${cy + 4} ${cx + rx} ${cy}`}
        stroke="#0a0a0a"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  const pupilOffset = mood === 'concerned' ? -2 : mood === 'distressed' ? -2 : 0;
  return (
    <g>
      {/* Sclera (white surround) — small */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#fafafa" />
      {/* Iris with vertical gradient */}
      <ellipse cx={cx} cy={cy + 1} rx={rx - 1} ry={ry - 1} fill={`url(#eye-${id})`} />
      {/* Vertical pupil — feline */}
      <ellipse cx={cx + pupilOffset} cy={cy + 2} rx={rx * 0.32} ry={ry * 0.78} fill="#0a0a0a" />
      {/* Big highlight (top-left) */}
      <ellipse cx={cx - rx * 0.32} cy={cy - ry * 0.45} rx={rx * 0.4} ry={ry * 0.34} fill="#ffffff" opacity="0.95" />
      {/* Small highlight (bottom-right) */}
      <circle cx={cx + rx * 0.45} cy={cy + ry * 0.25} r={rx * 0.13} fill="#ffffff" opacity="0.75" />
      {/* Eye outline */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#0a0a0a" strokeWidth="1.6" />
    </g>
  );
}

function Mouth({ mood }) {
  if (mood === 'critical' || mood === 'distressed') {
    return <path d="M 128 162 Q 140 156 152 162" stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
  }
  if (mood === 'concerned') {
    return <path d="M 130 162 L 150 162" stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
  }
  return (
    <g>
      <path d="M 130 160 Q 135 166 140 162" stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M 140 162 Q 145 166 150 160" stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Whiskers() {
  return (
    <g stroke="#a0a0a0" strokeWidth="1.3" strokeLinecap="round" opacity="0.75">
      <line x1="92" y1="148" x2="58" y2="142" />
      <line x1="92" y1="152" x2="58" y2="156" />
      <line x1="188" y1="148" x2="222" y2="142" />
      <line x1="188" y1="152" x2="222" y2="156" />
    </g>
  );
}

function EarPair({ shape, palette, pinkId, earTilt }) {
  if (shape === 'folded') {
    return (
      <g transform={`rotate(${earTilt} 140 110)`}>
        <path d="M 90 86 Q 96 112 114 104 Q 102 94 90 86" fill={palette.body} />
        <path d="M 190 86 Q 184 112 166 104 Q 178 94 190 86" fill={palette.body} />
        <path d="M 100 96 Q 104 106 112 102" stroke={`url(#${pinkId})`} strokeWidth="3" fill="none" opacity="0.7" />
        <path d="M 180 96 Q 176 106 168 102" stroke={`url(#${pinkId})`} strokeWidth="3" fill="none" opacity="0.7" />
      </g>
    );
  }
  if (shape === 'tufted') {
    return (
      <g transform={`rotate(${earTilt} 140 110)`}>
        <path d="M 84 100 L 108 50 L 124 96 Z" fill={palette.body} />
        <path d="M 156 96 L 172 50 L 196 100 Z" fill={palette.body} />
        <path d="M 96 92 L 108 64 L 116 92 Z" fill={`url(#${pinkId})`} opacity="0.75" />
        <path d="M 164 92 L 172 64 L 184 92 Z" fill={`url(#${pinkId})`} opacity="0.75" />
        {/* Lynx tufts */}
        <path d="M 102 56 L 106 38 L 110 54" stroke={palette.accent} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 170 56 L 174 38 L 178 54" stroke={palette.accent} strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g transform={`rotate(${earTilt} 140 110)`}>
      <path d="M 86 102 L 110 56 L 126 96 Z" fill={palette.body} />
      <path d="M 154 96 L 170 56 L 194 102 Z" fill={palette.body} />
      <path d="M 96 94 L 110 70 L 118 94 Z" fill={`url(#${pinkId})`} opacity="0.9" />
      <path d="M 162 94 L 170 70 L 184 94 Z" fill={`url(#${pinkId})`} opacity="0.9" />
    </g>
  );
}

// ─── Color helpers ────────────────────────────────────────────────

function lighten(hex, amount) {
  const h = (hex || '#888').replace('#', '');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

function darken(hex, amount) {
  const h = (hex || '#888').replace('#', '');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  const dr = Math.max(0, Math.round(r * (1 - amount)));
  const dg = Math.max(0, Math.round(g * (1 - amount)));
  const db = Math.max(0, Math.round(b * (1 - amount)));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

// ─── Accessories ──────────────────────────────────────────────────

// ─── Rich accessory SVGs with gradients, highlights, shadows ────────

function Accessory({ accKey }) {
  const acc = getAccessory(accKey);
  if (!acc) return null;
  const g = `acc-${accKey}`;

  switch (accKey) {
    case 'scarlet_sigil':
    case 'sapphire_band':
    case 'emerald_vow': {
      const base = acc.color;
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={lighten(base, 0.4)} />
              <stop offset="50%" stopColor={base} />
              <stop offset="100%" stopColor={darken(base, 0.4)} />
            </linearGradient>
          </defs>
          <rect x="102" y="168" width="76" height="11" rx="5.5" fill={`url(#${g})`} />
          <rect x="102" y="168" width="76" height="3" rx="1.5" fill="#ffffff" opacity="0.35" />
          {/* Gem */}
          <circle cx="140" cy="180" r="5" fill={lighten(base, 0.25)} stroke={darken(base, 0.55)} strokeWidth="0.8" />
          <circle cx="138.5" cy="178.5" r="1.6" fill="#ffffff" opacity="0.9" />
          {/* Rivets */}
          <circle cx="114" cy="173" r="1.2" fill="#e8d070" opacity="0.9" />
          <circle cx="126" cy="173" r="1.2" fill="#e8d070" opacity="0.9" />
          <circle cx="154" cy="173" r="1.2" fill="#e8d070" opacity="0.9" />
          <circle cx="166" cy="173" r="1.2" fill="#e8d070" opacity="0.9" />
        </g>
      );
    }
    case 'ebony_cravat':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3a3a3a" />
              <stop offset="50%" stopColor="#1a1a1a" />
              <stop offset="100%" stopColor="#080808" />
            </linearGradient>
          </defs>
          <rect x="106" y="170" width="68" height="7" rx="3.5" fill="#2a2a2a" />
          <path d="M 124 174 L 108 160 Q 102 158 104 168 L 104 188 Q 104 196 112 190 L 124 180 Z" fill={`url(#${g})`} />
          <path d="M 156 174 L 172 160 Q 178 158 176 168 L 176 188 Q 176 196 168 190 L 156 180 Z" fill={`url(#${g})`} />
          <ellipse cx="140" cy="175" rx="6" ry="5" fill={`url(#${g})`} />
          <ellipse cx="140" cy="174" rx="3" ry="2" fill="#5a5a5a" opacity="0.7" />
        </g>
      );
    case 'silverbell':
      return (
        <g>
          <defs>
            <radialGradient id={g} cx="50%" cy="35%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor={acc.color} />
              <stop offset="100%" stopColor="#8a7c56" />
            </radialGradient>
          </defs>
          <rect x="102" y="168" width="76" height="10" rx="5" fill="#2a261c" />
          <rect x="102" y="168" width="76" height="3" rx="1.5" fill="#d8c68a" opacity="0.5" />
          {/* Bell */}
          <path d="M 132 180 Q 130 192 134 196 L 146 196 Q 150 192 148 180 Q 148 178 140 178 Q 132 178 132 180 Z" fill={`url(#${g})`} stroke="#6a5030" strokeWidth="0.8" />
          <circle cx="140" cy="200" r="1.6" fill="#6a5030" />
          <ellipse cx="137" cy="184" rx="2" ry="3" fill="#ffffff" opacity="0.6" />
        </g>
      );
    case 'arcanist_cap':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#6a4ca0" />
              <stop offset="50%" stopColor={acc.color} />
              <stop offset="100%" stopColor="#1a1030" />
            </linearGradient>
          </defs>
          <path d="M 106 74 Q 120 30 140 10 Q 156 24 170 70 Q 172 76 170 78 Q 164 82 158 76 Q 148 80 140 76 Q 132 80 122 76 Q 116 82 110 78 Q 104 76 106 74 Z" fill={`url(#${g})`} />
          <ellipse cx="140" cy="78" rx="38" ry="6" fill="#0a0520" />
          <ellipse cx="140" cy="76" rx="36" ry="3" fill="#9a7cd8" opacity="0.7" />
          {/* Stars */}
          <path d="M 132 46 l 1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 z" fill="#fff5a8" />
          <circle cx="148" cy="34" r="1.2" fill="#fff5a8" />
          <circle cx="152" cy="58" r="1" fill="#fff5a8" />
          {/* Buckle */}
          <rect x="132" y="74" width="16" height="3" fill="#e8c840" />
        </g>
      );
    case 'crown_of_embers':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffe680" />
              <stop offset="50%" stopColor="#e8b830" />
              <stop offset="100%" stopColor="#805818" />
            </linearGradient>
          </defs>
          {/* Crown base */}
          <rect x="98" y="76" width="84" height="10" rx="2" fill={`url(#${g})`} stroke="#5a3810" strokeWidth="0.8" />
          {/* Spikes */}
          <path d="M 98 76 L 106 54 L 114 74 L 124 46 L 134 72 L 140 42 L 146 72 L 156 46 L 166 74 L 174 54 L 182 76 Z" fill={`url(#${g})`} stroke="#5a3810" strokeWidth="0.8" />
          {/* Top highlight */}
          <rect x="98" y="78" width="84" height="2" fill="#fff0c0" opacity="0.7" />
          {/* Gems */}
          <circle cx="140" cy="58" r="3.2" fill="#c44040" stroke="#5a1010" strokeWidth="0.6" />
          <circle cx="139" cy="57" r="1" fill="#ffffff" opacity="0.9" />
          <circle cx="124" cy="66" r="2.4" fill="#3f7fc8" stroke="#102850" strokeWidth="0.5" />
          <circle cx="156" cy="66" r="2.4" fill="#5ca35a" stroke="#143a14" strokeWidth="0.5" />
          <circle cx="110" cy="70" r="1.8" fill="#c44040" />
          <circle cx="170" cy="70" r="1.8" fill="#c44040" />
        </g>
      );
    case 'crimson_mantle':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#a83030" />
              <stop offset="60%" stopColor={acc.color} />
              <stop offset="100%" stopColor="#2a0808" />
            </linearGradient>
          </defs>
          <path d="M 82 168 Q 46 218 72 254 L 208 254 Q 234 218 198 168 Q 184 180 164 178 Q 140 180 116 178 Q 96 180 82 168 Z" fill={`url(#${g})`} />
          {/* Fur trim */}
          <path d="M 82 168 Q 96 180 116 178 Q 140 180 164 178 Q 184 180 198 168" stroke="#f6f0dc" strokeWidth="3.5" fill="none" opacity="0.85" strokeLinecap="round" />
          <path d="M 82 168 Q 96 180 116 178 Q 140 180 164 178 Q 184 180 198 168" stroke="#dcd0a8" strokeWidth="1.5" fill="none" strokeDasharray="2 3" opacity="0.7" />
          {/* Clasp */}
          <circle cx="140" cy="178" r="4" fill="#e8c840" stroke="#805818" strokeWidth="0.6" />
          <circle cx="139" cy="177" r="1.2" fill="#ffffff" opacity="0.8" />
        </g>
      );
    case 'ironwolf_helm':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#d0d8e0" />
              <stop offset="50%" stopColor={acc.color} />
              <stop offset="100%" stopColor="#3a4048" />
            </linearGradient>
          </defs>
          {/* Helm shell */}
          <path d="M 84 90 Q 84 44 140 36 Q 196 44 196 90 L 196 112 Q 140 124 84 112 Z" fill={`url(#${g})`} />
          <path d="M 84 90 Q 84 44 140 36 Q 196 44 196 90" fill="none" stroke="#1a1e24" strokeWidth="1.5" />
          {/* Eye slit */}
          <rect x="106" y="94" width="68" height="5" rx="1" fill="#0a0a10" />
          <rect x="108" y="95.5" width="64" height="2" fill="#fff" opacity="0.2" />
          {/* Nose guard */}
          <rect x="137" y="98" width="6" height="18" fill={`url(#${g})`} stroke="#1a1e24" strokeWidth="0.6" />
          {/* Crest — wolf ears */}
          <path d="M 122 36 L 128 14 L 134 34 Z" fill="#5a2020" />
          <path d="M 146 34 L 152 14 L 158 36 Z" fill="#5a2020" />
          <path d="M 124 30 L 128 18 L 132 30 Z" fill="#1a0808" />
          <path d="M 148 30 L 152 18 L 156 30 Z" fill="#1a0808" />
          {/* Top highlight */}
          <ellipse cx="140" cy="50" rx="30" ry="4" fill="#ffffff" opacity="0.3" />
        </g>
      );
    case 'ravens_pauldron':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#404040" />
              <stop offset="50%" stopColor="#1a1a1a" />
              <stop offset="100%" stopColor="#000000" />
            </linearGradient>
          </defs>
          {/* Pauldron plate */}
          <path d="M 200 130 Q 222 126 226 146 Q 220 158 196 160 Q 192 150 200 130 Z" fill={`url(#${g})`} stroke="#5a5a5a" strokeWidth="0.6" />
          <path d="M 204 138 Q 218 134 222 144" stroke="#6a6a6a" strokeWidth="1" fill="none" opacity="0.7" />
          {/* Raven */}
          <ellipse cx="216" cy="120" rx="10" ry="6" fill="#0a0a0a" />
          <ellipse cx="212" cy="115" rx="6" ry="5" fill="#0a0a0a" />
          <path d="M 207 114 L 204 112 L 208 116 Z" fill="#c44040" />
          <circle cx="210" cy="114" r="1.2" fill="#ffc840" />
          <path d="M 220 118 L 228 112 L 226 120 Z" fill="#0a0a0a" />
          <path d="M 213 126 Q 216 130 219 126" stroke="#0a0a0a" strokeWidth="1.2" fill="none" />
          {/* Feather sheen */}
          <ellipse cx="214" cy="117" rx="3" ry="1.5" fill="#4060a0" opacity="0.55" />
        </g>
      );
    case 'halo_of_the_first_sun':
      return (
        <g>
          <defs>
            <radialGradient id={g} cx="50%" cy="50%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="30%" stopColor="#fff5a8" />
              <stop offset="100%" stopColor="#e8b830" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Outer glow */}
          <ellipse cx="140" cy="42" rx="52" ry="12" fill={`url(#${g})`} opacity="0.6" />
          {/* Main ring */}
          <ellipse cx="140" cy="42" rx="42" ry="8" fill="none" stroke="#fff5a8" strokeWidth="5" opacity="0.95" />
          <ellipse cx="140" cy="42" rx="42" ry="8" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.9" />
          {/* Sun rays */}
          <line x1="140" y1="24" x2="140" y2="18" stroke="#fff5a8" strokeWidth="2" strokeLinecap="round" />
          <line x1="120" y1="30" x2="114" y2="24" stroke="#fff5a8" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="160" y1="30" x2="166" y2="24" stroke="#fff5a8" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="104" y1="42" x2="96" y2="42" stroke="#fff5a8" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="176" y1="42" x2="184" y2="42" stroke="#fff5a8" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      );
    case 'gilded_wings':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="0%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#fff5a8" />
              <stop offset="50%" stopColor={acc.color} />
              <stop offset="100%" stopColor="#806018" />
            </linearGradient>
          </defs>
          {/* Left wing */}
          <path d="M 72 170 Q 30 110 14 160 Q 20 170 30 162 Q 24 190 44 182 Q 40 198 56 190 Q 54 204 72 196 Z" fill={`url(#${g})`} />
          {/* Left feathers */}
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={`lf-${i}`} d={`M ${60 - i * 8} ${172 + i * 4} Q ${40 - i * 10} ${168 + i * 2} ${24 - i * 6} ${180 + i * 4}`} stroke="#805818" strokeWidth="0.8" fill="none" opacity="0.6" />
          ))}
          {/* Right wing */}
          <path d="M 208 170 Q 250 110 266 160 Q 260 170 250 162 Q 256 190 236 182 Q 240 198 224 190 Q 226 204 208 196 Z" fill={`url(#${g})`} />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={`rf-${i}`} d={`M ${220 + i * 8} ${172 + i * 4} Q ${240 + i * 10} ${168 + i * 2} ${256 + i * 6} ${180 + i * 4}`} stroke="#805818" strokeWidth="0.8" fill="none" opacity="0.6" />
          ))}
        </g>
      );
    case 'dragon_wings':
      return (
        <g>
          <defs>
            <linearGradient id={g} x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#3a0808" />
              <stop offset="50%" stopColor={acc.color} />
              <stop offset="100%" stopColor="#140202" />
            </linearGradient>
          </defs>
          {/* Left wing */}
          <path d="M 72 166 Q 10 100 0 178 Q 16 176 30 174 L 32 184 Q 48 178 56 180 L 58 190 Q 68 184 74 186 Z" fill={`url(#${g})`} stroke="#0a0202" strokeWidth="1" />
          {/* Wing bones */}
          <path d="M 72 166 Q 40 120 10 172" stroke="#1a0404" strokeWidth="1.8" fill="none" />
          <path d="M 72 166 Q 50 158 32 184" stroke="#1a0404" strokeWidth="1.4" fill="none" />
          <path d="M 72 166 Q 60 170 56 180" stroke="#1a0404" strokeWidth="1.2" fill="none" />
          {/* Right wing */}
          <path d="M 208 166 Q 270 100 280 178 Q 264 176 250 174 L 248 184 Q 232 178 224 180 L 222 190 Q 212 184 206 186 Z" fill={`url(#${g})`} stroke="#0a0202" strokeWidth="1" />
          <path d="M 208 166 Q 240 120 270 172" stroke="#1a0404" strokeWidth="1.8" fill="none" />
          <path d="M 208 166 Q 230 158 248 184" stroke="#1a0404" strokeWidth="1.4" fill="none" />
          <path d="M 208 166 Q 220 170 224 180" stroke="#1a0404" strokeWidth="1.2" fill="none" />
          {/* Claw talons */}
          <path d="M 10 178 L 6 184" stroke="#0a0202" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 270 178 L 274 184" stroke="#0a0202" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      );
    default:
      return null;
  }
}
