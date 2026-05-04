import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useActor } from '@xstate/react';
import { Cat, Flame, HeartPulse, Sparkles, Target } from 'lucide-react';

import { CompanionScene }      from './CompanionScene';
import { StatsPanel }          from './StatsPanel';
import { BreedPickerModal }    from './BreedPickerModal';
import { FoodDrawer }          from './FoodDrawer';
import { WardrobeDrawer }      from './WardrobeDrawer';
import { RoomDrawer }          from './RoomDrawer';
import { FarewellOverlay }     from './FarewellOverlay';
import { MemorialPanel }       from './MemorialPanel';
import { MilestoneOverlay }    from './MilestoneOverlay';
import { exportCatCard }       from './CatCardExport';
import { useCompanionGame }    from './useCompanionGame';
import { companionMachine, stateLabel, stateEmoji } from '@/state/companionMachine';
import { buildDeveloperProfile }                    from '@/analytics/profile';
import type { Session }        from '@/types/session';
import type { CompanionState } from '@/state/companionMachine';
import type { MemoryMark }     from './useCompanionGame';
import './companion-page.css';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompanionPageV2Props {
  sessions: Session[];
}

// ─── Milestone helpers (localStorage-based, no backend needed) ───────────────

const MILESTONES_KEY = 'meow-milestones-shown';

