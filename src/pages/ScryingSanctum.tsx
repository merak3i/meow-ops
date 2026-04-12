// ScryingSanctum.tsx — WoW × Mario MMORPG agent pipeline visualizer
// Full dungeon aesthetic: unit frames, ley lines, mana bars, gold costs

import { useState, useMemo, useEffect } from 'react';
import type { Session } from '@/types/session';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';

// ─── Class configuration ──────────────────────────────────────────────────────

interface ClassConfig {
  color: string;
  gradient: string;
  classLabel: string;
  faction: string;
  icon: string;
  auraColor: string;
}

const CLASS_MAP: Record<string, ClassConfig> = {
  builder:     { color: '#f59e0b', gradient: 'linear-gradient(160deg, #1c0e00 0%, #0a0400 100%)', classLabel: 'WARRIOR',      faction: 'Argent',      icon: '⚔️',  auraColor: '#f59e0b33' },
  detective:   { color: '#34d399', gradient: 'linear-gradient(160deg, #001c0e 0%, #000a04 100%)', classLabel: 'ROGUE',         faction: 'Ebon Blade',  icon: '🗡️',  auraColor: '#34d39933' },
  commander:   { color: '#60a5fa', gradient: 'linear-gradient(160deg, #00101c 0%, #00050e 100%)', classLabel: 'MAGE',          faction: 'Kirin Tor',   icon: '❄️',  auraColor: '#60a5fa33' },
  architect:   { color: '#a78bfa', gradient: 'linear-gradient(160deg, #0e001c 0%, #04000a 100%)', classLabel: 'WARLOCK',       faction: 'Dalaran',     icon: '🌀',  auraColor: '#a78bfa33' },
  guardian:    { color: '#fbbf24', gradient: 'linear-gradient(160deg, #1c1400 0%, #0a0800 100%)', classLabel: 'PALADIN',       faction: 'Silver Hand', icon: '🛡️',  auraColor: '#fbbf2433' },
  storyteller: { color: '#e2e8f0', gradient: 'linear-gradient(160deg, #0c1015 0%, #050810 100%)', classLabel: 'PRIEST',        faction: 'Moonwhisper', icon: '✨',  auraColor: '#e2e8f022' },
  ghost:       { color: '#4ade80', gradient: 'linear-gradient(160deg, #000e04 0%, #000500 100%)', classLabel: 'DEATH KNIGHT',  faction: 'The Scourge', icon: '💀',  auraColor: '#4ade8022' },
};

// ─── Fantasy name generation ──────────────────────────────────────────────────

const FACTION_PREFIXES: Record<string, string[]> = {
  builder:     ['Argent', 'Ironforge', 'Thunder Bluff'],
  detective:   ['Ebon', 'Shadow', 'Darkstone'],
  commander:   ['Storm', 'Crimson', 'Blade'],
  architect:   ['Dalaran', 'Kirin Tor', 'Arcane'],
  guardian:    ['Silver Hand', 'Argent', 'Light\'s Hope'],
  storyteller: ['Moonwhisper', 'Ivory', 'Sable'],
  ghost:       ['Forsaken', 'Scourge', 'Lich'],
};

const ROLE_SUFFIXES: Record<number, string[]> = {
  0: ['Vanguard', 'High Sentinel', 'Warden', 'Commander'],
  1: ['Scout', 'Adept', 'Blade', 'Agent'],
  2: ['Acolyte', 'Initiate', 'Squire', 'Recruit'],
};

const PIPELINE_ROLES = ['INPUT SENTRY', 'RESEARCH SCOUT', 'LLM ARCHMAGE', 'OUTPUT EMISSARY'];
const EXTRA_ROLES    = ['CHAIN RUNNER',  'SIDECHAIN LINK', 'BRANCH NODE',   'AUXILIARY'];

