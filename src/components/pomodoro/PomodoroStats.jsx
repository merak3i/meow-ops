import { motion } from 'framer-motion';
import { Flame, Target, Clock, Sparkles } from 'lucide-react';

export default function PomodoroStats({ stats, nextUnlock }) {
  const items = [
    { icon: Target, label: 'Today', value: stats.pomodorosToday, color: 'var(--green)' },
    { icon: Flame, label: 'Streak', value: `${stats.streak}d`, color: stats.streak >= 7 ? 'var(--amber)' : 'var(--text-primary)' },
    { icon: Clock, label: 'Focus', value: `${stats.totalFocusMinutes}m`, color: 'var(--cyan)' },
    { icon: Sparkles, label: 'Total', value: stats.totalCompleted, color: 'var(--purple)' },
  ];

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      style={{
        padding: '10px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {items.map(({ icon: Icon, label, value, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
          <span style={{
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            color,
            fontWeight: 500,
          }}>
            {value}
          </span>
        </div>
      ))}

      {nextUnlock && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
          Next: <span style={{ color: 'var(--amber)' }}>{nextUnlock.label}</span> at {nextUnlock.unlock}
        </div>
      )}
    </motion.div>
  );
}
