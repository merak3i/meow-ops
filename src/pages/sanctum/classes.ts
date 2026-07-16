// Champion class metadata for the Scrying Sanctum.
//
// Each cat_type maps to a fixed character class (CLASS_MAP), an aura
// animation profile (AURA_PROFILES), a movement personality
// (MOVEMENT_PROFILES), a pool of randomised character quotes
// (CHARACTER_QUOTES), and a list of milestone-triggered signature moves
// (SIGNATURE_MOVES). The role helpers (getPipelineRole, getChampionName)
// sit here too because they read from this metadata; pickQuote is the only
// piece of behaviour that lives next to the data so a future reader can
// see the full quote system in one file.

import type { Session } from '@/types/session';
import type {
  ClassConfig,
  MovementProfile,
  QuoteFn,
  SignatureMove,
} from './types';

// ─── Class config ────────────────────────────────────────────────────────────

export const CLASS_MAP: Record<string, ClassConfig> = {
  builder:     { color: '#d68a3a', emissive: '#6b3418', label: 'FORGEPAW',      aura: '#f2d06b' },
  detective:   { color: '#514c68', emissive: '#171521', label: 'GLOAMWHISKER',  aura: '#5cd2ff' },
  commander:   { color: '#b96555', emissive: '#562b35', label: 'HEXCALLER',     aura: '#ef4460' },
  architect:   { color: '#332c43', emissive: '#17131f', label: 'VOIDMANE',      aura: '#9f7aea' },
  guardian:    { color: '#526fa8', emissive: '#273b69', label: 'SHIELDHEART',   aura: '#5cd2ff' },
  storyteller: { color: '#b8b4aa', emissive: '#4e4a49', label: 'LOREWEAVER',    aura: '#d7bc78' },
  ghost:       { color: '#73808c', emissive: '#39414b', label: 'NINELIVES',     aura: '#ef705e' },
};
export const FALLBACK_CLASS: ClassConfig = { color: '#888', emissive: '#222', label: 'AGENT', aura: '#888' };

// ─── Per-session accent palette ──────────────────────────────────────────────

export const SESSION_ACCENTS = [
  '#f59e0b', // amber
  '#fb7185', // rose
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#10b981', // emerald
  '#a78bfa', // violet
  '#d97706', // copper
] as const;

// ─── Aura animation profiles ─────────────────────────────────────────────────

export const AURA_PROFILES: Record<string, { speed: number; amplitude: number; style: 'pulse' | 'flicker' | 'breathe' }> = {
  builder:     { speed: 3.8,  amplitude: 0.14, style: 'pulse' },    // Forgepaw — aggressive, fast
  detective:   { speed: 1.8,  amplitude: 0.08, style: 'breathe' },  // Gloamwhisker — calm, steady
  commander:   { speed: 2.5,  amplitude: 0.12, style: 'pulse' },    // Hexcaller — mystic rhythm
  architect:   { speed: 1.2,  amplitude: 0.06, style: 'breathe' },  // Voidmane — slow, menacing
  guardian:    { speed: 2.0,  amplitude: 0.10, style: 'pulse' },    // Shieldheart — steady, reliable
  storyteller: { speed: 1.0,  amplitude: 0.10, style: 'breathe' },  // Loreweaver — slow, ethereal
  ghost:       { speed: 6.0,  amplitude: 0.18, style: 'flicker' },  // Ninelives — spectral flicker
};
export const DEFAULT_AURA = { speed: 2.2, amplitude: 0.07, style: 'pulse' as const };

// ─── Pipeline roles (champion role labels by sequence position) ──────────────

export const PIPELINE_ROLES = ['ALPHA', 'RECON', 'SORCERER', 'HERALD'];
export const EXTRA_ROLES    = ['RUNNER', 'LINK',  'BRANCH',   'AUXILIARY'];

// ─── Movement personality profiles ───────────────────────────────────────────