function getFantasyName(session: Session, idx: number, depth: number): string {
  const slug = session.agent_slug;
  if (slug) return slug.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  const cat      = session.cat_type ?? 'ghost';
  const prefixes = FACTION_PREFIXES[cat] ?? ['Unknown'];
  const prefix   = prefixes[idx % prefixes.length];
  const suffixes = ROLE_SUFFIXES[Math.min(depth, 2)] ?? ROLE_SUFFIXES[2];
  return `${prefix} ${suffixes[idx % suffixes.length]}`;
}

function getPipelineRole(idx: number, total: number): string {
  if (total <= 1) return PIPELINE_ROLES[2];
  if (total <= 4) {
    const positions = [0, Math.round(total * 0.33), Math.round(total * 0.67), total - 1];
    let best = 0;
    positions.forEach((pos, i) => {
      if (Math.abs(pos - idx) < Math.abs(positions[best] - idx)) best = i;
    });
    return PIPELINE_ROLES[best];
  }
  return EXTRA_ROLES[idx % EXTRA_ROLES.length];
}

// ─── Ley-line status ──────────────────────────────────────────────────────────

type LeyStatus = 'healthy' | 'choked' | 'severed';

function leyStatus(session: Session): LeyStatus {
  if (session.is_ghost) return 'severed';
  if (session.estimated_cost_usd > 0.05) return 'choked';
  return 'healthy';
}

// ─── Inject keyframe CSS once ─────────────────────────────────────────────────

let _stylesInjected = false;
function injectSanctumStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const el = document.createElement('style');
  el.textContent = `
    @keyframes ley-flow   { from { stroke-dashoffset: 60 } to { stroke-dashoffset: 0 } }
    @keyframes aura-pulse { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
    @keyframes rune-glow  { 0%,100% { text-shadow: 0 0 6px currentColor } 50% { text-shadow: 0 0 18px currentColor, 0 0 40px currentColor } }
    @keyframes sanctum-grid { 0%,100% { opacity:.04 } 50% { opacity:.07 } }
    @keyframes boss-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
    @keyframes emerge-card  { from { opacity:0; transform:translateY(16px) scale(.97) } to { opacity:1; transform:none } }
  `;
  document.head.appendChild(el);
}

// ─── Unit Frame ───────────────────────────────────────────────────────────────

interface CardData {
  session:     Session;
  depth:       number;
  idx:         number;
  total:       number;
  name:        string;
  role:        string;
  cls:         ClassConfig;
  leyStatus:   LeyStatus;
}

function hpPercent(session: Session, maxCost: number): number {
  if (session.is_ghost) return 8;
  // Invert cost: cheaper = healthier
  const ratio = maxCost > 0 ? session.estimated_cost_usd / maxCost : 0;
  return Math.max(30, Math.round(100 - ratio * 55));
}

function manaPercent(session: Session, maxTokens: number): number {
  const t = session.total_tokens ?? 0;
  return maxTokens > 0 ? Math.min(100, Math.round((t / maxTokens) * 100)) : 0;
}

function formatGold(usd: number): string {
  if (usd < 0.001) return `${(usd * 10000).toFixed(1)}c`;
  return `${usd.toFixed(4)}g`;
}

