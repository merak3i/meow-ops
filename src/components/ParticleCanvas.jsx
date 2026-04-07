import { useEffect, useRef } from 'react';

// Shared atmospheric particle layer used by Companion rooms, Pomodoro, etc.
// Configurable via props so each scene can tune its mood.
//
// Props:
//   count       — number of particles (default 60)
//   color       — rgb string base e.g. '255, 255, 255'
//   speed       — base velocity multiplier (default 0.3)
//   size        — base radius multiplier (default 1)
//   opacityMax  — top-end alpha (default 0.1)
//   style       — additional style overrides

export default function ParticleCanvas({
  count = 60,
  color = '255, 255, 255',
  speed = 0.3,
  size = 1,
  opacityMax = 0.1,
  style = {},
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    const particles = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        r: (Math.random() * 2 + 0.5) * size,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * (speed * 0.7),
        opacity: Math.random() * opacityMax + 0.02,
      });
    }

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${p.opacity})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [count, color, speed, size, opacityMax]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
}
