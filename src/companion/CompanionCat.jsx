import { motion } from 'framer-motion';
import { getBreed } from '../lib/companion-breeds';
import { getAccessory } from '../lib/companion-accessories';

// CompanionCat — premium SVG cat renderer.
// Layered anatomy lets us drive breed (palette + silhouette), life stage
// (size multiplier), mood (eyes + ears + posture), and accessories.
//
// Props:
//   cat   — the cat object from companion-store
//   mood  — derived mood string ('healthy' | 'concerned' | 'distressed' | 'critical' | 'glowing')
//   size  — pixel canvas size, default 360

export default function CompanionCat({ cat, mood = 'healthy', size = 360 }) {
  if (!cat) return null;
  const breed = getBreed(cat.breed);
  const palette = breed.palette;
  const silhouette = breed.silhouette;
  const sizeMult = cat.appearance?.sizeMultiplier ?? 1;
  const weight = cat.appearance?.weight || 'normal';
  const fur = cat.appearance?.furQuality || 'normal';
  const equipped = cat.appearance?.equippedAccessories || [];

  // Body proportions per breed silhouette + weight modifier
  const bodyW =
    (silhouette.body === 'plush' ? 110 : silhouette.body === 'sleek' ? 80 : 95) *
    (weight === 'plump' ? 1.12 : weight === 'thin' ? 0.88 : 1);
  const bodyH = silhouette.body === 'plush' ? 78 : silhouette.body === 'sleek' ? 62 : 70;

  // Eye state per mood
  const eyeOpen =
    mood === 'critical' ? 0.3 : mood === 'distressed' ? 0.5 : mood === 'concerned' ? 0.85 : 1;
  const pupilTurn = mood === 'concerned' || mood === 'distressed' ? -1 : 0;

  // Posture: critical = curled, others = upright
  const isCurled = mood === 'critical';
  const earTilt = mood === 'concerned' ? -8 : mood === 'distressed' ? -14 : mood === 'critical' ? -22 : 0;

  // Glow filter for shiny / glowing
  const glow = mood === 'glowing' || fur === 'glowing';
  const filterId = `glow-${cat.id}`;
  const patternId = `pat-${cat.id}`;

  // Idle animation (gentle bob), more subdued when distressed
  const bobAmp = isCurled ? 0 : mood === 'distressed' ? 1 : 3;
  const bobDur = isCurled ? 6 : 4;

  return (
    <motion.div
      animate={{ scale: sizeMult, y: [0, -bobAmp, 0] }}
      transition={{
        scale: { type: 'spring', stiffness: 90, damping: 14 },
        y: { duration: bobDur, repeat: Infinity, ease: 'easeInOut' },
      }}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: glow ? `drop-shadow(0 0 18px ${palette.eyes}88) drop-shadow(0 0 36px ${palette.eyes}44)` : 'none',
      }}
    >
      <svg
        viewBox="0 0 240 240"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {glow && (
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
          {silhouette.pattern === 'stripes' && (
            <pattern id={patternId} x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
              <rect width="14" height="14" fill={palette.body} />
              <path d="M-2 7 Q 7 2 16 7" stroke={palette.accent} strokeWidth="2.5" fill="none" opacity="0.55" />
            </pattern>
          )}
          {silhouette.pattern === 'spots' && (
            <pattern id={patternId} x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
              <rect width="18" height="18" fill={palette.body} />
              <circle cx="6" cy="6" r="2.2" fill={palette.accent} opacity="0.6" />
              <circle cx="13" cy="12" r="1.5" fill={palette.accent} opacity="0.55" />
            </pattern>
          )}
        </defs>

        {/* Tail — drawn first so the body covers its base */}
        {!isCurled && (
          <motion.path
            d={
              silhouette.tail === 'long'
                ? `M ${120 + bodyW * 0.45} 175 Q ${120 + bodyW * 0.85} 110 ${120 + bodyW * 0.7} 70`
                : `M ${120 + bodyW * 0.4} 170 Q ${120 + bodyW * 0.7} 130 ${120 + bodyW * 0.55} 95`
            }
            stroke={palette.body}
            strokeWidth={silhouette.fur === 'long' ? 22 : 16}
            strokeLinecap="round"
            fill="none"
            animate={{ rotate: [0, 4, -2, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' }}
            style={{ transformOrigin: `${120 + bodyW * 0.4}px 175px` }}
          />
        )}

        {/* Body */}
        <ellipse
          cx="120"
          cy="170"
          rx={bodyW / 2}
          ry={bodyH / 2}
          fill={silhouette.pattern === 'stripes' || silhouette.pattern === 'spots' ? `url(#${patternId})` : palette.body}
        />

        {/* Belly highlight */}
        <ellipse cx="120" cy={180} rx={bodyW * 0.35} ry={bodyH * 0.32} fill={palette.belly} opacity="0.85" />

        {/* Tuxedo chest */}
        {silhouette.pattern === 'tuxedo' && (
          <ellipse cx="120" cy="178" rx={bodyW * 0.28} ry={bodyH * 0.36} fill="#f6f6f6" />
        )}

        {/* Calico patches */}
        {silhouette.pattern === 'patches' && (
          <>
            <ellipse cx="100" cy="160" rx="14" ry="10" fill={palette.accent} opacity="0.85" />
            <ellipse cx="138" cy="172" rx="10" ry="8" fill="#3a2410" opacity="0.7" />
          </>
        )}

        {/* Front paws */}
        <ellipse cx="104" cy={195 + bodyH * 0.05} rx="11" ry="7" fill={palette.body} />
        <ellipse cx="136" cy={195 + bodyH * 0.05} rx="11" ry="7" fill={palette.body} />

        {/* Head */}
        <g style={{ filter: glow ? `url(#${filterId})` : 'none' }}>
          {/* Ears */}
          <EarPair shape={silhouette.ear} palette={palette} earTilt={earTilt} />

          {/* Skull */}
          <ellipse cx="120" cy="110" rx="42" ry="38" fill={palette.body} />

          {/* Colorpoint face mask */}
          {silhouette.pattern === 'colorpoint' && (
            <ellipse cx="120" cy="120" rx="28" ry="22" fill={palette.accent} opacity="0.55" />
          )}

          {/* Cheek fluff for long-fur breeds */}
          {silhouette.fur === 'long' && (
            <>
              <ellipse cx="82" cy="124" rx="12" ry="14" fill={palette.body} />
              <ellipse cx="158" cy="124" rx="12" ry="14" fill={palette.body} />
            </>
          )}

          {/* Eyes */}
          <Eye cx={104} cy={108} eyeColor={palette.eyes} open={eyeOpen} pupilTurn={pupilTurn} />
          <Eye cx={136} cy={108} eyeColor={palette.eyes} open={eyeOpen} pupilTurn={pupilTurn} />

          {/* Nose */}
          <path d={`M 116 122 Q 120 128 124 122 Q 122 126 120 126 Q 118 126 116 122 Z`} fill={palette.nose} />

          {/* Mouth */}
          <path
            d={
              mood === 'critical' || mood === 'distressed'
                ? 'M 113 134 Q 120 130 127 134'
                : mood === 'concerned'
                ? 'M 114 134 L 126 134'
                : 'M 113 132 Q 120 138 127 132'
            }
            stroke="#1a1a1a"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />

          {/* Whiskers */}
          <Whiskers />
        </g>

        {/* Accessories — rendered after head */}
        {equipped.map((key) => (
          <Accessory key={key} accKey={key} silhouette={silhouette} />
        ))}

        {/* Sleeping zzz */}
        {mood === 'critical' && (
          <motion.text
            x="170"
            y="78"
            fontSize="18"
            fill="var(--text-secondary)"
            animate={{ opacity: [0.3, 1, 0.3], y: [78, 70, 78] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            z
          </motion.text>
        )}
      </svg>
    </motion.div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────

function EarPair({ shape, palette, earTilt }) {
  if (shape === 'folded') {
    return (
      <g transform={`rotate(${earTilt} 120 110)`}>
        <path d="M 86 84 Q 90 100 102 96 Q 94 90 86 84" fill={palette.body} />
        <path d="M 154 84 Q 150 100 138 96 Q 146 90 154 84" fill={palette.body} />
      </g>
    );
  }
  if (shape === 'tufted') {
    return (
      <g transform={`rotate(${earTilt} 120 110)`}>
        <path d="M 84 92 L 98 60 L 110 92 Z" fill={palette.body} />
        <path d="M 130 92 L 142 60 L 156 92 Z" fill={palette.body} />
        <path d="M 96 60 L 100 50 L 104 60" stroke={palette.accent} strokeWidth="1.5" fill="none" />
        <path d="M 140 60 L 144 50 L 148 60" stroke={palette.accent} strokeWidth="1.5" fill="none" />
        <path d="M 90 88 L 100 70 L 106 88 Z" fill={palette.belly} opacity="0.6" />
        <path d="M 134 88 L 142 70 L 152 88 Z" fill={palette.belly} opacity="0.6" />
      </g>
    );
  }
  // pointed (default)
  return (
    <g transform={`rotate(${earTilt} 120 110)`}>
      <path d="M 84 96 L 98 64 L 112 92 Z" fill={palette.body} />
      <path d="M 128 92 L 142 64 L 156 96 Z" fill={palette.body} />
      <path d="M 92 90 L 100 74 L 106 90 Z" fill={palette.belly} opacity="0.7" />
      <path d="M 134 90 L 142 74 L 148 90 Z" fill={palette.belly} opacity="0.7" />
    </g>
  );
}

function Eye({ cx, cy, eyeColor, open, pupilTurn }) {
  const ry = 7 * open;
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx="7" ry={Math.max(0.5, ry)} fill="#0a0a0a" />
      {open > 0.4 && (
        <>
          <ellipse cx={cx} cy={cy} rx="5.5" ry={Math.max(0.4, ry - 1)} fill={eyeColor} />
          <ellipse cx={cx + pupilTurn} cy={cy} rx="2" ry={Math.max(0.3, ry - 1)} fill="#0a0a0a" />
          <circle cx={cx + 1.5} cy={cy - 1.5} r="1.2" fill="#ffffff" opacity="0.85" />
        </>
      )}
    </g>
  );
}

function Whiskers() {
  return (
    <g stroke="#a0a0a0" strokeWidth="0.9" strokeLinecap="round" opacity="0.6">
      <line x1="86" y1="124" x2="62" y2="120" />
      <line x1="86" y1="128" x2="62" y2="130" />
      <line x1="154" y1="124" x2="178" y2="120" />
      <line x1="154" y1="128" x2="178" y2="130" />
    </g>
  );
}

function Accessory({ accKey }) {
  const acc = getAccessory(accKey);
  if (!acc) return null;
  switch (accKey) {
    case 'collar_red':
    case 'collar_blue':
    case 'collar_green':
      return <rect x="98" y="148" width="44" height="6" rx="3" fill={acc.color} />;
    case 'bow_tie':
      return (
        <g>
          <rect x="98" y="148" width="44" height="4" rx="2" fill="#1a1a1a" />
          <path d="M 110 150 L 100 144 L 100 156 Z" fill={acc.color} />
          <path d="M 130 150 L 140 144 L 140 156 Z" fill={acc.color} />
          <circle cx="120" cy="150" r="3" fill="#444" />
        </g>
      );
    case 'bell_collar':
      return (
        <g>
          <rect x="98" y="148" width="44" height="6" rx="3" fill="#3a3a3a" />
          <circle cx="120" cy="158" r="4" fill={acc.color} stroke="#806020" strokeWidth="0.8" />
        </g>
      );
    case 'wizard_hat':
      return (
        <g>
          <path d="M 100 70 L 120 28 L 140 70 Z" fill={acc.color} />
          <ellipse cx="120" cy="72" rx="26" ry="4" fill={acc.color} />
          <circle cx="115" cy="56" r="1.6" fill="#fff5a8" />
          <circle cx="125" cy="46" r="1.2" fill="#fff5a8" />
        </g>
      );
    case 'crown':
      return (
        <g>
          <path d="M 96 76 L 102 56 L 110 70 L 120 50 L 130 70 L 138 56 L 144 76 Z" fill={acc.color} stroke="#806020" strokeWidth="1" />
          <circle cx="120" cy="62" r="2.2" fill="#c44040" />
          <circle cx="106" cy="68" r="1.6" fill="#3f7fc8" />
          <circle cx="134" cy="68" r="1.6" fill="#5ca35a" />
        </g>
      );
    case 'cape':
      return (
        <path
          d="M 92 150 Q 70 200 90 230 L 150 230 Q 170 200 148 150 Z"
          fill={acc.color}
          opacity="0.85"
        />
      );
    case 'knights_helm':
      return (
        <g>
          <path d="M 90 86 Q 90 56 120 50 Q 150 56 150 86 L 150 100 Q 120 108 90 100 Z" fill={acc.color} />
          <rect x="106" y="84" width="28" height="6" fill="#1a1a1a" />
          <path d="M 116 50 Q 120 36 124 50" stroke="#c44040" strokeWidth="2" fill="none" />
        </g>
      );
    case 'ravens_perch':
      return (
        <g>
          <ellipse cx="170" cy="120" rx="8" ry="5" fill={acc.color} />
          <path d="M 168 116 L 165 110 L 172 114 Z" fill={acc.color} />
          <circle cx="173" cy="119" r="1" fill="#c44040" />
        </g>
      );
    case 'halo':
      return (
        <g>
          <ellipse cx="120" cy="56" rx="28" ry="6" fill="none" stroke={acc.color} strokeWidth="3" opacity="0.95" />
        </g>
      );
    case 'golden_wings':
      return (
        <g opacity="0.92">
          <path d="M 80 150 Q 40 130 50 180 Q 70 170 80 170 Z" fill={acc.color} />
          <path d="M 160 150 Q 200 130 190 180 Q 170 170 160 170 Z" fill={acc.color} />
        </g>
      );
    case 'dragon_wings':
      return (
        <g>
          <path d="M 80 148 Q 30 110 28 170 Q 50 168 80 168 Z" fill={acc.color} stroke="#1a0a04" strokeWidth="1" />
          <path d="M 160 148 Q 210 110 212 170 Q 190 168 160 168 Z" fill={acc.color} stroke="#1a0a04" strokeWidth="1" />
        </g>
      );
    default:
      return null;
  }
}
