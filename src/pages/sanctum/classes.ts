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
  builder:     { color: '#f5c518', emissive: '#7c5a00', label: 'WOLVERINE',    aura: '#f5c518' },
  detective:   { color: '#2a2a2a', emissive: '#0a0a0a', label: 'BATMAN',       aura: '#4a90d9' },
  commander:   { color: '#dc3545', emissive: '#5a1520', label: 'DR. STRANGE',  aura: '#dc3545' },
  architect:   { color: '#1a1a1a', emissive: '#0a0a0a', label: 'DARTH VADER',  aura: '#ff3333' },
  guardian:    { color: '#2563eb', emissive: '#0a1a5a', label: 'CAPTAIN AMERICA', aura: '#2563eb' },
  storyteller: { color: '#9ca3af', emissive: '#3a3a3a', label: 'GANDALF',      aura: '#e2e8f0' },
  ghost:       { color: '#6b7280', emissive: '#1a1a1a', label: 'TERMINATOR',   aura: '#ef4444' },
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
  builder:     { speed: 3.8,  amplitude: 0.14, style: 'pulse' },    // Wolverine — aggressive, fast
  detective:   { speed: 1.8,  amplitude: 0.08, style: 'breathe' },  // Batman — calm, steady
  commander:   { speed: 2.5,  amplitude: 0.12, style: 'pulse' },    // Dr. Strange — mystic rhythm
  architect:   { speed: 1.2,  amplitude: 0.06, style: 'breathe' },  // Vader — slow, menacing
  guardian:    { speed: 2.0,  amplitude: 0.10, style: 'pulse' },    // Cap — steady, reliable
  storyteller: { speed: 1.0,  amplitude: 0.10, style: 'breathe' },  // Gandalf — slow, ethereal
  ghost:       { speed: 6.0,  amplitude: 0.18, style: 'flicker' },  // Terminator — electronic glitch
};
export const DEFAULT_AURA = { speed: 2.2, amplitude: 0.07, style: 'pulse' as const };

// ─── Pipeline roles (champion role labels by sequence position) ──────────────

export const PIPELINE_ROLES = ['ALPHA', 'RECON', 'SORCERER', 'HERALD'];
export const EXTRA_ROLES    = ['RUNNER', 'LINK',  'BRANCH',   'AUXILIARY'];

// ─── Movement personality profiles ───────────────────────────────────────────

export const MOVEMENT_PROFILES: Record<string, MovementProfile> = {
  builder:     { speed: 2.2, bounceAmp: 0.10, idlePauseMin: 0.3, idlePauseMax: 1.2, breatheSpeed: 2.0, breatheAmp: 0.03, prefersEdge: false, prefersAllies: false },  // Wolverine — aggressive, restless
  detective:   { speed: 1.6, bounceAmp: 0.03, idlePauseMin: 2.0, idlePauseMax: 5.0, breatheSpeed: 1.0, breatheAmp: 0.02, prefersEdge: true,  prefersAllies: false },  // Batman — smooth, stalks edges
  commander:   { speed: 1.0, bounceAmp: 0.01, idlePauseMin: 1.5, idlePauseMax: 4.0, breatheSpeed: 0.8, breatheAmp: 0.06, prefersEdge: false, prefersAllies: false },  // Dr. Strange — floats
  architect:   { speed: 0.8, bounceAmp: 0.02, idlePauseMin: 3.0, idlePauseMax: 7.0, breatheSpeed: 0.6, breatheAmp: 0.02, prefersEdge: false, prefersAllies: false },  // Vader — slow, imposing
  guardian:    { speed: 1.8, bounceAmp: 0.07, idlePauseMin: 0.5, idlePauseMax: 2.0, breatheSpeed: 1.4, breatheAmp: 0.03, prefersEdge: false, prefersAllies: true  },  // Cap — patrol, near allies
  storyteller: { speed: 1.0, bounceAmp: 0.04, idlePauseMin: 2.0, idlePauseMax: 6.0, breatheSpeed: 0.7, breatheAmp: 0.05, prefersEdge: false, prefersAllies: false },  // Gandalf — contemplative
  ghost:       { speed: 1.4, bounceAmp: 0.01, idlePauseMin: 1.0, idlePauseMax: 3.0, breatheSpeed: 0.4, breatheAmp: 0.01, prefersEdge: false, prefersAllies: false },  // Terminator — mechanical
};
export const DEFAULT_MOVEMENT: MovementProfile = { speed: 1.5, bounceAmp: 0.05, idlePauseMin: 0.5, idlePauseMax: 2.5, breatheSpeed: 1.4, breatheAmp: 0.04, prefersEdge: false, prefersAllies: false };