function getShownMilestones(): Set<string> {
  try {
    const raw = localStorage.getItem(MILESTONES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function markMilestoneShown(key: string): void {
  try {
    const set = getShownMilestones();
    set.add(key);
    localStorage.setItem(MILESTONES_KEY, JSON.stringify([...set]));
  } catch { /* quota exceeded — ignore */ }
}

interface MilestoneData {
  title:       string;
  description: string;
  emoji:       string;
}

const GROWTH_MILESTONES: Partial<Record<string, MilestoneData>> = {
  juvenile:   { title: 'Adolescent!',   description: 'Your kitten is growing up. 7 days together.',       emoji: '🐱' },
  adult:      { title: 'Young Adult!',  description: 'A mature cat. 30 days of consistent coding.',       emoji: '😺' },
  elder:      { title: 'Elder!',        description: 'Wise beyond years. 90 days of dedication.',         emoji: '👴🐱' },
};

const THRESHOLD_MILESTONES: [string, (tokens: number, cost: number, streak: number) => boolean, MilestoneData][] = [
  ['1M-tokens',   (t) => t >= 1_000_000,   { title: '1 Million Tokens!',   description: 'Your cat has witnessed 1M tokens fly by.',          emoji: '🎯' }],
  ['10M-tokens',  (t) => t >= 10_000_000,  { title: '10 Million Tokens!',  description: 'A true AI power user. Your cat is proud.',           emoji: '🚀' }],
  ['100M-tokens', (t) => t >= 100_000_000, { title: '100 Million Tokens!', description: 'Legend territory. The cat glows with respect.',      emoji: '🌟' }],
  ['7d-streak',   (_, __, s) => s >= 7,    { title: '7-Day Streak!',       description: 'A week of consistent coding. Dedication!',           emoji: '🔥' }],
  ['30d-streak',  (_, __, s) => s >= 30,   { title: '30-Day Streak!',      description: 'A full month without a break. Extraordinary.',       emoji: '💎' }],
  ['$10',         (_, c) => c >= 10,       { title: '$10 Invested',        description: 'First major AI investment milestone.',               emoji: '💰' }],
  ['$50',         (_, c) => c >= 50,       { title: '$50 Invested',        description: "You're serious about this.",                         emoji: '💸' }],
  ['$100',        (_, c) => c >= 100,      { title: '$100 Invested',       description: 'High roller. Your cat respects it.',                 emoji: '🎰' }],
  ['$500',        (_, c) => c >= 500,      { title: '$500 Invested',       description: 'Elite tier AI usage. Legendary.',                   emoji: '👑' }],
];

// Dev-only state cycler order — module scope so it isn't recreated on every
// render. The `\` key clears the override and falls back to the live state.
const STATE_CYCLE: CompanionState[] = ['active', 'idle', 'focus', 'concerned', 'fatigue', 'neglected'];

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
  const [pendingMilestone, setPendingMilestone] = useState<MilestoneData | null>(null);

  // Ref to the viewport div — used for canvas capture in cat card export
  const viewportRef = useRef<HTMLDivElement>(null);

  // Mouse position for following paw cursor (viewport-relative px)
  const [pawPos, setPawPos] = useState({ x: -999, y: -999 });
  const [inViewport, setInViewport] = useState(false);

  // Autonomous behaviour — cat does something random every 20–55s. Skips
  // the firing when the tab is hidden so background tabs don't burn a
  // ParticleOverlay redraw every minute. Resumes immediately on next
  // tick once the user comes back.
  useEffect(() => {
    const ACTIONS: Array<{ effect: string; label: string }> = [
      { effect: 'groom', label: '🐾 Grooming...' },
      { effect: 'sleep', label: '💤 Napping...'  },
      { effect: 'play',  label: '✨ Stretching...' },
    ];
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 20_000 + Math.random() * 35_000;
      id = setTimeout(() => {
        if (!document.hidden) {
          const pick = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]!;
          triggerEffect(pick.effect);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track previous growth stage for milestone detection
  const prevGrowthStageRef = useRef<string>('');

  // Action-feedback particles: bump the key to retrigger the same effect.
  // ParticleOverlay (inside CompanionScene) reads these and spawns a burst.
  const [effectTrigger, setEffectTrigger] = useState<{ type: string; key: number }>({ type: '', key: 0 });
  const triggerEffect = useCallback((type: string) => {
    setEffectTrigger((prev) => ({ type, key: prev.key + 1 }));
  }, []);

  const game    = useCompanionGame(sessions);
  // Profile walks every session — memoise against the array reference so we
  // don't redo the walk on unrelated re-renders (cursor moves, tick events).
  const profile = useMemo(() => buildDeveloperProfile(sessions), [sessions]);

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

  // ── Session polling (detect new sessions while page is open) ─────────────────
  // Polls /data/sessions.json every 30s. When the count grows, the cat reacts.
  useEffect(() => {
    let lastCount: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch('/data/sessions.json?_t=' + Date.now());
        if (!res.ok) return;
        const data = await res.json() as unknown[];
        const count = data.length;
        if (lastCount !== null && count > lastCount) {
          triggerEffect('session');
          send({ type: 'SESSION_UPDATE', profile: buildDeveloperProfile(sessions) });
        }
        lastCount = count;
      } catch {
        // No sessions.json yet — silently skip
      }
    };

    const id = window.setInterval(poll, 30_000);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Growth stage milestone detection ─────────────────────────────────────────
  useEffect(() => {
    const prev = prevGrowthStageRef.current;
    const curr = profile.growth_stage;
    if (prev && prev !== curr) {
      const ms = GROWTH_MILESTONES[curr];
      if (ms) {
        const key = `growth-${curr}`;
        if (!getShownMilestones().has(key)) {
          markMilestoneShown(key);
          setPendingMilestone(ms);
          triggerEffect('milestone');
        }
      }
    }
    prevGrowthStageRef.current = curr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.growth_stage]);

  // ── Token / cost / streak milestone detection ────────────────────────────────
  useEffect(() => {
    const t = profile.total_tokens;
    const c = profile.total_cost_usd;
    const s = game.cat?.streakDays ?? profile.active_streak_days;
    const shown = getShownMilestones();
    for (const [key, condition, ms] of THRESHOLD_MILESTONES) {
      if (!shown.has(key) && condition(t, c, s)) {
        markMilestoneShown(key);
        setPendingMilestone(ms);
        triggerEffect('milestone');
        break; // Show one at a time
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.total_tokens, profile.total_cost_usd, game.cat?.streakDays, profile.active_streak_days]);

  // ── Auto-dismiss milestone overlay after 4s ───────────────────────────────────
  useEffect(() => {
    if (!pendingMilestone) return;
    const id = window.setTimeout(() => setPendingMilestone(null), 4000);
    return () => window.clearTimeout(id);
  }, [pendingMilestone]);

  // ── Memory mark awarding ──────────────────────────────────────────────────────
  // Checks on every cat stat change — addMemoryMark deduplicates internally.
  useEffect(() => {
    if (!game.cat) return;
    const { stats, streakDays } = game.cat;
    const now = new Date().toISOString();

    if (stats.health < 5) {
      game.actions.addMemoryMark({ type: 'scar', date: now });
    }
    if (streakDays >= 7) {
      game.actions.addMemoryMark({ type: 'gold-stripe', date: now });
    }
    if (profile.total_sessions >= 100) {
      game.actions.addMemoryMark({ type: 'star-mark', date: now });
    }
    if (streakDays >= 30) {
      game.actions.addMemoryMark({ type: 'crown-mark', date: now });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.cat?.stats.health, game.cat?.streakDays, profile.total_sessions]);

  // ── Big-run blaze: awarded if any session cost > $1 ──────────────────────────
  useEffect(() => {
    if (!game.cat) return;
    const bigRun = sessions.find((s) => s.estimated_cost_usd > 1);
    if (bigRun) {
      game.actions.addMemoryMark({ type: 'big-run-blaze', date: bigRun.started_at });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, game.cat?.id]);

  // Cursor tracking — normalised to −1…+1 in viewport space
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x    = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
    const y    = -((e.clientY - rect.top)  / rect.height - 0.5) * 2;
    cursorRef.current = { x, y };
    setCursor({ x, y });
    send({ type: 'CURSOR_MOVE', x, y });
    // Track px position for following cursor overlay
    setPawPos({ x: e.clientX, y: e.clientY });
  }, [send]);

  // Cat card export
  const handleShare = useCallback(() => {
    if (!game.cat) return;
    exportCatCard(viewportRef.current, game.cat, profile, game.trait);
  }, [game.cat, game.trait, profile]);

  const machineState = actorRef.value as CompanionState;
  const ctx          = actorRef.context;
  const morph        = profile.morph_weights;

  // Dev-only state cycler — press [ / ] to walk through every CompanionState
  // so you can eyeball each pose. Press \ to clear the override. STATE_CYCLE
  // is defined at module scope above.
  const [debugState, setDebugState] = useState<CompanionState | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '[' || e.key === ']') {
        setDebugState((prev) => {
          const i = prev ? STATE_CYCLE.indexOf(prev) : -1;
          const dir = e.key === ']' ? 1 : -1;
          const next = (i + dir + STATE_CYCLE.length) % STATE_CYCLE.length;
          return STATE_CYCLE[next] ?? null;
        });
      } else if (e.key === '\\') {
        setDebugState(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const currentState: CompanionState = debugState ?? machineState;

  // Fuse analytics morphs with game state morphs
  const fusedFatigue = game.cat
    ? Math.max(morph.fatigue, 1 - game.cat.stats.energy / 100, 1 - game.cat.stats.health / 100)
    : morph.fatigue;
  const fusedSize = game.cat
    ? Math.max(morph.size, (game.cat.growthXP / 1500) * 0.8)
    : morph.size;
  const fusedMorphs   = { ...morph, fatigue: fusedFatigue, size: Math.min(1, fusedSize) };

  const GROWTH_COLORS: Record<string, string> = {
    kitten:   'var(--cyan)',
    juvenile: 'var(--accent)',
    adult:    'var(--amber)',
    elder:    '#c084fc',
  };
  const stageColor = GROWTH_COLORS[profile.growth_stage] ?? 'var(--accent)';
  const careScore = game.cat
    ? Math.round((
      game.cat.stats.hunger +
      game.cat.stats.energy +
      game.cat.stats.happiness +
      game.cat.stats.health +
      game.cat.stats.shine
    ) / 5)
    : 0;
  const daysTogether = game.cat
    ? Math.max(0, Math.floor((Date.now() - new Date(game.cat.adoptedAt).getTime()) / 86_400_000))
    : 0;
  const companionName = game.cat?.name ?? 'Companion';
  const companionMeta = game.cat
    ? `${game.cat.breed} · ${game.mood}`
    : 'Adopt a local-first coding companion';

  return (
    <>
      {/* ── Milestone overlay ─────────────────────────────────────────────────── */}
      <MilestoneOverlay
        milestone={pendingMilestone}
        onDismiss={() => setPendingMilestone(null)}
      />

      {/* ── Cat adoption / farewell overlays ─────────────────────────────────── */}
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

      {/* ── Paw cursor — follows mouse inside the 3D viewport ───────────────── */}
      {inViewport && (
        <div style={{
          position: 'fixed',
          left: pawPos.x - 14,
          top:  pawPos.y - 14,
          pointerEvents: 'none',
          fontSize: 22,
          zIndex: 9999,
          transform: 'rotate(-20deg)',
          transition: 'transform 0.15s ease',
          userSelect: 'none',
          lineHeight: 1,
        }}>
          🐾
        </div>
      )}

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <section className="companion-page">
        <header className="companion-page__header">
          <div className="companion-page__title">
            <div className="companion-page__mark" style={{ color: stageColor }}>
              <Cat size={19} strokeWidth={1.8} />
            </div>
            <div>
              <div className="companion-page__eyebrow">Living Companion</div>
              <h1>{companionName}</h1>
              <p>{companionMeta}</p>
            </div>
          </div>

          <div className="companion-page__kpis">
            <div className="companion-kpi">
              <HeartPulse size={14} />
              <span>Care</span>
              <strong>{game.cat ? careScore : 'New'}</strong>
            </div>
            <div className="companion-kpi">
              <Flame size={14} />
              <span>Streak</span>
              <strong>{game.cat?.streakDays ?? profile.active_streak_days}d</strong>
            </div>
            <div className="companion-kpi">
              <Sparkles size={14} />
              <span>Together</span>
              <strong>{game.cat ? `${daysTogether}d` : `${profile.total_sessions} runs`}</strong>
            </div>
          </div>
        </header>

        <div className="companion-layout">

        {/* ── 3D Viewport ──────────────────────────────────────────────────── */}
        {/* Click forwards to onCatClick → PixelCat onClick rather than living
            on the viewport, so future hit-testing on opaque pixels can land
            without re-routing handlers. The state badge below has
            `pointerEvents: 'none'` so it doesn't swallow clicks. */}
        <div
          ref={viewportRef}
          className="companion-viewport-frame"
          style={{ cursor: 'none' }}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setInViewport(true)}
          onMouseLeave={() => setInViewport(false)}
        >
          <CompanionScene
            state={currentState}
            effect={effectTrigger.type}
            effectKey={effectTrigger.key}
            onCatClick={() => { send({ type: 'PET' }); triggerEffect('pet'); game.actions.play(); }}
          />

          {/* State badge overlay */}
          <div className="companion-state-badge">
            <span style={{ fontSize: 16 }}>{stateEmoji(currentState)}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{stateLabel(currentState)}</span>
            {debugState && (
              <span style={{ fontSize: 10, color: '#f5c518', letterSpacing: 1, marginLeft: 4 }}>
                DBG [ ]
              </span>
            )}
          </div>

          {/* Memory marks legend — bottom right */}
          {game.memoryMarks.length > 0 && (
            <div className="companion-memory-marks">
              {game.memoryMarks.map((m) => {
                const labels: Record<string, string> = {
                  'scar':          '🩹',
                  'gold-stripe':   '✨',
                  'star-mark':     '⭐',
                  'big-run-blaze': '🔥',
                  'crown-mark':    '👑',
                };
                return (
                  <span key={m.type} style={{ fontSize: 14 }} title={m.type}>
                    {labels[m.type] ?? '◆'}
                  </span>
                );
              })}
            </div>
          )}

        </div>

        {/* ── Right sidebar ────────────────────────────────────────────────── */}
        <div className="companion-sidebar">

          {/* Game stats — only if a cat is alive */}
          {game.cat && game.cat.status === 'alive' && (
            <StatsPanel
              cat={game.cat}
              mood={game.mood}
              drawers={game.drawers}
              trait={game.trait}
              onPlay={() => { game.actions.play(); triggerEffect('play'); }}
              onGroom={() => { game.actions.groom(); triggerEffect('groom'); }}
              onSleep={() => { game.actions.sleep(); triggerEffect('sleep'); }}
              onShare={handleShare}
            />
          )}

          {/* Analytics identity card */}
          <div className="companion-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: stageColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#050505', flexShrink: 0,
                boxShadow: `0 0 24px color-mix(in oklab, ${stageColor} 30%, transparent)`,
              }}>
                <Cat size={18} strokeWidth={2.1} />
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
          <div className="companion-panel">
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
          <div className="companion-panel">
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
                width: '100%', padding: '8px 0', borderRadius: 7, marginTop: 12,
                border: `1px solid ${ctx.pomodoroActive ? 'var(--accent)' : 'var(--border)'}`,
                background: ctx.pomodoroActive ? 'var(--accent)' : 'transparent',
                color: ctx.pomodoroActive ? '#000' : 'var(--text-muted)',
                fontSize: 12, cursor: 'pointer', fontWeight: ctx.pomodoroActive ? 600 : 400,
                transition: 'all 0.2s', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}
            >
              <Target size={14} />
              {ctx.pomodoroActive ? 'End Focus Block' : 'Start Focus Block'}
            </button>
          </div>

          {/* Memorial panel */}
          {game.memorial.length > 0 && (
            <MemorialPanel entries={game.memorial} />
          )}

          {/* Dev debug */}
          {import.meta.env.DEV && (
            <div className="companion-panel" style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: 4, color: 'var(--accent)' }}>// dev state</div>
              <div>state:   {currentState}</div>
              <div>idle:    {ctx.idleSeconds}s</div>
              <div>fatigue: {fusedMorphs.fatigue.toFixed(2)}</div>
              <div>cursor:  ({cursor.x.toFixed(2)}, {cursor.y.toFixed(2)})</div>
              <div>trait:   {game.trait?.name ?? 'none'}</div>
              <div>marks:   {game.memoryMarks.map((m: MemoryMark) => m.type).join(', ') || 'none'}</div>
            </div>
          )}
        </div>
        </div>
      </section>
    </>
  );
}
