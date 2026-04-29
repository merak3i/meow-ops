// Pure helpers for the Scrying Sanctum.
//
// Anything in here is side-effect free and depends only on session/agent
// data + the metadata in classes.ts. Lifted out of the monolithic
// ScryingSanctum.tsx so the layout/format/identity logic is unit-testable
// and reusable from any sub-module without dragging the 5000-line file
// in via TypeScript.

import type { Session } from '@/types/session';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';
import { toISTDate } from '@/lib/format';
import {
  CLASS_MAP, FALLBACK_CLASS, SESSION_ACCENTS,
  getChampionName, getPipelineRole,
} from './classes';
import type { EternalStats, PositionedNode, SessionIdentifier } from './types';

// ─── Session hash + identifier ───────────────────────────────────────────────

/** djb2-ish 32-bit hash, stable per session_id, never negative. */
export function sessionHash(sid: string): number {
  let h = 0;
  for (let i = 0; i < sid.length; i++) {
    h = ((h << 5) - h) + sid.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Strip common branch prefixes (feat/, fix/, …) and clamp length so the tag
 *  stays compact in 3D space. Empty branch → fall back to "#hashShort". */
export function sessionIdentifier(s: Session): SessionIdentifier {
  const h = sessionHash(s.session_id);
  const hashShort = h.toString(16).slice(0, 4).toUpperCase().padStart(4, '0');
  const branchRaw = (s.git_branch ?? '').trim();
  const branch = branchRaw
    .replace(/^(feat|fix|chore|docs|refactor|test|perf|build|ci)\//, '')
    .slice(0, 22);
  const tag       = branch || `#${hashShort}`;
  const accentIdx = h % SESSION_ACCENTS.length;
  const accent    = SESSION_ACCENTS[accentIdx]!;
  return { tag, hashShort, accent, accentIdx };
}

// ─── Eternal stats (Lich King's domain) ──────────────────────────────────────

export function deriveEternal(sessions: ReadonlyArray<Session>): EternalStats {
  let totalSpend = 0;
  let totalTokens = 0;
  let ghostCount = 0;
  for (const s of sessions) {
    totalSpend  += s.estimated_cost_usd ?? 0;
    totalTokens += s.total_tokens       ?? 0;
    if (s.is_ghost) ghostCount++;
  }
  return { totalSpend, totalTokens, totalSessions: sessions.length, ghostCount };
}

// ─── Color blending ──────────────────────────────────────────────────────────

/** Blend two hex colors in linear RGB. amt=0 → a, amt=1 → b. */
export function blendHex(a: string, b: string, amt: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * amt);
  const g = Math.round(ag + (bg - ag) * amt);
  const bl = Math.round(ab + (bb - ab) * amt);
  return '#' + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0');
}

// ─── HP / cost / time formatters ─────────────────────────────────────────────

export function hpPercent(costUsd: number, maxCost: number): number {
  const ratio = maxCost > 0 ? costUsd / maxCost : 0;
  return Math.max(12, Math.round(100 - ratio * 60));
}

export function formatGold(usd: number): string {
  if (usd < 0.001) return `${(usd * 10000).toFixed(1)}c`;
  return `${usd.toFixed(4)}g`;
}

// Compact gold formatter for the dropdown — keeps the WoW theme but uses
// fewer decimals so labels stay scannable. 149.4901g → 149.5g, 0.345g stays
// readable, sub-cent values still render in copper (`c`).
export function formatGoldShort(usd: number): string {
  if (usd < 0.001) return `${(usd * 10000).toFixed(1)}c`;
  if (usd < 1)    return `${usd.toFixed(3)}g`;
  if (usd < 10)   return `${usd.toFixed(2)}g`;
  return `${usd.toFixed(1)}g`;
}

// Day-prefix for a run group's start time, in IST. Returns "today",
// "yesterday", or a weekday+date like "Mon Apr 22" for older groups. Used
// by both the option label and the optgroup header.
export function dayPrefixLabel(startedAtIso: string, nowIso: string): string {
  const groupDate = toISTDate(startedAtIso);
  const today     = toISTDate(nowIso);
  const yesterday = toISTDate(new Date(new Date(nowIso).getTime() - 86_400_000).toISOString());
  if (groupDate === today)     return 'today';
  if (groupDate === yesterday) return 'yesterday';
  return new Date(startedAtIso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', month: 'short', day: 'numeric',
  });
}

// Run-group dropdown label format —
//   patherle · today 14:32 · "fix billing webhook…" · 149.5g · 4 roots
//
// Each segment separated by middle-dot. First-message snippet is included
// only when the root session carries one (older sessions parsed before the
// snippet capture landed will skip the quoted segment cleanly).
export function formatRunGroupLabel(g: SessionRunGroup, nowIso: string): string {
  const dayPrefix = dayPrefixLabel(g.startedAt, nowIso);
  const time = new Date(g.startedAt).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const firstMsg  = g.roots[0]?.session?.first_user_message;
  const cost      = formatGoldShort(g.totalCost);
  const rootCount = `${g.roots.length} root${g.roots.length !== 1 ? 's' : ''}`;
  const parts: string[] = [g.project, `${dayPrefix} ${time}`];
  if (firstMsg) parts.push(`"${firstMsg}"`);
  parts.push(cost, rootCount);
  return parts.join(' · ');
}

export function formatDur(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Layout (initial positions only) ─────────────────────────────────────────

export function layoutNodes(roots: AgentTreeNode[]): PositionedNode[] {
  const byDepth: Array<Array<{ node: AgentTreeNode; depth: number }>> = [];

  function collect(node: AgentTreeNode, depth: number) {
    if (!byDepth[depth]) byDepth[depth] = [];
    byDepth[depth].push({ node, depth });
    node.children.forEach((c) => collect(c, depth + 1));
  }
  roots.forEach((r) => collect(r, 0));

  const allPositioned: PositionedNode[] = [];
  let globalIdx = 0;
  const total = byDepth.reduce((acc, arr) => acc + arr.length, 0);

  byDepth.forEach((row, depth) => {
    const count = row.length;
    row.forEach(({ node }, i) => {
      // Distribute across waypoint area — clamp to plaza bounds
      const x = Math.max(-5, Math.min(5, (i - (count - 1) / 2) * 3.5));
      const z = Math.max(-5, Math.min(5, (depth - 1) * 3));
      const cat = node.session.cat_type ?? 'ghost';
      allPositioned.push({
        session: node.session,
        depth,
        idx:     globalIdx,
        total,
        pos:     [x, 0, z],
        cls:     CLASS_MAP[cat] ?? FALLBACK_CLASS,
        name:    getChampionName(node.session, globalIdx),
        role:    getPipelineRole(globalIdx, total),
      });
      globalIdx++;
    });
  });

  return allPositioned;
}

// ─── Waypoints (champion wandering targets) ──────────────────────────────────

export const WAYPOINTS: [number, number][] = [
  [-5.5, -5.5], [0, -5.5], [5.5, -5.5],
  [-5.5,  0  ],            [5.5,  0  ],
  [-5.5,  5.5], [0,  5.5], [5.5,  5.5],
  [-2.5, -2.5], [2.5, -2.5],
  [-2.5,  2.5], [2.5,  2.5],
];
