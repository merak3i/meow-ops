import { useEffect, useRef, useState } from 'react';
import ParticleCanvas from '../components/ParticleCanvas';
import { getRoom } from '../lib/companion-rooms';

// CompanionRoom — cinematic layered background with 3-depth mouse parallax.
//
// Parallax layers (all driven by mouse position in the room container):
//   Far   (background gradient / base)   — translates at 0.03x mouse delta
//   Mid   (SVG architecture / scene)     — translates at 0.07x mouse delta
//   Near  (particles / foreground)       — translates at 0.14x mouse delta
//   Cat   (always fixed in centre-bottom)— no parallax, stays anchored
//
// Optional 4K override: if /companion/rooms/{key}.jpg exists, the room
// image is used as the far layer instead of the gradient.

const roomImageCache = new Map();

function checkRoomImage(key) {
  if (roomImageCache.has(key)) return roomImageCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = `/companion/rooms/${key}.jpg`;
  });
  roomImageCache.set(key, p);
  return p;
}

export default function CompanionRoom({ roomKey, children }) {
  const room = getRoom(roomKey);
  const [hasImage, setHasImage] = useState(false);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    let aborted = false;
    checkRoomImage(room.key).then((ok) => { if (!aborted) setHasImage(ok); });
    return () => { aborted = true; };
  }, [room.key]);

  function handleMouseMove(e) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMouse({
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
    });
  }

  function handleMouseLeave() {
    setMouse({ x: 0, y: 0 });
  }

  const tx = (factor) => `translate(${mouse.x * factor * -1}px, ${mouse.y * factor * 0.75 * -1}px)`;
  const ease = 'transform 0.14s ease-out';

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        width: '100%',
        flex: 1,
        overflow: 'hidden',
        borderRadius: 16,
        boxShadow: 'inset 0 0 80px rgba(0,0,0,0.6), inset 0 -120px 80px rgba(0,0,0,0.45)',
      }}
    >
      {/* ── Far layer: background gradient or photo ── */}
      <div
        style={{
          position: 'absolute',
          inset: '-4%',
          background: hasImage
            ? `url(/companion/rooms/${room.key}.jpg) center/cover no-repeat`
            : `radial-gradient(ellipse at 45% 35%, ${room.palette.accent} 0%, ${room.palette.base} 68%)`,
          transform: tx(24),
          transition: ease,
        }}
      />

      {/* ── Mid layer: SVG scene architecture ── */}
      {!hasImage && (
        <div
          style={{
            position: 'absolute',
            inset: '-4%',
            transform: tx(52),
            transition: ease,
          }}
        >
          <SceneSvg roomKey={room.key} palette={room.palette} />
        </div>
      )}

      {/* ── Near layer: particles ── */}
      {!hasImage && (
        <div
          style={{
            position: 'absolute',
            inset: '-4%',
            transform: tx(92),
            transition: ease,
            pointerEvents: 'none',
          }}
        >
          <ParticleCanvas
            count={particleCountFor(room.key)}
            color={particleColorFor(room.key)}
            opacityMax={0.13}
            speed={particleSpeedFor(room.key)}
          />
        </div>
      )}

      {/* ── Cinematic vignette + bottom fog ── */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 40%, transparent 40%, rgba(0,0,0,0.52) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      {/* ── Cat slot (no parallax — anchored) ── */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 24,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 4,
        }}
      >
        {children}
      </div>

      {/* ── Room label chip ── */}
      <div
        style={{
          position: 'absolute',
          top: 14, left: 14,
          padding: '5px 12px',
          background: 'rgba(0,0,0,0.48)',
          backdropFilter: 'blur(10px)',
          borderRadius: 999,
          border: '1px solid var(--border)',
          fontSize: 10,
          letterSpacing: 0.8,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          fontWeight: 400,
          zIndex: 5,
        }}
      >
        {room.label}
      </div>
    </div>
  );
}

// ─── Particle helpers ───────────────────────────────────────────────────────

