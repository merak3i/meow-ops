import { motion } from 'framer-motion';
import { Drumstick, Battery, Smile, Heart, Sparkles, TrendingUp } from 'lucide-react';

const STAT_DEFS = [
  { key: 'hunger', label: 'Hunger', icon: Drumstick, color: 'var(--amber)' },
  { key: 'energy', label: 'Energy', icon: Battery, color: 'var(--cyan)' },
  { key: 'happiness', label: 'Happiness', icon: Smile, color: 'var(--green)' },
  { key: 'health', label: 'Health', icon: Heart, color: 'var(--red)' },
  { key: 'shine', label: 'Shine', icon: Sparkles, color: 'var(--purple)' },
];

const LIFE_STAGE_LABEL = {
  kitten: 'Kitten',
  adolescent: 'Adolescent',
  youngAdult: 'Young Adult',
  adult: 'Adult',
  elder: 'Elder',
};

export default function CompanionStats({ cat }) {
  if (!cat) return null;
  const xpForStage = (stage) => {
    if (stage === 'kitten') return [0, 100];
    if (stage === 'adolescent') return [100, 300];
    if (stage === 'youngAdult') return [300, 700];
    if (stage === 'adult') return [700, 1500];
    return [1500, 1500];
  };
  const [low, high] = xpForStage(cat.lifeStage);
  const xpProgress = high === low ? 1 : Math.min(1, (cat.growthXP - low) / (high - low));

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
          {cat.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
          {LIFE_STAGE_LABEL[cat.lifeStage] || 'Kitten'}
        </div>
      </div>

      {/* Growth bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={11} />
            Growth XP
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
            {Math.floor(cat.growthXP)} / {high}
          </span>
        </div>
        <Bar value={xpProgress * 100} color="var(--accent)" />
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {STAT_DEFS.map((s) => {
        const Icon = s.icon;
        const v = Math.round(cat.stats[s.key] || 0);
        return (
          <div key={s.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon size={12} color={s.color} />
                {s.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
                {v}
              </span>
            </div>
            <Bar value={v} color={s.color} />
          </div>
        );
      })}
    </div>
  );
}

function Bar({ value, color }) {
  return (
    <div style={{ width: '100%', height: 6, background: 'var(--bg-page)', borderRadius: 3, overflow: 'hidden' }}>
      <motion.div
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ height: '100%', background: color, borderRadius: 3 }}
      />
    </div>
  );
}
