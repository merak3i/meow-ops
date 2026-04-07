import { motion } from 'framer-motion';

export default function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {label}
        </span>
        {Icon && <Icon size={16} style={{ color: color || 'var(--text-muted)' }} />}
      </div>
      <div style={{ fontSize: 28, fontWeight: 300, color: color || 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
      )}
    </motion.div>
  );
}
