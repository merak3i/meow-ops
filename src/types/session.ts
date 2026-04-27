// ─── Core session types ────────────────────────────────────────────────────────
// Single source of truth for session shape across analytics, state machine,
// and companion rendering systems.

export interface Session {
  session_id:               string;
  project:                  string;
  model:                    string;
  entrypoint:               string | null;
  git_branch:               string | null;
  started_at:               string;    // ISO-8601
  ended_at:                 string;    // ISO-8601
  duration_seconds:         number;
  message_count:            number;
  user_message_count:       number;
  assistant_message_count:  number;
  input_tokens:             number;
  output_tokens:            number;
  cache_creation_tokens:    number;
  cache_read_tokens:        number;
  total_tokens:             number;
  estimated_cost_usd:       number;
  cat_type:                 CatType;
  is_ghost:                 boolean;
  is_subagent?:             boolean;
  source:                   'claude' | 'codex';
  cwd?:                     string;
  tools?:                   Record<string, number>;
  // First user-typed message in the session (auto-injected blocks stripped),
  // truncated to ~80 chars. Used as a human-memorable label in the run-group
  // dropdown. Null on sessions parsed before this field was added — re-sync
  // with `node sync/export-local.mjs` to populate.
  first_user_message?:      string | null;
  // Agent hierarchy (populated by parse-session.mjs when parentUuid is present)
  parent_session_id?:       string | null;
  agent_id?:                string | null;
  agent_slug?:              string | null;
  is_sidechain?:            boolean;
  agent_depth?:             number;   // 0 = main session, 1+ = subagent
}

export type CatType =
  | 'builder'
  | 'detective'
  | 'commander'
  | 'architect'
  | 'guardian'
  | 'storyteller'
  | 'ghost';

// ─── Analytics types ──────────────────────────────────────────────────────────

/** Per-session velocity metrics */
export interface VelocityMetrics {
  session_id:           string;
  tokens_per_minute:    number;  // total_tokens / (duration_seconds / 60)
  output_per_minute:    number;  // output_tokens / (duration_seconds / 60)
  cost_per_hour:        number;  // estimated_cost_usd / (duration_seconds / 3600)
  success:              boolean; // !is_ghost && message_count >= 5
  started_at:           string;
  project:              string;
  model:                string;
}

/** Session efficiency index — correlates output to time, anomaly-flagged */
export interface EfficiencyRecord {
  session_id:   string;
  sei:          number;  // output_tokens / duration_minutes
  z_score:      number;  // (sei - mean) / std
  is_anomaly:   boolean; // |z_score| > Z_THRESHOLD (2.5)
  project:      string;
  started_at:   string;
  duration_min: number;
}

/** Burn rate forecast result */
export interface BurnRateForecast {
  daily_history:       DailySpend[];
  slope_usd_per_day:   number;   // OLS slope
  intercept:           number;   // OLS intercept
  r_squared:           number;   // goodness of fit
  forecast_30d:        number;   // projected spend in next 30 days
  moving_avg_30d:      number;   // rolling 30-day average daily spend
  forecast_days:       ForecastPoint[]; // day-by-day projection
  confidence_band:     { upper: number; lower: number }; // 1-sigma band
}

export interface DailySpend {
  date:              string;  // YYYY-MM-DD
  cost:              number;
  tokens:            number;
  session_count:     number;
}

export interface ForecastPoint {
  day:     number;   // +1 to +30 from today
  date:    string;
  cost:    number;   // predicted
  upper:   number;   // confidence band
  lower:   number;
}

// ─── Companion types ──────────────────────────────────────────────────────────

export interface DeveloperProfile {
  total_tokens:             number;
  total_cost_usd:           number;
  total_sessions:           number;
  session_success_rate:     number;   // 0–1
  avg_tokens_per_minute:    number;
  avg_session_duration_min: number;
  dominant_cat_type:        CatType;
  tool_affinity:            Record<string, number>;  // tool → total calls
  active_streak_days:       number;
  last_active_at:           Date | null;
  xp:                       number;   // total_tokens / 1_000_000 capped progression
  growth_stage:             GrowthStage;
  morph_weights:            MorphWeights;
}

export type GrowthStage = 'kitten' | 'juvenile' | 'adult' | 'elder';

/** Drives procedural mesh deformation — all values 0–1 */
export interface MorphWeights {
  robustness:   number;  // heavy Bash → more muscular frame
  agility:      number;  // heavy Read/Grep → longer, leaner silhouette
  intelligence: number;  // heavy Agent/EnterPlanMode → larger head
  size:         number;  // driven by total_tokens (XP)
  fatigue:      number;  // 4h window overload → drooping posture
}

// ─── Cost summary (from cost-summary.json) ───────────────────────────────────

export interface TimeBucket {
  cost:     number;
  tokens:   number;
  sessions: number;
}

export interface DailySummaryRow {
  date:                 string;
  session_count:        number;
  total_input_tokens:   number;
  total_output_tokens:  number;
  total_cache_creation: number;
  total_cache_read:     number;
  total_tokens:         number;
  estimated_cost_usd:   number;
  active_projects:      number;
  ghost_count:          number;
}

export interface CostSummary {
  exportedAt:    string;
  today:         TimeBucket;
  thisWeek:      TimeBucket;
  lastWeek:      TimeBucket;
  thisMonth:     TimeBucket;
  lastMonth:     TimeBucket;
  thisYear:      TimeBucket;
  lastYear?:     TimeBucket;
  allTime?:      TimeBucket;
  bySource?:     Record<string, TimeBucket>;
  daily_summary: DailySummaryRow[];
}
