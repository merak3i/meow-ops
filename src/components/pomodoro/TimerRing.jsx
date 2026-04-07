import { motion } from 'framer-motion';
import { PHASES } from '../../lib/pomodoro-store';

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const PHASE_COLORS = {
  [PHASES.WORK]: 'var(--accent)',
  [PHASES.SHORT_BREAK]: 'var(--green)',
  [PHASES.LONG_BREAK]: 'var(--cyan)',
};

const PHASE_LABELS = {
  [PHASES.WORK]: 'Work',
  [PHASES.SHORT_BREAK]: 'Short Break',
  [PHASES.LONG_BREAK]: 'Long Break',
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function TimerRing({ progress, timeRemaining, phase, isRunning, sessionIndex, totalSessions }) {
  const offset = CIRCUMFERENCE * (1 - progress);
  const color = PHASE_COLORS[phase] || 'var(--accent)';
  const label = phase === PHASES.WORK
    ? `${PHASE_LABELS[phase]} ${sessionIndex + 1}/${totalSessions}`
    : PHASE_LABELS[phase];

  return (
    <div style={{ position: 'relative', width: 280, height: 280, margin: '0 auto' }}>
      <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%' }}>
        <circle
          cx="100" cy="100" r={RADIUS}
          fill="none"
          stroke="var(--bg-accent)"
          strokeWidth="4"
        />

        <motion.circle
          cx="100" cy="100" r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          transform="rotate(-90 100 100)"
          style={{ filter: isRunning ? `drop-shadow(0 0 6px ${color})` : 'none' }}
        />

        <text
          x="100" y="95"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text-primary)"
          fontFamily="'JetBrains Mono', monospace"
          fontSize="36"
          fontWeight="300"
        >
          {formatTime(timeRemaining)}
        </text>

        <text
          x="100" y="120"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text-secondary)"
          fontFamily="'Plus Jakarta Sans', sans-serif"
          fontSize="12"
          fontWeight="400"
        >
          {label}
        </text>
      </svg>

      {isRunning && (
        <motion.div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            border: `1px solid ${color}`,
            opacity: 0.15,
          }}
          animate={{ scale: [1, 1.04, 1], opacity: [0.15, 0.08, 0.15] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
}
