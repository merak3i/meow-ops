import { motion, AnimatePresence } from 'framer-motion';
import CompanionCat from './CompanionCat';

export default function FarewellModal({ cat, onAdoptNew }) {
  if (!cat || cat.status !== 'lost') return null;
  const adopted = new Date(cat.adoptedAt).getTime();
  const lost = new Date(cat.lastFedAt || cat.adoptedAt).getTime();
  const days = Math.max(1, Math.floor((lost - adopted) / 86_400_000));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(8px)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.div
          initial={{ scale: 0.92, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 200 }}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '40px 48px',
            maxWidth: 460,
            textAlign: 'center',
            boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
          }}
        >
          <div style={{ filter: 'grayscale(80%) brightness(0.6)', opacity: 0.7, marginBottom: 12 }}>
            <CompanionCat cat={cat} mood="distressed" size={200} />
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            {cat.name} couldn't wait any longer.
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.6 }}>
            They walked off into the night. {days} day{days === 1 ? '' : 's'} together. The world is quieter now.
          </p>
          <button
            onClick={onAdoptNew}
            style={{
              marginTop: 24,
              padding: '12px 28px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Adopt a new kitten
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