function formatDur(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function UnitFrame({
  card, maxCost, maxTokens, selected, onSelect,
}: {
  card: CardData; maxCost: number; maxTokens: number; selected: boolean; onSelect: () => void;
}) {
  const { session, name, role, cls } = card;
  const isGhost = !!session.is_ghost;
  const hp      = hpPercent(session, maxCost);
  const mp      = manaPercent(session, maxTokens);
  const cost    = session.estimated_cost_usd;
  const dur     = session.duration_seconds;

  const borderColor = selected ? '#63f7b3' : cls.color;
  const glowStr     = selected
    ? '0 0 0 2px #63f7b366, 0 0 32px #63f7b344'
    : `0 0 0 1px ${cls.color}44, 0 0 24px ${cls.auraColor}`;

  const tools = session.tools
    ? Object.entries(session.tools).sort((a, b) => b[1] - a[1]).slice(0, 4)
    : [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      style={{
        width: 186,
        flexShrink: 0,
        background: cls.gradient,
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        cursor: 'pointer',
        position: 'relative',
        boxShadow: glowStr,
        transform: selected ? 'scale(1.04) translateY(-4px)' : 'scale(1)',
        transition: 'box-shadow .2s, transform .15s',
        animation: 'emerge-card .35s cubic-bezier(.4,0,.2,1) both',
        overflow: 'visible',
      }}
    >
      {/* Aura ring */}
      <div style={{
        position: 'absolute', inset: -8, borderRadius: 12,
        border: `1px solid ${cls.color}33`,
        animation: isGhost ? undefined : 'aura-pulse 2.8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      {/* Corner ornaments */}
      {[
        { top: -3, left: -3 },
        { top: -3, right: -3 },
        { bottom: -3, left: -3 },
        { bottom: -3, right: -3 },
      ].map((pos, i) => (
        <div key={i} style={{
          position: 'absolute', ...pos,
          width: 8, height: 8,
          background: cls.color,
          clipPath: 'polygon(0 0, 100% 0, 100% 30%, 70% 30%, 70% 70%, 30% 70%, 30% 100%, 0 100%)',
          opacity: 0.7,
        }} />
      ))}

      {/* ── Portrait + name header ─────────────── */}
      <div style={{
        padding: '8px 10px 6px',
        borderBottom: `1px solid ${cls.color}22`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {/* Portrait */}
        <div style={{
          width: 32, height: 32, borderRadius: 4,
          background: `${cls.color}18`,
          border: `1px solid ${cls.color}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
          boxShadow: `inset 0 0 8px ${cls.auraColor}`,
        }}>
          {isGhost ? '💀' : cls.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9, fontWeight: 700,
            color: cls.color,
            letterSpacing: .8, textTransform: 'uppercase',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            animation: 'rune-glow 3s ease-in-out infinite',
          }}>
            {name}
          </div>
          <div style={{ fontSize: 7.5, color: '#e8d5a355', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 1 }}>
            {cls.classLabel}
          </div>
        </div>
      </div>

      {/* ── Role label ─────────────────────────── */}
      <div style={{
        padding: '3px 10px',
        fontSize: 7.5, letterSpacing: 1.8, textTransform: 'uppercase',
        color: '#e8d5a344',
        borderBottom: `1px solid ${cls.color}15`,
      }}>
        {role}
      </div>

      {/* ── HP / Mana bars ─────────────────────── */}
      <div style={{ padding: '7px 10px 5px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* HP */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 7.5, color: '#86efac', letterSpacing: .5 }}>HP</span>
            <span style={{ fontSize: 7.5, color: '#86efac99' }}>
              {isGhost ? 'SLAIN' : `${hp}%`}
            </span>
          </div>
          <div style={{
            height: 7, background: 'rgba(0,0,0,.55)', borderRadius: 2,
            border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${hp}%`,
              background: isGhost
                ? 'linear-gradient(90deg,#7f1d1d,#991b1b)'
                : hp > 60
                  ? 'linear-gradient(90deg,#16a34a,#22c55e)'
                  : hp > 30
                    ? 'linear-gradient(90deg,#ca8a04,#eab308)'
                    : 'linear-gradient(90deg,#dc2626,#ef4444)',
              borderRadius: 2,
              transition: 'width .6s cubic-bezier(.4,0,.2,1)',
            }} />
          </div>
        </div>

        {/* Mana */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 7.5, color: '#93c5fd', letterSpacing: .5 }}>MANA</span>
            <span style={{ fontSize: 7.5, color: '#93c5fd99' }}>{mp}%</span>
          </div>
          <div style={{
            height: 7, background: 'rgba(0,0,0,.55)', borderRadius: 2,
            border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${mp}%`,
              background: 'linear-gradient(90deg,#1d4ed8,#3b82f6)',
              borderRadius: 2,
              transition: 'width .6s cubic-bezier(.4,0,.2,1)',
            }} />
          </div>
        </div>
      </div>

      {/* ── Tools (spells) ─────────────────────── */}
      {tools.length > 0 && (
        <div style={{ padding: '0 10px 5px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {tools.map(([t, n]) => (
            <span key={t} style={{
              fontSize: 7.5, padding: '1px 5px',
              background: `${cls.color}18`,
              border: `1px solid ${cls.color}33`,
              borderRadius: 2, color: `${cls.color}cc`,
              letterSpacing: .3,
            }}>
              {t.slice(0, 5)}×{n}
            </span>
          ))}
        </div>
      )}

      {/* ── Stats footer ───────────────────────── */}
      <div style={{
        padding: '5px 10px 8px',
        borderTop: `1px solid ${cls.color}18`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, color: '#f59e0b', fontFamily: 'monospace', fontWeight: 600 }}>
          💰 {formatGold(cost)}
        </span>
        <span style={{ fontSize: 8.5, color: '#64748b' }}>
          ⏱ {formatDur(dur)}
        </span>
      </div>

      {/* Ghost diagonal overlay */}
      {isGhost && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 4, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(-45deg,transparent,transparent 5px,rgba(0,0,0,.22) 5px,rgba(0,0,0,.22) 10px)',
        }} />
      )}
    </div>
  );
}

// ─── Ley Line connector ───────────────────────────────────────────────────────

const LEY_COLORS: Record<LeyStatus, string> = {
  healthy: '#63f7b3',
  choked:  '#f59e0b',
  severed: '#ef4444',
};

function LeyLine({ status }: { status: LeyStatus }) {
  const color = LEY_COLORS[status];
  const W = 76;
  const MY = 30;

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: -10 }}>
      <svg width={W} height={60} viewBox={`0 0 ${W} 60`} overflow="visible" style={{ overflow: 'visible' }}>
        <defs>
          <filter id={`glow-${status}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id={`lg-${status}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={color} stopOpacity=".15" />
            <stop offset="45%"  stopColor={color} stopOpacity=".9"  />
            <stop offset="55%"  stopColor={color} stopOpacity=".9"  />
            <stop offset="100%" stopColor={color} stopOpacity=".15" />
          </linearGradient>
        </defs>

        {/* Track */}
        <line x1="0" y1={MY} x2={W} y2={MY} stroke={color} strokeWidth="1" opacity=".15" />

        {/* Flowing line */}
        <line
          x1="0" y1={MY} x2={W} y2={MY}
          stroke={`url(#lg-${status})`}
          strokeWidth="2.5"
          strokeDasharray={status === 'severed' ? '4 9' : '14 7'}
          opacity={status === 'severed' ? .35 : .85}
          filter={`url(#glow-${status})`}
          style={status !== 'severed' ? {
            animation: `ley-flow ${status === 'healthy' ? '1.1s' : '2.2s'} linear infinite`,
          } : undefined}
        />

        {/* Mid rune dot */}
        <circle
          cx={W / 2} cy={MY} r="4"
          fill={color}
          opacity={status === 'severed' ? .25 : .95}
          filter={`url(#glow-${status})`}
          style={status === 'healthy' ? { animation: 'aura-pulse 2s ease-in-out infinite' } : undefined}
        />

        {/* Arrowhead */}
        {status !== 'severed' && (
          <polygon
            points={`${W - 1},${MY - 4} ${W - 1},${MY + 4} ${W + 4},${MY}`}
            fill={color} opacity=".85"
          />
        )}
        {status === 'severed' && (
          <text x={W / 2} y={MY - 8} textAnchor="middle" fontSize="9" fill={color} opacity=".6">✕</text>
        )}
      </svg>
    </div>
  );
}

// ─── Boss health bar (pipeline cost) ─────────────────────────────────────────

function BossBar({ cost, label }: { cost: number; label: string }) {
  const pct = Math.min(100, (cost / 0.5) * 100);
  const color = pct > 70 ? '#ef4444' : pct > 35 ? '#f59e0b' : '#22c55e';

  return (
    <div style={{
      background: 'rgba(0,0,0,.55)',
      border: '1px solid #c8a85533',
      borderRadius: 6,
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        fontSize: 9, color: '#c8a855', letterSpacing: 2,
        textTransform: 'uppercase', flexShrink: 0, fontWeight: 700,
      }}>
        ⚗️ {label}
      </div>

      <div style={{ flex: 1, height: 13, background: 'rgba(0,0,0,.6)', borderRadius: 3, overflow: 'hidden', border: '1px solid #c8a85522', position: 'relative' }}>
        <div style={{
          height: '100%', width: `${Math.max(pct, 1.5)}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 2, transition: 'width .8s cubic-bezier(.4,0,.2,1)',
          backgroundSize: '200% 100%',
          animation: 'boss-shimmer 3s linear infinite',
        }} />
        {/* Segment overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'repeating-linear-gradient(90deg,transparent,transparent 19px,rgba(0,0,0,.3) 19px,rgba(0,0,0,.3) 20px)',
        }} />
      </div>

      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f59e0b', flexShrink: 0, fontWeight: 700 }}>
        💰 ${cost.toFixed(4)}
      </span>
    </div>
  );
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function DetailDrawer({ card, onClose }: { card: CardData; onClose: () => void }) {
  const s = card.session;
  const tools = s.tools ? Object.entries(s.tools).sort((a, b) => b[1] - a[1]) : [];
  const { cls } = card;

  return (
    <div style={{
      margin: '0 24px',
      background: `linear-gradient(135deg, rgba(0,0,0,.75), ${cls.gradient.replace('linear-gradient(160deg,', 'linear-gradient(135deg,').replace(' 100%)', ' 60%)')}`,
      border: `1px solid ${cls.color}44`,
      borderRadius: 8,
      padding: '14px 18px 16px',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
      gap: 14,
      position: 'relative',
    }}>
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 10, right: 12,
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#64748b', fontSize: 14, padding: 4,
        }}
      >
        ✕
      </button>

      {[
        { label: 'Session',  value: `${s.session_id.slice(0, 24)}…`, mono: true },
        { label: 'Model',    value: s.model, mono: true, color: cls.color },
        { label: 'Tokens',   value: `${(s.input_tokens ?? 0).toLocaleString()} in / ${(s.output_tokens ?? 0).toLocaleString()} out`, mono: true },
        { label: 'Cache',    value: `${(s.cache_read_tokens ?? 0).toLocaleString()} read / ${(s.cache_creation_tokens ?? 0).toLocaleString()} written`, mono: true, color: '#63f7b3' },
        { label: 'Project',  value: s.project },
        { label: 'Duration', value: formatDur(s.duration_seconds) },
      ].map(({ label, value, mono, color }) => (
        <div key={label}>
          <div style={{ fontSize: 8.5, color: '#c8a85577', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
          <div style={{
            fontSize: 10.5, color: color ?? '#e8d5a3',
            fontFamily: mono ? 'monospace' : 'inherit',
            wordBreak: 'break-all',
          }}>
            {value}
          </div>
        </div>
      ))}

      {tools.length > 0 && (
        <div>
          <div style={{ fontSize: 8.5, color: '#c8a85577', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Spells Cast</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tools.map(([t, n]) => (
              <span key={t} style={{
                fontSize: 9, padding: '2px 7px',
                background: `${cls.color}1a`,
                border: `1px solid ${cls.color}44`,
                borderRadius: 3, color: cls.color,
              }}>
                {t} ×{n}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { color: '#63f7b3', dot: true,  label: 'HEALTHY LEY LINE' },
  { color: '#f59e0b', dot: true,  label: 'CHOKED LEY LINE' },
  { color: '#ef4444', dot: true,  label: 'SEVERED' },
  { color: '#4ade80', dot: false, label: '⌘ JSON RUNESTONE' },
  { color: '#e2e8f0', dot: false, label: '✦ TEXT RUNESTONE' },
  { color: '#f87171', dot: false, label: '⚠ ERROR RUNESTONE' },
];

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      minHeight: 420, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center,#1a0933 0%,#080612 100%)',
      borderRadius: 12, gap: 14,
    }}>
      <div style={{ fontSize: 44 }}>🔮</div>
      <div style={{ fontSize: 15, color: '#e8d5a377', letterSpacing: 1, textTransform: 'uppercase' }}>
        The Sanctum Awaits
      </div>
      <div style={{ fontSize: 12, color: '#c8a85555', maxWidth: 320, textAlign: 'center', lineHeight: 1.7 }}>
        No agent sessions found. Run Claude Code with subagents enabled, then sync.
      </div>
      <pre style={{
        fontSize: 11, color: '#63f7b3', fontFamily: 'monospace',
        background: 'rgba(0,0,0,.4)', border: '1px solid #63f7b322',
        borderRadius: 6, padding: '8px 18px',
      }}>
        node sync/export-local.mjs
      </pre>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ScryingSanctum({ sessions }: { sessions: Session[] }) {
  const [runIdx,    setRunIdx]    = useState(0);
  const [selected,  setSelected]  = useState<string | null>(null);

  useEffect(() => { injectSanctumStyles(); }, []);

  const groups = useMemo(() => getSessionRunGroups(sessions), [sessions]);
  const group  = groups[runIdx] ?? null;

  // Flatten the run group into a display list
  const cards: CardData[] = useMemo(() => {
    if (!group) return [];
    const flat: CardData[] = [];
    let idx = 0;

    function walk(node: AgentTreeNode, depth: number) {
      const cat = node.session.cat_type ?? 'ghost';
      flat.push({
        session:   node.session,
        depth,
        idx:       idx++,
        total:     0,          // backfilled below
        name:      getFantasyName(node.session, idx - 1, depth),
        role:      '',         // backfilled below
        cls:       CLASS_MAP[cat] ?? CLASS_MAP.ghost,
        leyStatus: leyStatus(node.session),
      });
      for (const child of node.children) walk(child, depth + 1);
    }
    for (const root of group.roots) walk(root, 0);

    const total = flat.length;
    flat.forEach((c, i) => {
      c.total = total;
      c.role  = getPipelineRole(i, total);
    });
    return flat;
  }, [group]);

  const maxCost   = useMemo(() => Math.max(...cards.map((c) => c.session.estimated_cost_usd), 0.001), [cards]);
  const maxTokens = useMemo(() => Math.max(...cards.map((c) => c.session.total_tokens ?? 0), 1), [cards]);
  const totalCost = group?.totalCost ?? 0;
  const runName   = group?.project ?? 'Primary Sanctum';

  const selectedCard = cards.find((c) => c.session.session_id === selected) ?? null;

  if (groups.length === 0) return <EmptyState />;

  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      background: 'radial-gradient(ellipse at 25% 15%,#160828 0%,#07040f 55%,#030208 100%)',
      borderRadius: 12,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Dungeon grid pattern */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px,rgba(200,168,85,.05) 1px,transparent 0)',
        backgroundSize: '28px 28px',
        animation: 'sanctum-grid 6s ease-in-out infinite',
      }} />

      {/* Corner runes */}
      {['╔', '╗', '╚', '╝'].map((r, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: i < 2 ? 8 : undefined,
          bottom: i >= 2 ? 8 : undefined,
          left: i % 2 === 0 ? 8 : undefined,
          right: i % 2 === 1 ? 8 : undefined,
          fontSize: 20, color: '#c8a85522',
          fontFamily: 'monospace', lineHeight: 1,
          pointerEvents: 'none',
        }}>
          {r}
        </div>
      ))}

      {/* ── Boss bar ───────────────────────────────────── */}
      <div style={{ padding: '16px 24px 0', position: 'relative', zIndex: 2 }}>
        <BossBar cost={totalCost} label="Pipeline Mana Cost" />
      </div>

      {/* ── Header ────────────────────────────────────── */}
      <div style={{
        padding: '12px 24px 10px',
        borderBottom: '1px solid rgba(200,168,85,.12)',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'relative', zIndex: 2,
      }}>
        <div>
          <div style={{ fontSize: 9, color: '#c8a85566', letterSpacing: 3, textTransform: 'uppercase' }}>
            Scrying Sanctum
          </div>
          <div style={{
            fontSize: 17, color: '#e8d5a3', fontWeight: 300,
            letterSpacing: 1.5, textTransform: 'uppercase',
          }}>
            {runName}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <span style={{ fontSize: 9, color: '#94a3b8' }}>
            {cards.length} agent{cards.length !== 1 ? 's' : ''}
          </span>

          <select
            value={runIdx}
            onChange={(e) => { setRunIdx(+e.target.value); setSelected(null); }}
            style={{
              background: 'rgba(0,0,0,.65)',
              border: '1px solid #c8a85533',
              borderRadius: 4, color: '#e8d5a3',
              fontSize: 11, padding: '5px 10px',
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {groups.slice(0, 40).map((g, i) => (
              <option key={i} value={i}>
                {g.project} — ${g.totalCost.toFixed(3)} · {g.roots.length} root{g.roots.length !== 1 ? 's' : ''}
              </option>
            ))}
          </select>

          <div style={{
            fontSize: 8.5, letterSpacing: 2, padding: '3px 10px',
            border: '1px solid #63f7b355', borderRadius: 2,
            color: '#63f7b3', background: 'rgba(99,247,179,.07)',
            textTransform: 'uppercase',
          }}>
            ACTIVE
          </div>
        </div>
      </div>

      {/* ── Pipeline canvas ────────────────────────────── */}
      <div style={{
        flex: 1, padding: '36px 24px 20px',
        overflowX: 'auto', overflowY: 'visible',
        position: 'relative', zIndex: 2,
      }}>
        {cards.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#c8a85544', padding: '60px 0', fontSize: 13 }}>
            No agents in this run
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center',
            minWidth: 'max-content',
            padding: '20px 24px',
            gap: 0,
          }}>
            {cards.map((card, i) => (
              <div key={card.session.session_id} style={{ display: 'contents' }}>
                <UnitFrame
                  card={card}
                  maxCost={maxCost}
                  maxTokens={maxTokens}
                  selected={selected === card.session.session_id}
                  onSelect={() => setSelected(
                    selected === card.session.session_id ? null : card.session.session_id
                  )}
                />
                {i < cards.length - 1 && (
                  <LeyLine status={card.leyStatus} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Detail drawer ──────────────────────────────── */}
      {selectedCard && (
        <div style={{ position: 'relative', zIndex: 2, paddingBottom: 12 }}>
          <DetailDrawer card={selectedCard} onClose={() => setSelected(null)} />
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────── */}
      <div style={{
        padding: '12px 24px 14px',
        borderTop: '1px solid rgba(200,168,85,.1)',
        display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
        position: 'relative', zIndex: 2,
      }}>
        {LEGEND_ITEMS.map(({ color, dot, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {dot
              ? <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
              : <span style={{ fontSize: 9, color }} />}
            <span style={{ fontSize: 8.5, color: '#c8a85566', letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {label}
            </span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 8.5, color: '#c8a85533' }}>
          SCROLL TO ZOOM · DRAG TO PAN
        </div>
      </div>
    </div>
  );
}
