// StatsPanel.tsx — 5 stat bars + 6 action buttons + mood indicator + life stage badge.
// Right panel of the Companion page.

import type { CatState, DrawerState } from './useCompanionGame';

// ─── Props ────────────────────────────────────────────────────────────────────

interface StatsPanelProps {
  cat:     CatState;
  mood:    string;
  drawers: DrawerState;
  onPlay:  () => void;
  onGroom: () => void;
  onSleep: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const textColor =
    pct < 25 ? '#f87171' :
    pct < 50 ? 'var(--amber)' :
    'var(--text-secondary)';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
          {label}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: textColor }}>
          {pct.toFixed(0)}
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: pct < 25 ? '#f87171' : pct < 50 ? 'var(--amber)' : color,
          borderRadius: 3,
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}

function ActionBtn({
  icon, label, onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display:      'flex',
        flexDirection: 'column',
        alignItems:   'center',
        gap:          3,
        padding:      '8px 6px',
        border:       '1px solid var(--border)',
        borderRadius: 8,
        background:   'transparent',
        cursor:       'pointer',
        color:        'var(--text-secondary)',
        fontSize:     10,
        fontFamily:   'inherit',
        flex:         1,
        transition:   'all 0.2s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

const MOOD_COLORS: Record<string, string> = {
  glowing:   'var(--purple)',
  healthy:   'var(--green)',
  concerned: 'var(--amber)',
  distressed:'#f87171',
  critical:  '#ef4444',
};

const MOOD_ICONS: Record<string, string> = {
  glowing:   '✨',
  healthy:   '😸',
  concerned: '😟',
  distressed:'😿',
  critical:  '🆘',
};

const STAGE_COLORS: Record<string, string> = {
  kitten:     'var(--cyan)',
  adolescent: 'var(--accent)',
  youngAdult: 'var(--accent)',
  adult:      'var(--amber)',
  elder:      '#c084fc',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StatsPanel({ cat, mood, drawers, onPlay, onGroom, onSleep }: StatsPanelProps) {
  const stageColor = STAGE_COLORS[cat.lifeStage] ?? 'var(--accent)';
  const moodColor  = MOOD_COLORS[mood] ?? 'var(--text-secondary)';
  const moodIcon   = MOOD_ICONS[mood] ?? '😺';

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      {/* Header: life stage + mood */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: stageColor,
          }}>
            {cat.lifeStage.replace('youngAdult', 'Young Adult')}
          </span>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {cat.name} · {cat.breed}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: moodColor }}>
          <span style={{ fontSize: 16 }}>{moodIcon}</span>
          <span style={{ fontSize: 10, textTransform: 'capitalize' }}>{mood}</span>
        </div>
      </div>

      {/* Stat bars */}
      <StatBar label="Hunger"    value={cat.stats.hunger}    color="var(--amber)" />
      <StatBar label="Energy"    value={cat.stats.energy}    color="var(--cyan)" />
      <StatBar label="Happiness" value={cat.stats.happiness} color="#c084fc" />
      <StatBar label="Health"    value={cat.stats.health}    color="var(--green)" />
      <StatBar label="Shine"     value={cat.stats.shine}     color="#fbbf24" />

      {/* XP */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Growth XP</span>
        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: stageColor }}>
          {cat.growthXP}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <ActionBtn icon="🍖" label="Feed"     onClick={() => drawers.setFoodOpen(true)} />
        <ActionBtn icon="🎮" label="Play"     onClick={onPlay} />
        <ActionBtn icon="✨" label="Groom"    onClick={onGroom} />
        <ActionBtn icon="💤" label="Sleep"    onClick={onSleep} />
        <ActionBtn icon="👒" label="Wardrobe" onClick={() => drawers.setWardrobeOpen(true)} />
        <ActionBtn icon="🏠" label="Room"     onClick={() => drawers.setRoomOpen(true)} />
      </div>
    </div>
  );
}