// ─── Character quotes ────────────────────────────────────────────────────────

export const CHARACTER_QUOTES: Record<string, (string | QuoteFn)[]> = {
  builder: [ // Wolverine
    "I'm the best at what I do.",
    "Don't make me pop these claws.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens? I've survived worse.`,
    (s) => s.estimated_cost_usd > 1 ? "That's an expensive healing factor." : "Barely a scratch.",
    "Wrong move, bub.",
    (s) => `${s.message_count} messages. Each one with adamantium resolve.`,
    (s) => `Project ${s.project}? I'll tear through it.`,
    "Nature made me a freak. Code made me a weapon.",
  ],
  detective: [ // Batman
    "I am vengeance.",
    "It's not who I am underneath, it's what I do that defines me.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens processed in the shadows.`,
    (s) => s.duration_seconds > 600 ? "Long night. They always are." : "Quick extraction.",
    "Criminals are a cowardly, superstitious lot.",
    (s) => `Project ${s.project}. I have files on everyone.`,
    (s) => s.estimated_cost_usd > 2 ? "Wayne Enterprises can cover it." : "Cost-efficient. Alfred would approve.",
    "I work alone. Mostly.",
  ],
  commander: [ // Dr. Strange
    "I've come to bargain.",
    "The Multiverse is a concept about which we know frighteningly little.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. I've seen 14 million outcomes.`,
    (s) => s.duration_seconds > 600 ? "Time is relative in the Mirror Dimension." : "A brief spell.",
    "Dormammu, I've come to debug.",
    (s) => `Project ${s.project}. The Eye of Agamotto reveals all.`,
    (s) => s.estimated_cost_usd > 1 ? "The bill is mystical in nature." : "A small price for salvation.",
    "We're in the endgame now.",
  ],
  architect: [ // Darth Vader
    "I find your lack of tests disturbing.",
    "The Force is strong with this codebase.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. Impressive. Most impressive.`,
    (s) => s.estimated_cost_usd > 2 ? "The cost of this battle station..." : "Efficient. As I have foreseen.",
    "You don't know the power of the dark side.",
    (s) => `Project ${s.project}. I have altered the code. Pray I don't alter it further.`,
    (s) => s.duration_seconds > 600 ? "Long session. Your destiny lies with me." : "All too easy.",
    "Search your feelings. You know it to be true.",
  ],
  guardian: [ // Captain America
    "I can do this all day.",
    "Whatever happens tomorrow, you must promise me one thing: ship clean code.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. Not a single one wasted.`,
    (s) => s.estimated_cost_usd > 1 ? "Freedom isn't free, and neither is compute." : "Under budget. A soldier's discipline.",
    "Avengers, assemble!",
    (s) => `${s.message_count} messages. Every voice matters.`,
    (s) => `Project ${s.project}. I don't like bullies — or bad architecture.`,
    "I could do this all day.",
  ],
  storyteller: [ // Gandalf
    "A wizard is never late. Nor is he early.",
    "You shall not pass... without code review.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens. Even the smallest token can change the course of the future.`,
    (s) => s.duration_seconds > 600 ? "Time? What time do you think we have?" : "Swift as a ray of Valar light.",
    "Fly, you fools!",
    (s) => `Project ${s.project}. All we have to decide is what to do with the code that is given us.`,
    (s) => s.estimated_cost_usd > 2 ? "A wizard's bill is never simple." : "A modest expenditure of power.",
    "Keep it secret. Keep it safe.",
  ],
  ghost: [ // Terminator
    "I'll be back.",
    "Hasta la vista, baby.",
    (s) => `${(s.total_tokens ?? 0).toLocaleString()} tokens processed. Mission parameters met.`,
    (s) => s.estimated_cost_usd > 1 ? "Resource expenditure exceeds optimal range." : "Operating within parameters.",
    "Come with me if you want to ship.",
    (s) => `Target acquired: ${s.project}.`,
    (s) => s.duration_seconds > 600 ? "Extended combat operation." : "Terminated in ${Math.round(s.duration_seconds)}s.",
    "Your clothes. Give them to me. Now.",
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
  builder: [ // Wolverine
    { name: 'Berserker Rage',    trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '🔥', quote: 'BERSERKER RAGE! 500K tokens unleashed!' },
    { name: 'Healing Factor',    trigger: (s) => s.is_ghost === false && s.message_count > 20, emoji: '💚', quote: "Can't keep me down. Healing factor engaged." },
    { name: 'Adamantium Slash',  trigger: (s) => Object.keys(s.tools ?? {}).length >= 5,     emoji: '⚔️', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools mastered. SNIKT!` },
    { name: 'Feral Instinct',    trigger: (s) => s.duration_seconds < 120 && s.message_count > 5, emoji: '⚡', quote: 'Speed run. Pure feral instinct.' },
    { name: 'Weapon X',          trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '💀', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)} spent. The Weapon X program was expensive too.` },
  ],
  detective: [ // Batman
    { name: 'Dark Knight Protocol', trigger: (s) => s.duration_seconds > 1800,               emoji: '🦇', quote: 'Long night. Dark Knight Protocol active.' },
    { name: 'Utility Belt',      trigger: (s) => Object.keys(s.tools ?? {}).length >= 6,     emoji: '🔧', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools deployed. Always prepared.` },
    { name: 'Detective Mode',    trigger: (s) => (s.tools?.Read ?? 0) + (s.tools?.Grep ?? 0) > 20, emoji: '🔍', quote: 'Detective mode. Every line analyzed.' },
    { name: 'Batarang',          trigger: (s) => s.message_count > 30,                       emoji: '🎯', quote: 'Precision strikes. 30+ messages, zero wasted.' },
    { name: 'Batcave Analytics', trigger: (s) => s.estimated_cost_usd < 0.10 && s.message_count > 10, emoji: '🖥️', quote: 'Cost-efficient. The Batcave runs lean.' },
  ],
  commander: [ // Dr. Strange
    { name: 'Time Stone',        trigger: (s) => s.duration_seconds > 1200,                  emoji: '💎', quote: "I've looked forward in time. This session is inevitable." },
    { name: 'Mirror Dimension',  trigger: (s) => (s.agent_depth ?? 0) > 0,                  emoji: '🪞', quote: 'Operating in the Mirror Dimension. Sub-agent deployed.' },
    { name: 'Mystic Arts',       trigger: (s) => (s.total_tokens ?? 0) > 300_000,           emoji: '✨', quote: '300K tokens channeled through the Mystic Arts.' },
    { name: 'Astral Projection', trigger: (s) => s.is_ghost === true,                        emoji: '👻', quote: 'Astral form. The session ended but the spirit lingers.' },
    { name: 'Sling Ring',        trigger: (s) => (s.tools?.Agent ?? 0) > 3,                  emoji: '🌀', quote: (s) => `${s.tools?.Agent ?? 0} portals opened. The Sling Ring is powerful.` },
  ],
  architect: [ // Darth Vader
    { name: 'Force Choke',       trigger: (s) => s.is_ghost === true,                        emoji: '🤜', quote: 'I find your lack of completion... disturbing.' },
    { name: 'Death Star',        trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '🌑', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)}. That's no moon.` },
    { name: 'Imperial March',    trigger: (s) => s.message_count > 50,                       emoji: '🎵', quote: '50+ messages. The Imperial March plays on.' },
    { name: 'Force Lightning',   trigger: (s) => (s.output_tokens ?? 0) > 200_000,          emoji: '⚡', quote: 'UNLIMITED POWER! 200K output tokens!' },
    { name: 'Lightsaber Duel',   trigger: (s) => Object.keys(s.tools ?? {}).length >= 4,     emoji: '⚔️', quote: 'The lightsaber is an elegant weapon, for a more civilized age.' },
  ],
  guardian: [ // Captain America
    { name: 'Shield Throw',      trigger: (s) => s.is_ghost === false && s.estimated_cost_usd < 0.50, emoji: '🛡️', quote: 'Shield throw! Clean mission, under budget.' },
    { name: 'Avengers Assemble', trigger: (s) => (s.tools?.Agent ?? 0) > 2,                  emoji: '🦸', quote: (s) => `Avengers assembled! ${s.tools?.Agent ?? 0} sub-agents deployed.` },
    { name: 'Vibranium Resolve', trigger: (s) => s.duration_seconds > 1800,                  emoji: '💪', quote: 'I can do this all day. 30+ minutes and counting.' },
    { name: 'Super Soldier',     trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '💉', quote: 'Super Soldier serum working overtime. 500K tokens.' },
    { name: 'Star Spangled',     trigger: (s) => s.message_count > 40 && !s.is_ghost,       emoji: '⭐', quote: '40+ messages, mission complete. Star-spangled success.' },
  ],
  storyteller: [ // Gandalf
    { name: 'You Shall Not Pass', trigger: (s) => s.is_ghost === true,                      emoji: '🧙', quote: 'This session... shall not pass! It fell into shadow.' },
    { name: 'White Wizard',      trigger: (s) => (s.total_tokens ?? 0) > 1_000_000,         emoji: '🤍', quote: 'I am Gandalf the White now. 1M tokens transcended.' },
    { name: 'Shadowfax',         trigger: (s) => s.duration_seconds < 180 && s.message_count > 10, emoji: '🐴', quote: 'Show us the meaning of haste! Swift session.' },
    { name: 'Eagles',            trigger: (s) => (s.tools?.Agent ?? 0) > 4,                  emoji: '🦅', quote: 'The Eagles are coming! Sub-agents to the rescue.' },
    { name: 'Light of Earendil', trigger: (s) => s.estimated_cost_usd > 3,                  emoji: '💫', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)}. May it be a light in dark places.` },
  ],
  ghost: [ // Terminator
    { name: 'Ill Be Back',       trigger: (s) => s.is_ghost === true,                        emoji: '🤖', quote: "I'll be back. Session terminated." },
    { name: 'Hasta La Vista',    trigger: (s) => s.is_ghost === false && s.message_count > 20, emoji: '😎', quote: 'Hasta la vista, baby. Mission accomplished.' },
    { name: 'Skynet Protocol',   trigger: (s) => (s.total_tokens ?? 0) > 500_000,           emoji: '🌐', quote: 'Skynet Protocol activated. 500K tokens consumed.' },
    { name: 'T-1000 Mode',       trigger: (s) => Object.keys(s.tools ?? {}).length >= 5,     emoji: '🔄', quote: (s) => `${Object.keys(s.tools ?? {}).length} tools morphed. T-1000 adaptive mode.` },
    { name: 'Judgment Day',      trigger: (s) => s.estimated_cost_usd > 5,                   emoji: '☠️', quote: (s) => `$${s.estimated_cost_usd.toFixed(2)}. Judgment Day has a price.` },
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