export const MOVEMENT_PROFILES: Record<string, MovementProfile> = {
  builder:     { speed: 2.2, bounceAmp: 0.10, idlePauseMin: 0.3, idlePauseMax: 1.2, breatheSpeed: 2.0, breatheAmp: 0.03, prefersEdge: false, prefersAllies: false },  // Forgepaw — aggressive, restless
  detective:   { speed: 1.6, bounceAmp: 0.03, idlePauseMin: 2.0, idlePauseMax: 5.0, breatheSpeed: 1.0, breatheAmp: 0.02, prefersEdge: true,  prefersAllies: false },  // Gloamwhisker — stalks edges
  commander:   { speed: 1.0, bounceAmp: 0.01, idlePauseMin: 1.5, idlePauseMax: 4.0, breatheSpeed: 0.8, breatheAmp: 0.06, prefersEdge: false, prefersAllies: false },  // Hexcaller — floats
  architect:   { speed: 0.8, bounceAmp: 0.02, idlePauseMin: 3.0, idlePauseMax: 7.0, breatheSpeed: 0.6, breatheAmp: 0.02, prefersEdge: false, prefersAllies: false },  // Voidmane — slow, imposing
  guardian:    { speed: 1.8, bounceAmp: 0.07, idlePauseMin: 0.5, idlePauseMax: 2.0, breatheSpeed: 1.4, breatheAmp: 0.03, prefersEdge: false, prefersAllies: true  },  // Cap — patrol, near allies
  storyteller: { speed: 1.0, bounceAmp: 0.04, idlePauseMin: 2.0, idlePauseMax: 6.0, breatheSpeed: 0.7, breatheAmp: 0.05, prefersEdge: false, prefersAllies: false },  // Loreweaver — contemplative
  ghost:       { speed: 1.4, bounceAmp: 0.01, idlePauseMin: 1.0, idlePauseMax: 3.0, breatheSpeed: 0.4, breatheAmp: 0.01, prefersEdge: false, prefersAllies: false },  // Ninelives — spectral
};
export const DEFAULT_MOVEMENT: MovementProfile = { speed: 1.5, bounceAmp: 0.05, idlePauseMin: 0.5, idlePauseMax: 2.5, breatheSpeed: 1.4, breatheAmp: 0.04, prefersEdge: false, prefersAllies: false };

// ─── Character quotes ────────────────────────────────────────────────────────

export const CHARACTER_QUOTES: Record<string, (string | QuoteFn)[]> = {
  builder: [ // Forgepaw
    'Hot path. Hammer down.',
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens tempered clean.`,
    (s) => s.estimated_cost_usd > 1 ? 'A costly alloy, but it will hold.' : 'Barely warmed the forge.',
    (s) => `${s.message_count} strikes. The build still rings true.`,
    (s) => `Project ${s.project} is on the anvil.`,
  ],
  detective: [ // Gloamwhisker
    'Every trace leaves a shadow.',
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens searched under moonlight.`,
    (s) => s.duration_seconds > 600 ? 'A long watch reveals the hidden branch.' : 'A clean, quick read.',
    (s) => `Project ${s.project}. The evidence aligns.`,
    'Quiet paws, loud findings.',
  ],
  commander: [ // Hexcaller
    'The queue obeys the circle.',
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens bound into one command.`,
    (s) => s.duration_seconds > 600 ? 'The ritual held through a long watch.' : 'A brief invocation.',
    (s) => `Project ${s.project}. All agents answer.`,
    'One gesture. Seven paths.',
  ],
  architect: [ // Voidmane
    "I find your lack of tests disturbing.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens arranged in the dark.`,
    (s) => s.estimated_cost_usd > 2 ? 'The structure demands tribute.' : 'Efficient. As designed.',
    (s) => `Project ${s.project}. The foundations are listening.`,
    (s) => s.duration_seconds > 600 ? 'Long work makes deep architecture.' : 'The plan is sufficient.',
  ],
  guardian: [ // Shieldheart
    'Hold the line. Keep the diff small.',
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens guarded.`,
    (s) => s.estimated_cost_usd > 1 ? 'Protection has a price.' : 'Under budget, under ward.',
    (s) => `${s.message_count} messages. Every voice accounted for.`,
    (s) => `Project ${s.project} remains inside the ward.`,
  ],
  storyteller: [ // Loreweaver
    'Every session leaves a thread.',
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens woven into the record.`,
    (s) => s.duration_seconds > 600 ? 'A long chapter, worth the telling.' : 'A bright little verse.',
    (s) => `Project ${s.project}. The next line is yours.`,
    'Keep the tale legible.',
  ],
  ghost: [ // Ninelives
    'One life ended. Eight remain.',
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens echo in the seam.`,
    (s) => s.estimated_cost_usd > 1 ? 'A bright ember for a vanished run.' : 'A quiet crossing.',
    (s) => `Project ${s.project} still remembers.`,
    (s) => `The wisp carried ${Math.round(s.duration_seconds)} seconds to the Eternal.`,
  ],
  _fallback: [
    "Processing...",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens spent.`,
    "Standing by.",
  ],
};

