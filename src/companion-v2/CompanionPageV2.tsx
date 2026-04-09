import { useEffect, useRef, useCallback, useState } from 'react';
import { useActor } from '@xstate/react';

import { CompanionScene } from './CompanionScene';
import { companionMachine, stateLabel, stateEmoji } from '@/state/companionMachine';
import { buildDeveloperProfile } from '@/analytics/profile';
import type { Session } from '@/types/session';
import type { CompanionState } from '@/state/companionMachine';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompanionPageV2Props {
  sessions: Session[];
}

// ─── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

// ─── Morph weight bar ─────────────────────────────────────────────────────────

function MorphBar({ label, value, color = 'var(--accent)' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</span>
        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>{(value * 100).toFixed(0)}%</span>
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value * 100}%`, background: color, borderRadius: 2, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

// ─── Pomodoro toggle ──────────────────────────────────────────────────────────

function PomodoroToggle({ active, onStart, onEnd }: { active: boolean; onStart: () => void; onEnd: () => void }) {
  return (
    <button
      onClick={active ? onEnd : onStart}
      style={{
        width:        '100%',
        padding:      '8px 0',
        borderRadius: 6,
        border:       `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background:   active ? 'var(--accent)' : 'transparent',
        color:        active ? '#000' : 'var(--text-muted)',
        fontSize:     12,
        cursor:       'pointer',
        fontWeight:   active ? 600 : 400,
        transition:   'all 0.2s',
        marginTop:    12,
      }}
    >
      {active ? '🎯 End Focus Block' : '🎯 Start Focus Block'}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CompanionPageV2({ sessions }: CompanionPageV2Props) {
  const [actorRef, send]  = useActor(companionMachine);
  const cursorRef         = useRef({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const profile = buildDeveloperProfile(sessions);

  // Push profile into the machine on load / when sessions change
  useEffect(() => {
    send({ type: 'SESSION_UPDATE', profile });
  // We intentionally only re-send on sessions change, not on every profile ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  // Global TICK every second
  useEffect(() => {
    const id = window.setInterval(() => send({ type: 'TICK' }), 1000);
    return () => window.clearInterval(id);
  }, [send]);

  // Cursor tracking — normalised to -1…+1 in viewport space
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x    = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
    const y    = -((e.clientY - rect.top)  / rect.height - 0.5) * 2;
    cursorRef.current = { x, y };
    setCursor({ x, y });
    send({ type: 'CURSOR_MOVE', x, y });
  }, [send]);

  const currentState  = actorRef.value as CompanionState;
  const ctx           = actorRef.context;
  const morph         = profile.morph_weights;

  const GROWTH_COLORS: Record<string, string> = {
    kitten:   'var(--cyan)',
    juvenile: 'var(--accent)',
    adult:    'var(--amber)',
    elder:    '#c084fc',
  };
  const stageColor = GROWTH_COLORS[profile.growth_stage] ?? 'var(--accent)';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, height: 'calc(100vh - 140px)', minHeight: 540 }}>
      {/* ── 3D Viewport ─────────────────────────────────────────────────────── */}
      <div
        style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border)',
          borderRadius: 12,
          overflow:     'hidden',
          position:     'relative',
          cursor:       'none',
        }}
        onMouseMove={handleMouseMove}
        onClick={() => send({ type: 'PET' })}
      >
        <CompanionScene
          profile={profile}
          cursorX={cursor.x}
          cursorY={cursor.y}
          state={currentState}
        />

        {/* State badge overlay */}
        <div style={{
          position: 'absolute',
          bottom:   16,
          left:     16,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(8px)',
          border:   '1px solid var(--border)',
          borderRadius: 8,
          padding:  '6px 12px',
          display:  'flex',
          alignItems: 'center',
          gap:      8,
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 16 }}>{stateEmoji(currentState)}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{stateLabel(currentState)}</span>
        </div>

        {/* Click hint */}
        <div style={{
          position: 'absolute',
          top:      12,
          right:    14,
          fontSize: 10,
          color:    'var(--text-muted)',
          pointerEvents: 'none',
          opacity:  0.6,
        }}>
          click to pet
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

        {/* Identity card */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: stageColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>
              🐱
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                {profile.growth_stage}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {profile.xp.toFixed(1)}M XP · {profile.dominant_cat_type}
              </div>
            </div>
          </div>

          <StatRow label="Total sessions"  value={String(profile.total_sessions)} />
          <StatRow label="Total cost"      value={`$${profile.total_cost_usd.toFixed(2)}`} />
          <StatRow label="Avg TPM"         value={profile.avg_tokens_per_minute.toFixed(0)} />
          <StatRow label="Success rate"    value={`${(profile.session_success_rate * 100).toFixed(0)}%`} />
          <StatRow label="Streak"          value={`${profile.active_streak_days}d`} />
          <StatRow label="Pets given"      value={String(ctx.petCount)} />
        </div>

        {/* Morph weights */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Anatomy
          </div>
          <MorphBar label="Robustness"   value={morph.robustness}   color="var(--amber)" />
          <MorphBar label="Agility"      value={morph.agility}      color="var(--cyan)" />
          <MorphBar label="Intelligence" value={morph.intelligence} color="#c084fc" />
          <MorphBar label="Size"         value={morph.size}         color={stageColor} />
          <MorphBar label="Fatigue"      value={morph.fatigue}      color="#f87171" />
        </div>

        {/* Pomodoro */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Focus Block
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Cat enters focus mode and stays still during a Pomodoro block.
          </div>
          <PomodoroToggle
            active={ctx.pomodoroActive}
            onStart={() => send({ type: 'POMODORO_START' })}
            onEnd={() => send({ type: 'POMODORO_END' })}
          />
        </div>

        {/* Debug — only in dev */}
        {import.meta.env.DEV && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
            <div style={{ marginBottom: 4, color: 'var(--accent)' }}>// dev state</div>
            <div>state:  {currentState}</div>
            <div>idle:   {ctx.idleSeconds}s</div>
            <div>cursor: ({cursor.x.toFixed(2)}, {cursor.y.toFixed(2)})</div>
            <div>fatigue:{morph.fatigue.toFixed(2)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
