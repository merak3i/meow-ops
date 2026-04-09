import type { Session, DeveloperProfile, GrowthStage, MorphWeights, CatType } from '@/types/session';

// ─── Constants ────────────────────────────────────────────────────────────────

/** XP milestones in millions of tokens */
const XP_THRESHOLDS: Record<GrowthStage, number> = {
  kitten:   0,
  juvenile: 5,
  adult:    20,
  elder:    60,
};

/** Tool categories that drive morph weights */
const BASH_TOOLS  = new Set(['Bash', 'Shell', 'Computer']);
const READ_TOOLS  = new Set(['Read', 'Grep', 'Glob', 'LS']);
const AGENT_TOOLS = new Set(['Agent', 'EnterPlanMode', 'Task']);

/** 4-hour fatigue window in milliseconds */
const FATIGUE_WINDOW_MS = 4 * 60 * 60 * 1000;

// ─── Profile builder ──────────────────────────────────────────────────────────

export function buildDeveloperProfile(sessions: Session[]): DeveloperProfile {
  if (sessions.length === 0) return emptyProfile();

  const total_tokens    = sessions.reduce((a, s) => a + s.total_tokens, 0);
  const total_cost_usd  = sessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  const total_sessions  = sessions.length;

  const successSessions = sessions.filter((s) => !s.is_ghost && s.message_count >= 5);
  const session_success_rate = total_sessions > 0 ? successSessions.length / total_sessions : 0;

  // Token rate averages (only sessions with meaningful duration)
  const timed = sessions.filter((s) => s.duration_seconds >= 10);
  const avg_tokens_per_minute = timed.length > 0
    ? timed.reduce((a, s) => a + s.total_tokens / (s.duration_seconds / 60), 0) / timed.length
    : 0;

  const avg_session_duration_min = timed.length > 0
    ? timed.reduce((a, s) => a + s.duration_seconds / 60, 0) / timed.length
    : 0;

  // Dominant cat type (mode of cat_type across sessions)
  const catCounts = new Map<CatType, number>();
  for (const s of sessions) {
    catCounts.set(s.cat_type, (catCounts.get(s.cat_type) ?? 0) + 1);
  }
  const dominant_cat_type = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'builder';

  // Tool affinity — aggregate across all sessions
  const tool_affinity: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.tools) continue;
    for (const [tool, count] of Object.entries(s.tools)) {
      tool_affinity[tool] = (tool_affinity[tool] ?? 0) + count;
    }
  }

  // Active streak — consecutive calendar days with ≥ 1 session (IST dates)
  const activeDates = new Set(
    sessions.map((s) =>
      new Date(s.started_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    ),
  );
  const active_streak_days = computeStreak(activeDates);

  // Last active
  const sorted = [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const last_active_at = sorted[0] ? new Date(sorted[0].started_at) : null;

  // XP = total_tokens / 1_000_000 (uncapped — progression is in growth stage)
  const xp = total_tokens / 1_000_000;

  const growth_stage = xpToGrowthStage(xp);
  const morph_weights = computeMorphWeights(sessions, tool_affinity, xp);

  return {
    total_tokens,
    total_cost_usd,
    total_sessions,
    session_success_rate,
    avg_tokens_per_minute,
    avg_session_duration_min,
    dominant_cat_type,
    tool_affinity,
    active_streak_days,
    last_active_at,
    xp,
    growth_stage,
    morph_weights,
  };
}

// ─── Growth stage ─────────────────────────────────────────────────────────────

function xpToGrowthStage(xp: number): GrowthStage {
  if (xp >= XP_THRESHOLDS.elder)    return 'elder';
  if (xp >= XP_THRESHOLDS.adult)    return 'adult';
  if (xp >= XP_THRESHOLDS.juvenile) return 'juvenile';
  return 'kitten';
}

// ─── Morph weights ────────────────────────────────────────────────────────────

function computeMorphWeights(
  sessions: Session[],
  tool_affinity: Record<string, number>,
  xp: number,
): MorphWeights {
  const totalToolCalls = Object.values(tool_affinity).reduce((a, v) => a + v, 0);

  const bashCalls  = sumTools(tool_affinity, BASH_TOOLS);
  const readCalls  = sumTools(tool_affinity, READ_TOOLS);
  const agentCalls = sumTools(tool_affinity, AGENT_TOOLS);

  const robustness   = totalToolCalls > 0 ? Math.min(1, bashCalls  / totalToolCalls * 3) : 0;
  const agility      = totalToolCalls > 0 ? Math.min(1, readCalls  / totalToolCalls * 3) : 0;
  const intelligence = totalToolCalls > 0 ? Math.min(1, agentCalls / totalToolCalls * 3) : 0;

  // Size: logarithmic XP scale — 0 at kitten, 1 at elder (60M+ tokens)
  const size = Math.min(1, Math.log1p(xp) / Math.log1p(60));

  // Fatigue: recent 4-hour window token load vs. typical
  const fatigue = computeFatigue(sessions);

  return { robustness, agility, intelligence, size, fatigue };
}

function sumTools(affinity: Record<string, number>, toolSet: Set<string>): number {
  let total = 0;
  for (const [tool, count] of Object.entries(affinity)) {
    if (toolSet.has(tool)) total += count;
  }
  return total;
}

function computeFatigue(sessions: Session[]): number {
  const now = Date.now();
  const recentSessions = sessions.filter(
    (s) => now - new Date(s.started_at).getTime() < FATIGUE_WINDOW_MS,
  );

  if (recentSessions.length === 0) return 0;

  const recentTokens = recentSessions.reduce((a, s) => a + s.total_tokens, 0);

  // Normalise: 200K tokens in 4h = full fatigue
  return Math.min(1, recentTokens / 200_000);
}

// ─── Streak computation ───────────────────────────────────────────────────────

function computeStreak(activeDates: Set<string>): number {
  if (activeDates.size === 0) return 0;

  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  let streak = 0;
  let cursor = new Date(todayIST + 'T00:00:00');

  while (true) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!activeDates.has(dateStr)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

// ─── Empty profile ────────────────────────────────────────────────────────────

function emptyProfile(): DeveloperProfile {
  return {
    total_tokens:             0,
    total_cost_usd:           0,
    total_sessions:           0,
    session_success_rate:     0,
    avg_tokens_per_minute:    0,
    avg_session_duration_min: 0,
    dominant_cat_type:        'builder',
    tool_affinity:            {},
    active_streak_days:       0,
    last_active_at:           null,
    xp:                       0,
    growth_stage:             'kitten',
    morph_weights: {
      robustness:   0,
      agility:      0,
      intelligence: 0,
      size:         0,
      fatigue:      0,
    },
  };
}
