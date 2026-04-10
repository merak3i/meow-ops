import { useEffect, useRef, useCallback, useState } from 'react';
import { useActor } from '@xstate/react';

import { CompanionScene }      from './CompanionScene';
import { StatsPanel }          from './StatsPanel';
import { BreedPickerModal }    from './BreedPickerModal';
import { FoodDrawer }          from './FoodDrawer';
import { WardrobeDrawer }      from './WardrobeDrawer';
import { RoomDrawer }          from './RoomDrawer';
import { FarewellOverlay }     from './FarewellOverlay';
import { MemorialPanel }       from './MemorialPanel';
import { useCompanionGame }    from './useCompanionGame';
import { companionMachine, stateLabel, stateEmoji } from '@/state/companionMachine';
import { buildDeveloperProfile }                    from '@/analytics/profile';
import type { Session }        from '@/types/session';
import type { CompanionState } from '@/state/companionMachine';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompanionPageV2Props {
  sessions: Session[];
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function CompanionPageV2({ sessions }: CompanionPageV2Props) {
  const [actorRef, send]    = useActor(companionMachine);
  const cursorRef            = useRef({ x: 0, y: 0 });
  const [cursor, setCursor]  = useState({ x: 0, y: 0 });
  const [actionEffect, setActionEffect] = useState<string | null>(null);

  const game    = useCompanionGame(sessions);
  const profile = buildDeveloperProfile(sessions);

  // Push analytics profile into the XState machine
  useEffect(() => {
    send({ type: 'SESSION_UPDATE', profile });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  // Bridge game wellness → XState wellnessScore
  useEffect(() => {
    if (!game.cat) return;
    const wellness = (
      game.cat.stats.hunger / 100 +
      game.cat.stats.energy / 100 +
      game.cat.stats.health / 100
    ) / 3;
    send({ type: 'GAME_UPDATE', wellness, energy: game.cat.stats.energy / 100 });
  }, [game.cat?.stats.hunger, game.cat?.stats.energy, game.cat?.stats.health, send]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global TICK every second
  useEffect(() => {
    const id = window.setInterval(() => send({ type: 'TICK' }), 1000);
    return () => window.clearInterval(id);
  }, [send]);

  // Cursor tracking — normalised to −1…+1 in viewport space
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x    = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
    const y    = -((e.clientY - rect.top)  / rect.height - 0.5) * 2;
    cursorRef.current = { x, y };
    setCursor({ x, y });
    send({ type: 'CURSOR_MOVE', x, y });
  }, [send]);

  // Trigger action particle effect, auto-clear after 2s
  const triggerEffect = useCallback((type: string) => {
    setActionEffect(type);
    setTimeout(() => setActionEffect(null), 2000);
  }, []);

  const currentState = actorRef.value as CompanionState;
  const ctx          = actorRef.context;
  const morph        = profile.morph_weights;

  // Fuse analytics morphs with game state morphs
  const fusedFatigue = game.cat
    ? Math.max(morph.fatigue, 1 - game.cat.stats.energy / 100, 1 - game.cat.stats.health / 100)
    : morph.fatigue;
  const fusedSize = game.cat
    ? Math.max(morph.size, (game.cat.growthXP / 1500) * 0.8)
    : morph.size;
  const fusedMorphs = { ...morph, fatigue: fusedFatigue, size: Math.min(1, fusedSize) };

  const fusedProfile = { ...profile, morph_weights: fusedMorphs };

  const GROWTH_COLORS: Record<string, string> = {
    kitten:   'var(--cyan)',
    juvenile: 'var(--accent)',
    adult:    'var(--amber)',
    elder:    '#c084fc',
  };
  const stageColor = GROWTH_COLORS[profile.growth_stage] ?? 'var(--accent)';

  // Room tier → scene
  const roomTier = game.cat?.room?.tier ?? 0;

  return (
    <>
      {/* ── Overlays ─────────────────────────────────────────────────────────── */}
      {!game.cat && (
        <BreedPickerModal onAdopt={game.actions.adopt} />
      )}
      {game.cat?.status === 'lost' && (
        <FarewellOverlay cat={game.cat} onBury={game.actions.bury} />
      )}

      {/* ── Drawers ──────────────────────────────────────────────────────────── */}
      <FoodDrawer
        open={game.drawers.foodOpen}
        onClose={() => game.drawers.setFoodOpen(false)}
        cat={game.cat}
        onFeed={(key) => { game.actions.feed(key); triggerEffect('feed'); }}
      />
      <WardrobeDrawer
        open={game.drawers.wardrobeOpen}
        onClose={() => game.drawers.setWardrobeOpen(false)}
        cat={game.cat}
        onToggle={game.actions.toggleAccessory}
        onPurchase={game.actions.purchaseAccessory}
      />
      <RoomDrawer
        open={game.drawers.roomOpen}
        onClose={() => game.drawers.setRoomOpen(false)}
        cat={game.cat}
        onSetRoom={(key) => { game.actions.setRoom(key); triggerEffect('room'); }}
      />

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, height: 'calc(100vh - 140px)', minHeight: 540 }}>

        {/* ── 3D Viewport ──────────────────────────────────────────────────── */}
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
          onClick={() => { send({ type: 'PET' }); triggerEffect('pet'); game.actions.play(); }}
        >
          <CompanionScene
            profile={fusedProfile}
            cursorX={cursor.x}
            cursorY={cursor.y}
            state={currentState}
            roomTier={roomTier}
            actionEffect={actionEffect}
            equippedAccessories={game.cat?.appearance.equippedAccessories ?? []}
          />

          {/* State badge overlay */}
          <div style={{
            position: 'absolute', bottom: 16, left: 16,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
            pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 16 }}>{stateEmoji(currentState)}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{stateLabel(currentState)}</span>
          </div>

          {/* Click hint */}
          <div style={{
            position: 'absolute', top: 12, right: 14,
            fontSize: 10, color: 'var(--text-muted)', pointerEvents: 'none', opacity: 0.6,
          }}>
            click to pet
          </div>
        </div>

        {/* ── Right sidebar ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>

          {/* Game stats — only if a cat is alive */}
          {game.cat && game.cat.status === 'alive' && (
            <StatsPanel
              cat={game.cat}
              mood={game.mood}
              drawers={game.drawers}
              onPlay={() => { game.actions.play(); triggerEffect('play'); }}
              onGroom={() => { game.actions.groom(); triggerEffect('groom'); }}
              onSleep={() => { game.actions.sleep(); triggerEffect('sleep'); }}
            />
          )}

          {/* Analytics identity card */}
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total sessions</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{profile.total_sessions}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total cost</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>${profile.total_cost_usd.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg TPM</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{profile.avg_tokens_per_minute.toFixed(0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Streak</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{profile.active_streak_days}d</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pets given</span>
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{ctx.petCount}</span>
            </div>
          </div>

          {/* Anatomy morph weights */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Anatomy
            </div>
            <MorphBar label="Robustness"   value={fusedMorphs.robustness}   color="var(--amber)" />
            <MorphBar label="Agility"      value={fusedMorphs.agility}      color="var(--cyan)" />
            <MorphBar label="Intelligence" value={fusedMorphs.intelligence} color="#c084fc" />
            <MorphBar label="Size"         value={fusedMorphs.size}         color={stageColor} />
            <MorphBar label="Fatigue"      value={fusedMorphs.fatigue}      color="#f87171" />
          </div>

          {/* Pomodoro */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              Focus Block
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Cat enters focus mode during a Pomodoro block.
            </div>
            <button
              onClick={ctx.pomodoroActive
                ? () => send({ type: 'POMODORO_END' })
                : () => send({ type: 'POMODORO_START' })}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 6, marginTop: 12,
                border: `1px solid ${ctx.pomodoroActive ? 'var(--accent)' : 'var(--border)'}`,
                background: ctx.pomodoroActive ? 'var(--accent)' : 'transparent',
                color: ctx.pomodoroActive ? '#000' : 'var(--text-muted)',
                fontSize: 12, cursor: 'pointer', fontWeight: ctx.pomodoroActive ? 600 : 400,
                transition: 'all 0.2s', fontFamily: 'inherit',
              }}
            >
              {ctx.pomodoroActive ? '🎯 End Focus Block' : '🎯 Start Focus Block'}
            </button>
          </div>

          {/* Memorial panel */}
          {game.memorial.length > 0 && (
            <MemorialPanel entries={game.memorial} />
          )}

          {/* Dev debug */}
          {import.meta.env.DEV && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: 4, color: 'var(--accent)' }}>// dev state</div>
              <div>state:   {currentState}</div>
              <div>idle:    {ctx.idleSeconds}s</div>
              <div>fatigue: {fusedMorphs.fatigue.toFixed(2)}</div>
              <div>cursor:  ({cursor.x.toFixed(2)}, {cursor.y.toFixed(2)})</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
