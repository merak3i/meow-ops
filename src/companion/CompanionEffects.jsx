import { motion, AnimatePresence } from 'framer-motion';

// CompanionEffects — short-lived burst effects rendered above the cat.
// Triggered by feed/play/groom actions. Auto-clears after the animation.

export default function CompanionEffects({ effect }) {
  if (!effect) return null;

  let particles;
  if (effect.type === 'feed') {
    particles = Array.from({ length: 8 }).map((_, i) => ({
      id: i,
      x: -40 + Math.random() * 80,
      y: -20 - Math.random() * 60,
      symbol: '✨',
    }));
  } else if (effect.type === 'play') {
    particles = Array.from({ length: 6 }).map((_, i) => ({
      id: i,
      x: -50 + Math.random() * 100,
      y: -10 - Math.random() * 80,
      symbol: '❤️',
    }));
  } else if (effect.type === 'groom') {
    particles = Array.from({ length: 10 }).map((_, i) => ({
      id: i,
      x: -60 + Math.random() * 120,
      y: -10 - Math.random() * 70,
      symbol: '✨',
    }));
  } else if (effect.type === 'sleep') {
    particles = Array.from({ length: 3 }).map((_, i) => ({
      id: i,
      x: 30 + i * 14,
      y: -30 - i * 18,
      symbol: 'z',
    }));
  } else {
    particles = [];
  }

  return (
    <AnimatePresence>
      <div
        key={effect.id}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '40%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        {particles.map((p) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 0], x: p.x, y: p.y, scale: [0.5, 1.2, 0.6] }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              fontSize: 18,
            }}
          >
            {p.symbol}
          </motion.div>
        ))}
      </div>
    </AnimatePresence>
  );
}
