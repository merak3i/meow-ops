import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCatMeta } from '../lib/cat-classifier';
import { formatTokens, formatCost, formatDuration } from '../lib/format';

function ParticleCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animId;
    const particles = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        r: Math.random() * 2 + 0.5,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.2,
        opacity: Math.random() * 0.08 + 0.02,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.offsetWidth;
        if (p.x > canvas.offsetWidth) p.x = 0;
        if (p.y < 0) p.y = canvas.offsetHeight;
        if (p.y > canvas.offsetHeight) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

function CatSprite({ session, index, onClick }) {
  const cat = getCatMeta(session.cat_type);
  const isGhost = session.is_ghost;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: isGhost ? 0.2 : 1,
        scale: 1,
        y: [0, -4, 0],
      }}
      transition={{
        opacity: { duration: 0.5, delay: index * 0.03 },
        scale: { duration: 0.5, delay: index * 0.03 },
        y: { duration: 3 + Math.random() * 2, repeat: Infinity, ease: 'easeInOut', delay: Math.random() * 2 },
      }}
      onClick={() => onClick(session)}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        filter: isGhost ? 'grayscale(1)' : 'none',
      }}
      whileHover={{ scale: 1.15 }}
    >
      <span style={{ fontSize: 28 }}>{cat.icon}</span>
      <span style={{
        fontSize: 9,
        color: isGhost ? 'var(--text-muted)' : cat.color,
        fontWeight: 500,
        textAlign: 'center',
        maxWidth: 60,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {cat.label}
      </span>
    </motion.div>
  );
}

function Building({ project, sessions, onCatClick }) {
  const height = Math.min(sessions.length * 12 + 60, 200);
  const totalTokens = sessions.reduce((a, s) => a + s.total_tokens, 0);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      style={{
        padding: 16,
        minHeight: height,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: 'var(--accent)',
        opacity: 0.5,
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ fontSize: 15, fontWeight: 300 }}>{project}</h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {formatTokens(totalTokens)}
        </span>
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
        flex: 1,
        alignContent: 'center',
      }}>
        {sessions.slice(0, 12).map((s, i) => (
          <CatSprite key={s.session_id} session={s} index={i} onClick={onCatClick} />
        ))}
        {sessions.length > 12 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
            +{sessions.length - 12} more
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        {sessions.length} sessions
      </div>
    </motion.div>
  );
}

function CatDetail({ session, onClose }) {
  const cat = getCatMeta(session.cat_type);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="card"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        padding: 20,
        width: 280,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
      }}
      onClick={onClose}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 32 }}>{cat.icon}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{cat.label} Cat</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{session.project}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Model</span>
          <span style={{ color: session.model?.includes('opus') ? 'var(--purple)' : 'var(--accent)' }}>
            {session.model?.includes('opus') ? 'Opus' : 'Sonnet'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{formatDuration(session.duration_seconds)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Tokens</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{formatTokens(session.total_tokens)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Cost</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--green)' }}>{formatCost(session.estimated_cost_usd)}</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function ColonyView({ sessions }) {
  const [selectedCat, setSelectedCat] = useState(null);

  const byProject = {};
  for (const s of sessions) {
    if (!byProject[s.project]) byProject[s.project] = [];
    byProject[s.project].push(s);
  }
  const projects = Object.entries(byProject).sort((a, b) => b[1].length - a[1].length);

  const totalCats = sessions.length;
  const ghostCount = sessions.filter((s) => s.is_ghost).length;
  const healthPct = totalCats > 0 ? (((totalCats - ghostCount) / totalCats) * 100).toFixed(0) : 100;

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <ParticleCanvas />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 22 }}>Cat Colony</h2>
          <div className="card" style={{ padding: '8px 16px', display: 'flex', gap: 20, fontSize: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Population: <span style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{totalCats}</span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Health: <span style={{ color: parseInt(healthPct) > 80 ? 'var(--green)' : 'var(--amber)', fontFamily: 'JetBrains Mono, monospace' }}>{healthPct}%</span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Ghosts: <span style={{ color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>{ghostCount}</span>
            </span>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}>
          {projects.map(([project, sess]) => (
            <Building key={project} project={project} sessions={sess} onCatClick={setSelectedCat} />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selectedCat && <CatDetail session={selectedCat} onClose={() => setSelectedCat(null)} />}
      </AnimatePresence>
    </div>
  );
}