export function pickQuote(catType: string, session: Session): string {
  const quotes = CHARACTER_QUOTES[catType] ?? CHARACTER_QUOTES._fallback!;
  const q = quotes[Math.floor(Math.random() * quotes.length)]!;
  return typeof q === 'function' ? q(session) : q;
}

// ─── Signature moves (5 per character, triggered by milestones) ─────────────

export const SIGNATURE_MOVES: Record<string, SignatureMove[]> = {
  builder: [ // Forgepaw
    { name: 'Berserker Rage',    trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '🔥', quote: 'BERSERKER RAGE! 500K tokens unleashed!' },
    { name: 'Healing Factor',    trigger: (s) => s.is_ghost === false && s.message_count > 20, emoji: '💚', quote: "Can't keep me down. Healing factor engaged." },
    { name: 'Tempered Slash',    trigger: (s) => Object.keys(s.tools ?? {}).length >= 5,     emoji: '⚔️', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools tempered and ready.` },
    { name: 'Feral Instinct',    trigger: (s) => s.duration_seconds < 120 && s.message_count > 5, emoji: '⚡', quote: 'Speed run. Pure feral instinct.' },
    { name: 'White-Hot Forge',   trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '💀', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)} fed the forge.` },
  ],
  detective: [ // Gloamwhisker
    { name: 'Long Watch',        trigger: (s) => s.duration_seconds > 1800,                  emoji: '🌘', quote: 'Long watch. Every trace stays visible.' },
    { name: 'Utility Belt',      trigger: (s) => Object.keys(s.tools ?? {}).length >= 6,     emoji: '🔧', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools deployed. Always prepared.` },
    { name: 'Detective Mode',    trigger: (s) => (s.tools?.Read ?? 0) + (s.tools?.Grep ?? 0) > 20, emoji: '🔍', quote: 'Detective mode. Every line analyzed.' },
    { name: 'Needlepoint',       trigger: (s) => s.message_count > 30,                       emoji: '🎯', quote: 'Precision findings. 30+ messages, zero wasted.' },
    { name: 'Batcave Analytics', trigger: (s) => s.estimated_cost_usd < 0.10 && s.message_count > 10, emoji: '🖥️', quote: 'Cost-efficient. The Batcave runs lean.' },
  ],
  commander: [ // Hexcaller
    { name: 'Time Stone',        trigger: (s) => s.duration_seconds > 1200,                  emoji: '💎', quote: "I've looked forward in time. This session is inevitable." },
    { name: 'Mirror Dimension',  trigger: (s) => (s.agent_depth ?? 0) > 0,                  emoji: '🪞', quote: 'Operating in the Mirror Dimension. Sub-agent deployed.' },
    { name: 'Mystic Arts',       trigger: (s) => (s.total_tokens ?? 0) > 300_000,           emoji: '✨', quote: '300K tokens channeled through the Mystic Arts.' },
    { name: 'Astral Projection', trigger: (s) => s.is_ghost === true,                        emoji: '👻', quote: 'Astral form. The session ended but the spirit lingers.' },
    { name: 'Sling Ring',        trigger: (s) => (s.tools?.Agent ?? 0) > 3,                  emoji: '🌀', quote: (s) => `${s.tools?.Agent ?? 0} portals opened. The Sling Ring is powerful.` },
  ],
  architect: [ // Voidmane
    { name: 'Void Clamp',        trigger: (s) => s.is_ghost === true,                        emoji: '🤜', quote: 'An unfinished run collapses under its own weight.' },
    { name: 'Black Foundation',  trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '🌑', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)} laid into the foundation.` },
    { name: 'Obsidian Cadence',  trigger: (s) => s.message_count > 50,                       emoji: '🎵', quote: '50+ messages. The structure keeps its cadence.' },
    { name: 'Void Current',      trigger: (s) => (s.output_tokens ?? 0) > 200_000,          emoji: '⚡', quote: '200K output tokens through one dark current.' },
    { name: 'Edge Constraint',   trigger: (s) => Object.keys(s.tools ?? {}).length >= 4,     emoji: '⚔️', quote: 'Four tools held to one clean boundary.' },
  ],
  guardian: [ // Shieldheart
    { name: 'Shield Throw',      trigger: (s) => s.is_ghost === false && s.estimated_cost_usd < 0.50, emoji: '🛡️', quote: 'Shield throw! Clean mission, under budget.' },
    { name: 'Ward Assembly',     trigger: (s) => (s.tools?.Agent ?? 0) > 2,                  emoji: '🦸', quote: (s) => `${s.tools?.Agent ?? 0} allied agents inside the ward.` },
    { name: 'Vibranium Resolve', trigger: (s) => s.duration_seconds > 1800,                  emoji: '💪', quote: 'I can do this all day. 30+ minutes and counting.' },
    { name: 'Super Soldier',     trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '💉', quote: 'Super Soldier serum working overtime. 500K tokens.' },
    { name: 'Star Spangled',     trigger: (s) => s.message_count > 40 && !s.is_ghost,       emoji: '⭐', quote: '40+ messages, mission complete. Star-spangled success.' },
  ],
  storyteller: [ // Loreweaver
    { name: 'Closed Chapter',    trigger: (s) => s.is_ghost === true,                        emoji: '🧙', quote: 'This session closed before its final line.' },
    { name: 'Silver Quill',      trigger: (s) => (s.total_tokens ?? 0) > 1_000_000,         emoji: '🤍', quote: 'One million tokens entered the archive.' },
    { name: 'Quick Verse',       trigger: (s) => s.duration_seconds < 180 && s.message_count > 10, emoji: '🐾', quote: 'A swift session, tightly told.' },
    { name: 'Courier Flock',     trigger: (s) => (s.tools?.Agent ?? 0) > 4,                  emoji: '🦅', quote: 'A flock of sub-agents carries the tale onward.' },
    { name: 'Lantern Line',      trigger: (s) => s.estimated_cost_usd > 3,                  emoji: '💫', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)} keeps the archive lantern lit.` },
  ],
  ghost: [ // Ninelives
    { name: 'Another Life',      trigger: (s) => s.is_ghost === true,                        emoji: '🐈', quote: 'One life ended. The colony remembers.' },
    { name: 'Clean Crossing',    trigger: (s) => s.is_ghost === false && s.message_count > 20, emoji: '✨', quote: 'Mission complete. The wisp stays warm.' },
    { name: 'Wisp Protocol',     trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '🌐', quote: 'The half-millionth token joined the wisp.' },
    { name: 'Ninefold Mode',     trigger: (s) => Object.keys(s.tools ?? {}).length >= 5,     emoji: '🔄', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools echo across nine lives.` },
    { name: 'Final Crossing',    trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '☠️', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)} crossed into memory.` },
  ],
};

// ─── Role + name helpers ─────────────────────────────────────────────────────

export function getPipelineRole(i: number, total: number): string {
  if (total <= 1) return PIPELINE_ROLES[2]!;
  if (total <= 4) return PIPELINE_ROLES[Math.min(i, 3)]!;
  return EXTRA_ROLES[i % EXTRA_ROLES.length]!;
}

export function getChampionName(session: Session, i: number): string {
  if (session.agent_slug) {
    return session.agent_slug.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  }
  const cat = session.cat_type ?? 'ghost';
  const cls = CLASS_MAP[cat] ?? FALLBACK_CLASS;
  return `${cls.label} ${String.fromCharCode(0x03b1 + (i % 24))}`;
}
