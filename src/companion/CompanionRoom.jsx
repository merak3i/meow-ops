import { useEffect, useState } from 'react';
import ParticleCanvas from '../components/ParticleCanvas';
import { getRoom } from '../lib/companion-rooms';

// CompanionRoom — layered scene background.
// Each tier is a unique SVG/CSS scene built from the room palette.
// Optional override: if /companion/rooms/{key}.jpg exists in public/, it
// supersedes the SVG scene. This lets users drop in 4K renders without
// touching code.

export default function CompanionRoom({ roomKey, children }) {
  const room = getRoom(roomKey);
  const [hasImage, setHasImage] = useState(false);

  useEffect(() => {
    let aborted = false;
    const url = `/companion/rooms/${room.key}.jpg`;
    fetch(url, { method: 'HEAD' })
      .then((r) => { if (!aborted) setHasImage(r.ok); })
      .catch(() => { if (!aborted) setHasImage(false); });
    return () => { aborted = true; };
  }, [room.key]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        flex: 1,
        overflow: 'hidden',
        borderRadius: 16,
        background: hasImage
          ? `url(/companion/rooms/${room.key}.jpg) center/cover no-repeat`
          : `radial-gradient(ellipse at center bottom, ${room.palette.accent} 0%, ${room.palette.base} 70%)`,
        boxShadow: 'inset 0 0 80px rgba(0,0,0,0.6), inset 0 -120px 80px rgba(0,0,0,0.5)',
      }}
    >
      {!hasImage && <SceneSvg roomKey={room.key} palette={room.palette} />}
      {!hasImage && <ParticleCanvas count={particleCountFor(room.key)} color={particleColorFor(room.key)} opacityMax={0.12} speed={particleSpeedFor(room.key)} />}

      {/* Vignette */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Cat slot */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 28,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>

      {/* Room label */}
      <div
        style={{
          position: 'absolute',
          top: 16, left: 16,
          padding: '6px 12px',
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(8px)',
          borderRadius: 999,
          border: '1px solid var(--border)',
          fontSize: 11,
          letterSpacing: 0.5,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          fontWeight: 400,
        }}
      >
        {room.label}
      </div>
    </div>
  );
}

function particleCountFor(key) {
  switch (key) {
    case 'enchanted_tree': return 80;
    case 'wooden_cottage': return 100;
    case 'throne_room': return 30;
    default: return 50;
  }
}
function particleColorFor(key) {
  switch (key) {
    case 'enchanted_tree': return '180, 255, 200';
    case 'wooden_cottage': return '255, 240, 220';
    case 'castle_keep': return '220, 220, 255';
    case 'throne_room': return '255, 180, 80';
    case 'cushion_bed': return '220, 200, 255';
    default: return '255, 255, 255';
  }
}
function particleSpeedFor(key) {
  switch (key) {
    case 'wooden_cottage': return 0.5;
    case 'enchanted_tree': return 0.25;
    default: return 0.3;
  }
}

// ─── Scene SVGs (layered silhouettes per room tier) ────────────────

function SceneSvg({ roomKey, palette }) {
  switch (roomKey) {
    case 'corner_mat': return <CornerMatScene palette={palette} />;
    case 'cushion_bed': return <CushionBedScene palette={palette} />;
    case 'wooden_cottage': return <CottageScene palette={palette} />;
    case 'enchanted_tree': return <EnchantedTreeScene palette={palette} />;
    case 'castle_keep': return <CastleScene palette={palette} />;
    case 'throne_room': return <ThroneScene palette={palette} />;
    default: return null;
  }
}

function CornerMatScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0 }}>
      {/* Floor planks */}
      <rect x="0" y="380" width="800" height="100" fill={palette.accent} opacity="0.6" />
      <line x1="100" y1="380" x2="100" y2="480" stroke="#000" strokeWidth="0.6" opacity="0.4" />
      <line x1="280" y1="380" x2="280" y2="480" stroke="#000" strokeWidth="0.6" opacity="0.4" />
      <line x1="500" y1="380" x2="500" y2="480" stroke="#000" strokeWidth="0.6" opacity="0.4" />
      <line x1="680" y1="380" x2="680" y2="480" stroke="#000" strokeWidth="0.6" opacity="0.4" />
      {/* Wall corner */}
      <rect x="0" y="0" width="800" height="380" fill={palette.base} />
      <line x1="0" y1="380" x2="800" y2="380" stroke="#000" strokeWidth="1.5" opacity="0.5" />
      {/* Burlap mat */}
      <ellipse cx="400" cy="430" rx="170" ry="22" fill="#5a3a1a" opacity="0.85" />
      <ellipse cx="400" cy="426" rx="155" ry="18" fill="#7a4f24" />
      {/* Hanging window light */}
      <path d="M 540 0 L 600 0 L 590 90 L 550 90 Z" fill={palette.highlight} opacity="0.18" />
    </svg>
  );
}

function CushionBedScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0 }}>
      <rect x="0" y="380" width="800" height="100" fill={palette.accent} opacity="0.7" />
      <rect x="0" y="0" width="800" height="380" fill={palette.base} />
      {/* Tapestry */}
      <rect x="320" y="40" width="160" height="240" fill={palette.highlight} opacity="0.22" />
      <line x1="320" y1="40" x2="480" y2="40" stroke={palette.highlight} strokeWidth="3" opacity="0.45" />
      <circle cx="400" cy="160" r="32" fill="none" stroke={palette.highlight} strokeWidth="2" opacity="0.45" />
      <path d="M 380 150 L 400 130 L 420 150 L 415 175 L 400 165 L 385 175 Z" fill="none" stroke={palette.highlight} strokeWidth="1.5" opacity="0.55" />
      {/* Velvet cushion */}
      <ellipse cx="400" cy="430" rx="190" ry="28" fill={palette.highlight} opacity="0.55" />
      <ellipse cx="400" cy="425" rx="170" ry="22" fill={palette.highlight} opacity="0.85" />
      <ellipse cx="400" cy="420" rx="160" ry="18" fill={palette.highlight} />
      {/* Tassels */}
      <line x1="240" y1="430" x2="245" y2="450" stroke={palette.highlight} strokeWidth="2" />
      <line x1="560" y1="430" x2="555" y2="450" stroke={palette.highlight} strokeWidth="2" />
    </svg>
  );
}

function CottageScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0 }}>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Wood plank wall */}
      <rect x="0" y="0" width="800" height="380" fill={palette.accent} opacity="0.8" />
      {[40, 100, 160, 220, 280, 340].map((y) => (
        <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#000" strokeWidth="1" opacity="0.3" />
      ))}
      {/* Window */}
      <rect x="540" y="60" width="170" height="180" fill="#0a1428" stroke={palette.accent} strokeWidth="6" />
      <line x1="625" y1="60" x2="625" y2="240" stroke={palette.accent} strokeWidth="4" />
      <line x1="540" y1="150" x2="710" y2="150" stroke={palette.accent} strokeWidth="4" />
      {/* Snow particles inside window (static) */}
      {Array.from({ length: 20 }).map((_, i) => (
        <circle key={i} cx={550 + (i * 9) % 150} cy={80 + (i * 17) % 150} r="1.4" fill="#ffffff" opacity="0.7" />
      ))}
      {/* Floor */}
      <rect x="0" y="380" width="800" height="100" fill="#3a2410" />
    </svg>
  );
}

function EnchantedTreeScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0 }}>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Tree trunk silhouette */}
      <path d="M 100 480 L 140 200 Q 160 60 400 40 Q 640 60 660 200 L 700 480 Z" fill="#1a0c08" opacity="0.85" />
      {/* Hollow */}
      <ellipse cx="400" cy="350" rx="200" ry="120" fill={palette.base} />
      {/* Glowing fungi */}
      <circle cx="220" cy="330" r="6" fill={palette.highlight} opacity="0.7" />
      <circle cx="220" cy="330" r="14" fill={palette.highlight} opacity="0.18" />
      <circle cx="580" cy="320" r="5" fill={palette.highlight} opacity="0.7" />
      <circle cx="580" cy="320" r="12" fill={palette.highlight} opacity="0.18" />
      <circle cx="170" cy="380" r="4" fill={palette.highlight} opacity="0.6" />
      <circle cx="630" cy="370" r="4" fill={palette.highlight} opacity="0.6" />
      {/* Moss tufts */}
      <ellipse cx="280" cy="410" rx="40" ry="8" fill={palette.highlight} opacity="0.25" />
      <ellipse cx="520" cy="410" rx="40" ry="8" fill={palette.highlight} opacity="0.25" />
    </svg>
  );
}

function CastleScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0 }}>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Stone wall pattern */}
      <rect x="0" y="0" width="800" height="380" fill={palette.accent} opacity="0.65" />
      {Array.from({ length: 8 }).map((_, row) => (
        Array.from({ length: 14 }).map((__, col) => (
          <rect
            key={`${row}-${col}`}
            x={(col + (row % 2 ? 0.5 : 0)) * 60}
            y={row * 48}
            width="58"
            height="46"
            fill="none"
            stroke="#000"
            strokeWidth="0.6"
            opacity="0.35"
          />
        ))
      )).flat()}
      {/* Two arched windows with red glow */}
      <path d="M 180 80 Q 180 40 220 40 Q 260 40 260 80 L 260 200 L 180 200 Z" fill={palette.highlight} opacity="0.18" />
      <path d="M 540 80 Q 540 40 580 40 Q 620 40 620 80 L 620 200 L 540 200 Z" fill={palette.highlight} opacity="0.18" />
      {/* House banner */}
      <rect x="370" y="40" width="60" height="200" fill={palette.highlight} opacity="0.5" />
      <path d="M 370 240 L 400 220 L 430 240 Z" fill={palette.highlight} opacity="0.5" />
      {/* Stone floor */}
      <rect x="0" y="380" width="800" height="100" fill="#1a1a20" />
      <line x1="0" y1="380" x2="800" y2="380" stroke="#000" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}

function ThroneScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0 }}>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Marble columns */}
      <rect x="60" y="40" width="50" height="380" fill="#1a1a1a" />
      <rect x="690" y="40" width="50" height="380" fill="#1a1a1a" />
      <ellipse cx="85" cy="40" rx="40" ry="10" fill="#0a0a0a" />
      <ellipse cx="715" cy="40" rx="40" ry="10" fill="#0a0a0a" />
      {/* Throne back */}
      <path d="M 290 360 L 290 100 Q 290 60 340 50 L 460 50 Q 510 60 510 100 L 510 360 Z" fill="#1a1a1a" stroke={palette.highlight} strokeWidth="2" />
      {/* Iron throne swords sticking out */}
      {[300, 340, 380, 420, 460, 500].map((x, i) => (
        <line key={i} x1={x} y1="50" x2={x + (i % 2 === 0 ? -8 : 8)} y2={i % 2 === 0 ? 12 : 18} stroke="#9aa9b4" strokeWidth="2" />
      ))}
      <path d="M 300 50 L 500 50 L 470 30 L 330 30 Z" fill="#3a3a3a" />
      {/* Red carpet */}
      <path d="M 350 480 L 460 480 L 440 360 L 370 360 Z" fill={palette.highlight} opacity="0.7" />
      {/* Floor */}
      <rect x="0" y="420" width="800" height="60" fill="#0a0a0a" />
    </svg>
  );
}
