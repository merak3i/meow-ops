import { motion } from 'framer-motion';
import { Drumstick, Gamepad2, Sparkles, Moon, Home, Shirt } from 'lucide-react';

const ACTIONS = [
  { id: 'feed', label: 'Feed', icon: Drumstick },
  { id: 'play', label: 'Play', icon: Gamepad2 },
  { id: 'groom', label: 'Groom', icon: Sparkles },
  { id: 'sleep', label: 'Sleep', icon: Moon },
  { id: 'wardrobe', label: 'Wardrobe', icon: Shirt },
  { id: 'room', label: 'Room', icon: Home },
];

export default function CompanionActions({ onAction }) {
  return (
    <div
      className="card"
      style={{
        padding: 12,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {ACTIONS.map(({ id, label, icon: Icon }) => (
        <motion.button
          key={id}
          onClick={() => onAction(id)}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.96 }}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: '10px 8px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
            transition: 'all 0.3s var(--ease)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <Icon size={18} />
          {label}
        </motion.button>
      ))}
    </div>
  );
}