function particleCountFor(key) {
  switch (key) {
    case 'enchanted_tree': return 90;
    case 'wooden_cottage': return 110;
    case 'throne_room': return 35;
    case 'castle_keep': return 45;
    default: return 55;
  }
}
function particleColorFor(key) {
  switch (key) {
    case 'enchanted_tree': return '160, 255, 180';
    case 'wooden_cottage': return '255, 235, 210';
    case 'castle_keep': return '200, 200, 240';
    case 'throne_room': return '255, 160, 70';
    case 'cushion_bed': return '210, 190, 255';
    default: return '255, 255, 255';
  }
}
function particleSpeedFor(key) {
  switch (key) {
    case 'wooden_cottage': return 0.45;
    case 'enchanted_tree': return 0.22;
    default: return 0.28;
  }
}

// ─── Scene SVGs ─────────────────────────────────────────────────────────────

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
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice"
      style={{ position: 'absolute', inset: 0 }}>
      {/* Wall */}
      <rect x="0" y="0" width="800" height="380" fill={palette.base} />
      {/* Wallpaper texture lines */}
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="0" y1={i * 34} x2="800" y2={i * 34}
          stroke={palette.accent} strokeWidth="0.5" opacity="0.25" />
      ))}
      {/* Warm light shaft from upper-right window */}
      <polygon points="620,0 720,0 680,380 560,380"
        fill={palette.highlight} opacity="0.06" />
      {/* Window frame */}
      <rect x="560" y="30" width="140" height="190" rx="4"
        fill="#0a1428" stroke={palette.accent} strokeWidth="5" />
      <line x1="630" y1="30" x2="630" y2="220" stroke={palette.accent} strokeWidth="3.5" />
      <line x1="560" y1="125" x2="700" y2="125" stroke={palette.accent} strokeWidth="3.5" />
      {/* Rain drops on window */}
      {Array.from({ length: 16 }, (_, i) => (
        <line key={i}
          x1={572 + (i * 8.5) % 120} y1={44 + (i * 11) % 60}
          x2={572 + (i * 8.5) % 120} y2={52 + (i * 11) % 60}
          stroke="rgba(180,210,255,0.55)" strokeWidth="1" />
      ))}
      {/* Floor planks */}
      <rect x="0" y="380" width="800" height="100" fill={palette.accent} opacity="0.65" />
      <line x1="0" y1="380" x2="800" y2="380" stroke="#000" strokeWidth="1.8" opacity="0.55" />
      {[110, 290, 510, 690].map((x) => (
        <line key={x} x1={x} y1="380" x2={x} y2="480" stroke="#000" strokeWidth="0.7" opacity="0.35" />
      ))}
      {/* Burlap mat */}
      <ellipse cx="400" cy="435" rx="175" ry="24" fill="#4a3015" opacity="0.88" />
      <ellipse cx="400" cy="431" rx="160" ry="19" fill="#6a4820" />
      {/* Mat weave lines */}
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={260 + i * 18} y1="422" x2={260 + i * 18} y2="442"
          stroke="#4a3015" strokeWidth="1.5" opacity="0.5" />
      ))}
    </svg>
  );
}

function CushionBedScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice"
      style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="candle-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.highlight} stopOpacity="0.35" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      <rect x="0" y="380" width="800" height="100" fill={palette.accent} opacity="0.7" />
      {/* Tapestry */}
      <rect x="310" y="30" width="180" height="260" fill={palette.highlight} opacity="0.2" />
      <line x1="310" y1="30" x2="490" y2="30" stroke={palette.highlight} strokeWidth="5" opacity="0.5" />
      <circle cx="400" cy="160" r="36" fill="none" stroke={palette.highlight} strokeWidth="2.5" opacity="0.45" />
      <path d="M 378 148 L 400 126 L 422 148 L 416 178 L 400 166 L 384 178 Z"
        fill="none" stroke={palette.highlight} strokeWidth="2" opacity="0.55" />
      {/* Tassel fringe at bottom of tapestry */}
      {Array.from({ length: 10 }, (_, i) => (
        <line key={i} x1={318 + i * 18} y1="290" x2={316 + i * 18} y2="314"
          stroke={palette.highlight} strokeWidth="2.5" opacity="0.45" />
      ))}
      {/* Candle sconce right */}
      <rect x="700" y="120" width="12" height="50" rx="2" fill="#f0e090" />
      <motion.ellipse cx="706" cy="118" rx="5" ry="7" fill="#ff9030" opacity="0.9"
        style={{ animation: 'none' }} />
      <ellipse cx="706" cy="115" rx="3" ry="5" fill="#fff5b0" opacity="0.8" />
      <circle cx="706" cy="140" r="40" fill="url(#candle-glow)" />
      {/* Velvet cushion */}
      <ellipse cx="400" cy="430" rx="195" ry="30" fill={palette.highlight} opacity="0.5" />
      <ellipse cx="400" cy="425" rx="176" ry="23" fill={palette.highlight} opacity="0.82" />
      <ellipse cx="400" cy="420" rx="162" ry="19" fill={palette.highlight} />
      <ellipse cx="400" cy="419" rx="140" ry="14" fill={palette.highlight} opacity="0.4" />
      {/* Button dimple centre */}
      <circle cx="400" cy="420" r="5" fill="none" stroke={palette.base} strokeWidth="1.5" opacity="0.5" />
      {/* Tassels */}
      <line x1="236" y1="430" x2="232" y2="454" stroke={palette.highlight} strokeWidth="3" />
      <line x1="564" y1="430" x2="568" y2="454" stroke={palette.highlight} strokeWidth="3" />
    </svg>
  );
}

function CottageScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice"
      style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="fire-glow" cx="50%" cy="100%" r="70%">
          <stop offset="0%" stopColor="#ff8030" stopOpacity="0.45" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Wood plank wall */}
      <rect x="0" y="0" width="800" height="380" fill={palette.accent} opacity="0.8" />
      {[35, 80, 125, 170, 215, 260, 305, 350].map((y) => (
        <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#000" strokeWidth="0.9" opacity="0.28" />
      ))}
      {/* Vertical plank joins */}
      {[200, 400, 600].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="380" stroke="#000" strokeWidth="0.5" opacity="0.18" />
      ))}
      {/* Frosted window */}
      <rect x="530" y="48" width="190" height="200" fill="#0a1428" stroke={palette.accent} strokeWidth="6" rx="4" />
      <line x1="625" y1="48" x2="625" y2="248" stroke={palette.accent} strokeWidth="4.5" />
      <line x1="530" y1="148" x2="720" y2="148" stroke={palette.accent} strokeWidth="4.5" />
      {/* Snow on window sill */}
      <path d="M 530 248 Q 625 242 720 248" stroke="white" strokeWidth="6" fill="none" opacity="0.7" />
      {/* Snowflakes outside */}
      {Array.from({ length: 28 }, (_, i) => (
        <circle key={i}
          cx={545 + (i * 7.2) % 160}
          cy={62 + (i * 19) % 168}
          r="1.6" fill="white" opacity="0.65" />
      ))}
      {/* Bookshelf silhouette left */}
      <rect x="60" y="80" width="100" height="280" fill={palette.accent} opacity="0.6" />
      <rect x="60" y="80" width="100" height="8" fill={palette.base} opacity="0.8" />
      {[130, 180, 230, 280].map((y) => (
        <rect key={y} x="64" y={y} width="92" height="8" rx="1"
          fill={palette.base} opacity="0.5" />
      ))}
      {/* Book spines */}
      {[90, 110, 134, 155, 195, 218, 245, 260].map((y, i) => (
        <rect key={y} x="65" y={y} width="88" height={14 + (i % 3) * 4} rx="1"
          fill={['#7a2020','#2a4a7a','#3a6a3a','#6a3a1a'][i % 4]}
          opacity="0.7" />
      ))}
      {/* Hearth */}
      <rect x="300" y="300" width="200" height="80" rx="4" fill={palette.base} opacity="0.5" />
      <path d="M 300 380 L 280 300 L 500 300 L 520 380 Z" fill={palette.base} opacity="0.35" />
      {/* Fire */}
      <ellipse cx="400" cy="320" rx="30" ry="22" fill="#ff8030" opacity="0.85" />
      <ellipse cx="400" cy="315" rx="18" ry="14" fill="#ffcc30" opacity="0.9" />
      <ellipse cx="400" cy="312" rx="10" ry="8" fill="#fff5b0" opacity="0.7" />
      <circle cx="400" cy="340" r="70" fill="url(#fire-glow)" />
      {/* Floor */}
      <rect x="0" y="380" width="800" height="100" fill="#2a1a0c" />
      <line x1="0" y1="380" x2="800" y2="380" stroke="#000" strokeWidth="1.8" opacity="0.6" />
    </svg>
  );
}

function EnchantedTreeScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice"
      style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="fungi-glow-l" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.highlight} stopOpacity="0.5" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="fungi-glow-r" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.highlight} stopOpacity="0.45" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Tree trunk */}
      <path d="M 60 480 L 108 180 Q 130 40 400 28 Q 670 40 692 180 L 740 480 Z"
        fill="#140a04" opacity="0.88" />
      {/* Bark texture lines */}
      {[0.18, 0.32, 0.48, 0.62, 0.78].map((t, i) => (
        <path key={i}
          d={`M ${60 + t * 680} 480 Q ${80 + t * 640} ${240 + i * 30} ${(t > 0.5 ? 460 + (t - 0.5) * 400 : 340 - t * 400)} 60`}
          stroke="#1e0e06" strokeWidth="2.5" fill="none" opacity="0.5" />
      ))}
      {/* Hollow interior */}
      <ellipse cx="400" cy="355" rx="210" ry="125" fill={palette.base} />
      {/* Hollow shading */}
      <ellipse cx="400" cy="370" rx="185" ry="100" fill={darkenColor(palette.base, 0.15)} />
      {/* Bioluminescent fungi left */}
      <circle cx="215" cy="330" r="40" fill="url(#fungi-glow-l)" />
      <ellipse cx="215" cy="344" rx="22" ry="12" fill={palette.accent} opacity="0.7" />
      <ellipse cx="215" cy="338" rx="16" ry="9" fill={palette.highlight} opacity="0.85" />
      <ellipse cx="212" cy="334" rx="6" ry="5" fill="#ffffff" opacity="0.5" />
      {/* Fungi right */}
      <circle cx="585" cy="320" r="34" fill="url(#fungi-glow-r)" />
      <ellipse cx="585" cy="332" rx="18" ry="10" fill={palette.accent} opacity="0.7" />
      <ellipse cx="585" cy="326" rx="13" ry="7" fill={palette.highlight} opacity="0.85" />
      <ellipse cx="582" cy="322" rx="5" ry="4" fill="#ffffff" opacity="0.5" />
      {/* Small accent fungi */}
      <ellipse cx="170" cy="385" rx="10" ry="5" fill={palette.highlight} opacity="0.6" />
      <ellipse cx="638" cy="375" rx="9" ry="4.5" fill={palette.highlight} opacity="0.6" />
      {/* Hanging vine tendrils */}
      {[280, 360, 440, 520].map((x, i) => (
        <path key={x}
          d={`M ${x} 28 Q ${x + (i % 2 ? 10 : -10)} ${160 + i * 20} ${x + (i % 2 ? 5 : -5)} ${280 + i * 15}`}
          stroke={palette.accent} strokeWidth="2" fill="none" opacity="0.4" />
      ))}
      {/* Moss tufts */}
      <ellipse cx="280" cy="415" rx="45" ry="9" fill={palette.highlight} opacity="0.22" />
      <ellipse cx="520" cy="415" rx="45" ry="9" fill={palette.highlight} opacity="0.22" />
      {/* Floor roots */}
      <path d="M 200 480 Q 300 440 400 460 Q 500 440 600 480"
        stroke="#140a04" strokeWidth="18" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CastleScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice"
      style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="torch-l" cx="50%" cy="100%" r="80%">
          <stop offset="0%" stopColor="#ff9040" stopOpacity="0.4" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="torch-r" cx="50%" cy="100%" r="80%">
          <stop offset="0%" stopColor="#ff9040" stopOpacity="0.4" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Stone wall */}
      <rect x="0" y="0" width="800" height="380" fill={palette.accent} opacity="0.62" />
      {Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 14 }, (__, col) => (
          <rect key={`${row}-${col}`}
            x={(col + (row % 2 ? 0.5 : 0)) * 60}
            y={row * 50}
            width="57" height="47"
            fill="none"
            stroke="#000" strokeWidth="0.55" opacity="0.3"
          />
        ))
      ).flat()}
      {/* Arched windows with coloured glow */}
      <path d="M 165 70 Q 165 28 210 28 Q 255 28 255 70 L 255 210 L 165 210 Z"
        fill={palette.highlight} opacity="0.16" />
      <path d="M 545 70 Q 545 28 590 28 Q 635 28 635 70 L 635 210 L 545 210 Z"
        fill={palette.highlight} opacity="0.16" />
      {/* Window frames */}
      <path d="M 165 70 Q 165 28 210 28 Q 255 28 255 70 L 255 210 L 165 210 Z"
        fill="none" stroke={palette.accent} strokeWidth="4" />
      <path d="M 545 70 Q 545 28 590 28 Q 635 28 635 70 L 635 210 L 545 210 Z"
        fill="none" stroke={palette.accent} strokeWidth="4" />
      {/* Torch sconces */}
      <rect x="155" y="220" width="10" height="32" rx="2" fill="#c08020" />
      <ellipse cx="160" cy="218" rx="5" ry="8" fill="#ff8030" opacity="0.9" />
      <ellipse cx="160" cy="214" rx="3" ry="5" fill="#ffe090" opacity="0.8" />
      <circle cx="160" cy="240" r="50" fill="url(#torch-l)" />
      <rect x="635" y="220" width="10" height="32" rx="2" fill="#c08020" />
      <ellipse cx="640" cy="218" rx="5" ry="8" fill="#ff8030" opacity="0.9" />
      <ellipse cx="640" cy="214" rx="3" ry="5" fill="#ffe090" opacity="0.8" />
      <circle cx="640" cy="240" r="50" fill="url(#torch-r)" />
      {/* House banner */}
      <rect x="366" y="28" width="68" height="220" fill={palette.highlight} opacity="0.48" />
      <path d="M 366 248 L 400 226 L 434 248 Z" fill={palette.highlight} opacity="0.48" />
      {/* Banner emblem */}
      <path d="M 380 120 L 400 100 L 420 120 L 414 148 L 400 138 L 386 148 Z"
        fill="none" stroke={palette.base} strokeWidth="2" opacity="0.5" />
      {/* Stone floor */}
      <rect x="0" y="380" width="800" height="100" fill="#141420" />
      <line x1="0" y1="380" x2="800" y2="380" stroke="#000" strokeWidth="2" opacity="0.65" />
      {/* Floor tile joints */}
      {[160, 320, 480, 640].map((x) => (
        <line key={x} x1={x} y1="380" x2={x} y2="480" stroke="#1a1a28" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function ThroneScene({ palette }) {
  return (
    <svg viewBox="0 0 800 480" width="100%" height="100%" preserveAspectRatio="xMidYMax slice"
      style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="ember-glow" cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor={palette.highlight} stopOpacity="0.5" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="smoke-center" cx="50%" cy="80%" r="70%">
          <stop offset="0%" stopColor="rgba(80,80,80,0.18)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="480" fill={palette.base} />
      {/* Marble column left */}
      <rect x="44" y="28" width="58" height="392" fill="#141414" />
      <line x1="52" y1="28" x2="52" y2="420" stroke="#1e1e1e" strokeWidth="2" />
      <line x1="62" y1="28" x2="62" y2="420" stroke="#222" strokeWidth="1" opacity="0.5" />
      <ellipse cx="73" cy="28" rx="46" ry="12" fill="#0a0a0a" />
      <ellipse cx="73" cy="420" rx="46" ry="12" fill="#0a0a0a" />
      {/* Marble column right */}
      <rect x="698" y="28" width="58" height="392" fill="#141414" />
      <line x1="748" y1="28" x2="748" y2="420" stroke="#1e1e1e" strokeWidth="2" />
      <ellipse cx="727" cy="28" rx="46" ry="12" fill="#0a0a0a" />
      <ellipse cx="727" cy="420" rx="46" ry="12" fill="#0a0a0a" />
      {/* Throne back */}
      <path d="M 282 370 L 282 88 Q 282 44 336 36 L 464 36 Q 518 44 518 88 L 518 370 Z"
        fill="#111111" stroke={palette.highlight} strokeWidth="2.5" />
      {/* Sword cluster decoration */}
      {[295, 330, 365, 400, 435, 470, 505].map((x, i) => (
        <g key={x}>
          <line x1={x} y1="36" x2={x + (i % 2 === 0 ? -9 : 9)} y2={i % 2 === 0 ? -2 : 4}
            stroke="#7a8a94" strokeWidth="2.5" />
          <polygon points={`${x + (i % 2 === 0 ? -9 : 9) - 2},${i % 2 === 0 ? -2 : 4} ${x + (i % 2 === 0 ? -9 : 9) + 2},${i % 2 === 0 ? -2 : 4} ${x + (i % 2 === 0 ? -9 : 9)},${i % 2 === 0 ? -8 : -4}`}
            fill="#aabac4" />
        </g>
      ))}
      <path d="M 290 36 L 510 36 L 478 18 L 322 18 Z" fill="#2a2a2a" />
      {/* Armrests */}
      <rect x="282" y="220" width="48" height="18" rx="4" fill="#1a1a1a" stroke={palette.highlight} strokeWidth="1" />
      <rect x="470" y="220" width="48" height="18" rx="4" fill="#1a1a1a" stroke={palette.highlight} strokeWidth="1" />
      {/* Red carpet */}
      <path d="M 345 480 L 455 480 L 438 370 L 362 370 Z" fill={palette.highlight} opacity="0.68" />
      {/* Carpet fringe */}
      {[348, 364, 380, 396, 412, 428, 444].map((x) => (
        <line key={x} x1={x} y1="480" x2={x - 2} y2="492"
          stroke={palette.highlight} strokeWidth="2" opacity="0.5" />
      ))}
      {/* Ember braziers */}
      <ellipse cx="160" cy="380" rx="28" ry="12" fill="#1a1a14" />
      <ellipse cx="160" cy="370" rx="22" ry="9" fill={palette.highlight} opacity="0.6" />
      <ellipse cx="160" cy="366" rx="14" ry="6" fill="#ffcc60" opacity="0.75" />
      <circle cx="160" cy="360" r="55" fill="url(#ember-glow)" />
      <ellipse cx="640" cy="380" rx="28" ry="12" fill="#1a1a14" />
      <ellipse cx="640" cy="370" rx="22" ry="9" fill={palette.highlight} opacity="0.6" />
      <ellipse cx="640" cy="366" rx="14" ry="6" fill="#ffcc60" opacity="0.75" />
      <circle cx="640" cy="360" r="55" fill="url(#ember-glow)" />
      {/* Smoke wisps */}
      <ellipse cx="400" cy="200" rx="120" ry="60" fill="url(#smoke-center)" />
      {/* Black marble floor */}
      <rect x="0" y="420" width="800" height="60" fill="#050508" />
      <line x1="0" y1="420" x2="800" y2="420" stroke="#000" strokeWidth="1.5" opacity="0.8" />
      {/* Marble veins */}
      <path d="M 100 420 Q 200 435 300 425 Q 400 440 500 428 Q 600 442 700 430"
        stroke="#141428" strokeWidth="1.5" fill="none" opacity="0.6" />
      {/* Skull decorations at column bases */}
      <ellipse cx="73" cy="428" rx="9" ry="8" fill="#181818" />
      <circle cx="70" cy="426" r="1.5" fill="#252525" />
      <circle cx="76" cy="426" r="1.5" fill="#252525" />
      <ellipse cx="727" cy="428" rx="9" ry="8" fill="#181818" />
      <circle cx="724" cy="426" r="1.5" fill="#252525" />
      <circle cx="730" cy="426" r="1.5" fill="#252525" />
    </svg>
  );
}

// Quick darken helper for SVG (no import needed)
function darkenColor(hex, amount) {
  if (!hex?.startsWith('#')) return hex || '#111';
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map((v) => clamp(v * (1 - amount)).toString(16).padStart(2, '0')).join('');
}
