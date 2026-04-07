import { useEffect, useRef } from 'react';

// CompanionEffects — canvas-based physics particle system.
// Each action triggers a burst of physically-simulated particles:
//   feed     → food sprite arcs into cat mouth + gold sparkle burst
//   play     → confetti explosion in breed palette colours
//   groom    → glitter stars float upward with bloom glow
//   sleep    → zzz text sprites rise and fade
//   level_up → explosive gold star burst + expanding ring
//   critical → teardrop sweat drops fall from head
//
// Canvas is fixed over the companion area, pointer-events: none.
// All particles auto-die; canvas clears when pool is empty.

// ─── Particle ─────────────────────────────────────────────────────────────

class Particle {
  constructor({ x, y, vx, vy, gravity = 0, drag = 1, life, size, color, shape = 'circle', text = null, bloom = false, rotSpeed = 0 }) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.gravity = gravity; this.drag = drag;
    this.life = life; this.maxLife = life;
    this.size = size; this.color = color;
    this.shape = shape; this.text = text;
    this.bloom = bloom;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = rotSpeed;
  }

  get alive() { return this.life > 0; }
  get alpha() { return Math.max(0, this.life / this.maxLife); }

  update(dt) {
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rotation += this.rotSpeed * dt;
    this.life -= dt;
  }

  draw(ctx) {
    const a = this.alpha;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    if (this.bloom) {
      ctx.globalCompositeOperation = 'screen';
    }

    if (this.text) {
      const scale = 1 + (1 - a) * 0.8;
      ctx.scale(scale, scale);
      ctx.font = `${this.size}px monospace`;
      ctx.fillStyle = this.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.text, 0, 0);
    } else if (this.shape === 'star4') {
      this._drawStar4(ctx);
    } else if (this.shape === 'star6') {
      this._drawStar6(ctx);
    } else if (this.shape === 'rect') {
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
    } else if (this.shape === 'ring') {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.shape === 'drop') {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.moveTo(-this.size * 0.6, -this.size * 0.4);
      ctx.lineTo(0, -this.size * 2);
      ctx.lineTo(this.size * 0.6, -this.size * 0.4);
      ctx.closePath();
      ctx.fill();
    } else {
      // circle
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      if (this.bloom) {
        ctx.globalAlpha = a * 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  _drawStar4(ctx) {
    const r = this.size;
    const ir = r * 0.35;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : ir;
      if (i === 0) ctx.moveTo(Math.cos(angle) * rad, Math.sin(angle) * rad);
      else ctx.lineTo(Math.cos(angle) * rad, Math.sin(angle) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  _drawStar6(ctx) {
    const r = this.size;
    const ir = r * 0.45;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : ir;
      if (i === 0) ctx.moveTo(Math.cos(angle) * rad, Math.sin(angle) * rad);
      else ctx.lineTo(Math.cos(angle) * rad, Math.sin(angle) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
}

// ─── Effect factories ──────────────────────────────────────────────────────

function rand(min, max) { return min + Math.random() * (max - min); }

function makeFeedEffect(cx, cy) {
  const particles = [];
  // Gold sparkle burst at impact point
  for (let i = 0; i < 16; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(1.5, 5);
    particles.push(new Particle({
      x: cx, y: cy - 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      gravity: 0.12, drag: 0.97,
      life: rand(40, 80),
      size: rand(4, 9),
      color: `hsl(${rand(38, 52)}, 100%, ${rand(60, 75)}%)`,
      shape: 'star4',
      bloom: true,
      rotSpeed: rand(-0.15, 0.15),
    }));
  }
  // Smaller shimmer circles
  for (let i = 0; i < 10; i++) {
    const angle = rand(0, Math.PI * 2);
    particles.push(new Particle({
      x: cx + rand(-20, 20),
      y: cy - 50 + rand(-20, 20),
      vx: Math.cos(angle) * rand(0.5, 2.5),
      vy: Math.sin(angle) * rand(0.5, 2.5) - 1,
      gravity: 0.05, drag: 0.98,
      life: rand(30, 60),
      size: rand(2, 5),
      color: '#fff8c0',
      shape: 'circle',
      bloom: true,
    }));
  }
  return particles;
}

function makePlayEffect(cx, cy, palette) {
  const particles = [];
  const colors = [
    palette?.eyes || '#7ac74f',
    palette?.accent || '#e87858',
    palette?.body || '#dca35a',
    '#ff6688', '#88ccff', '#ffee44',
  ];
  for (let i = 0; i < 24; i++) {
    const angle = rand(-Math.PI, 0); // upward hemisphere
    const speed = rand(3, 9);
    particles.push(new Particle({
      x: cx + rand(-30, 30),
      y: cy - 20,
      vx: Math.cos(angle) * speed * rand(0.5, 1.5),
      vy: Math.sin(angle) * speed,
      gravity: 0.18, drag: 0.97,
      life: rand(50, 90),
      size: rand(6, 12),
      color: colors[Math.floor(rand(0, colors.length))],
      shape: 'rect',
      rotSpeed: rand(-0.2, 0.2),
    }));
  }
  // Heart floaters
  for (let i = 0; i < 5; i++) {
    particles.push(new Particle({
      x: cx + rand(-50, 50),
      y: cy - rand(20, 60),
      vx: rand(-1, 1),
      vy: rand(-1.5, -3),
      gravity: 0, drag: 0.99,
      life: rand(60, 100),
      size: rand(14, 22),
      color: '#ff6688',
      text: '♥',
    }));
  }
  return particles;
}

function makeGroomEffect(cx, cy, palette) {
  const particles = [];
  const starColor = palette?.eyes || '#b8e8ff';
  for (let i = 0; i < 18; i++) {
    particles.push(new Particle({
      x: cx + rand(-60, 60),
      y: cy - rand(20, 80),
      vx: rand(-0.8, 0.8),
      vy: rand(-1.8, -3.5),
      gravity: 0, drag: 0.99,
      life: rand(50, 90),
      size: rand(4, 10),
      color: starColor,
      shape: 'star6',
      bloom: true,
      rotSpeed: rand(-0.08, 0.08),
    }));
  }
  // Shimmer trail
  for (let i = 0; i < 12; i++) {
    particles.push(new Particle({
      x: cx + rand(-70, 70),
      y: cy - rand(10, 100),
      vx: rand(-0.4, 0.4),
      vy: rand(-0.6, -1.2),
      gravity: 0, drag: 1,
      life: rand(30, 60),
      size: rand(1.5, 4),
      color: '#ffffff',
      shape: 'circle',
      bloom: true,
    }));
  }
  return particles;
}

function makeSleepEffect(cx, cy) {
  return ['z', 'Z', 'Z'].map((ch, i) => new Particle({
    x: cx + 40 + i * 12,
    y: cy - 60 - i * 22,
    vx: 0.4,
    vy: -0.7,
    gravity: 0, drag: 1,
    life: 90 - i * 12,
    size: 12 + i * 6,
    color: 'rgba(160, 180, 220, 0.9)',
    text: ch,
  }));
}

function makeLevelUpEffect(cx, cy) {
  const particles = [];
  // Explosive star burst
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    const speed = rand(4, 12);
    particles.push(new Particle({
      x: cx, y: cy - 60,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      gravity: 0.1, drag: 0.96,
      life: rand(60, 100),
      size: rand(5, 12),
      color: `hsl(${rand(38, 55)}, 100%, ${rand(60, 80)}%)`,
      shape: 'star4',
      bloom: true,
      rotSpeed: rand(-0.2, 0.2),
    }));
  }
  // Expanding ring
  for (let i = 0; i < 3; i++) {
    particles.push(new Particle({
      x: cx, y: cy - 60,
      vx: 0, vy: 0,
      gravity: 0, drag: 1,
      life: 40 + i * 15,
      size: 10 + i * 20,
      color: '#ffaa00',
      shape: 'ring',
      // ring grows via size over time — use a hack: start small, expand
    }));
  }
  // Level up text
  particles.push(new Particle({
    x: cx, y: cy - 100,
    vx: 0, vy: -1.2,
    gravity: 0, drag: 1,
    life: 80,
    size: 18,
    color: '#ffd700',
    text: '✦ LEVEL UP ✦',
  }));
  return particles;
}

function makeCriticalEffect(cx, cy) {
  return Array.from({ length: 6 }, (_, i) => new Particle({
    x: cx + rand(-30, 30),
    y: cy - 80 - i * 8,
    vx: rand(-0.3, 0.3),
    vy: rand(0.5, 2),
    gravity: 0.08, drag: 0.99,
    life: rand(50, 80),
    size: rand(3, 6),
    color: 'rgba(100, 160, 230, 0.7)',
    shape: 'drop',
  }));
}

// ─── CompanionEffects component ───────────────────────────────────────────

export default function CompanionEffects({ effect, catRect, palette }) {
  const canvasRef = useRef(null);
  const poolRef = useRef([]);
  const rafRef = useRef(null);
  const lastTRef = useRef(null);

  // Expand ring particles on each frame
  function updateRings(p, dt) {
    if (p.shape === 'ring') {
      p.size += dt * 1.8;
    }
  }

  function loop(ts) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dt = lastTRef.current ? Math.min((ts - lastTRef.current) / 16.67, 3) : 1;
    lastTRef.current = ts;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    poolRef.current = poolRef.current.filter((p) => p.alive);
    for (const p of poolRef.current) {
      updateRings(p, dt);
      p.update(dt);
      p.draw(ctx);
    }

    if (poolRef.current.length > 0) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      rafRef.current = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // Resize canvas to fill viewport
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Trigger effect
  useEffect(() => {
    if (!effect) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Compute cat center in viewport coords
    const cx = catRect
      ? catRect.left + catRect.width / 2
      : canvas.width / 2;
    const cy = catRect
      ? catRect.top + catRect.height * 0.4
      : canvas.height * 0.45;

    let newParticles = [];
    switch (effect.type) {
      case 'feed':      newParticles = makeFeedEffect(cx, cy); break;
      case 'play':      newParticles = makePlayEffect(cx, cy, palette); break;
      case 'groom':     newParticles = makeGroomEffect(cx, cy, palette); break;
      case 'sleep':     newParticles = makeSleepEffect(cx, cy); break;
      case 'level_up':  newParticles = makeLevelUpEffect(cx, cy); break;
      case 'critical':  newParticles = makeCriticalEffect(cx, cy); break;
      default: break;
    }

    poolRef.current.push(...newParticles);

    if (!rafRef.current) {
      lastTRef.current = null;
      rafRef.current = requestAnimationFrame(loop);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}
