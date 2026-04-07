import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getBreed } from '../lib/companion-breeds';

export default function MemorialDrawer({ memorial }) {
  const [open, setOpen] = useState(false);
  if (!memorial || memorial.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'all 0.3s var(--ease)',
        }}
      >
        <span>Past companions ({memorial.length})</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                marginTop: 10,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 10,
              }}
            >
              {memorial.map((m) => {
                const breed = getBreed(m.breed);
                return (
                  <div
                    key={m.id || m.name + m.lostAt}
                    style={{
                      padding: 12,
                      background: 'var(--bg-page)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      opacity: 0.7,
                      filter: 'grayscale(60%)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: breed.palette.body,
                          border: '1px solid var(--border)',
                        }}
                      />
                      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{m.name}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                      {breed.label} · {m.daysLived} day{m.daysLived === 1 ? '' : 's'}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
