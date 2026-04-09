-- Migration: 0002_daily_summaries
-- Created: 2026-04-09
-- Target: Supabase (PostgreSQL 15+)
-- Purpose: Pre-aggregated daily statistics table. Mirrors DailySummaryRow
--          in src/types/session.ts. Powers the burn-rate forecasting and
--          cost tracker without re-scanning all sessions on every load.
--
-- Depends on: 0001_initial_schema (for _migrations table)

CREATE TABLE IF NOT EXISTS daily_summaries (
  date                  DATE        PRIMARY KEY,   -- YYYY-MM-DD in IST
  session_count         INTEGER     NOT NULL DEFAULT 0,
  total_input_tokens    INTEGER     NOT NULL DEFAULT 0,
  total_output_tokens   INTEGER     NOT NULL DEFAULT 0,
  total_cache_creation  INTEGER     NOT NULL DEFAULT 0,
  total_cache_read      INTEGER     NOT NULL DEFAULT 0,
  total_tokens          INTEGER     NOT NULL DEFAULT 0,
  estimated_cost_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
  active_projects       INTEGER     NOT NULL DEFAULT 0,
  ghost_count           INTEGER     NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-range queries (forecasting window)
CREATE INDEX IF NOT EXISTS daily_summaries_date_idx ON daily_summaries (date DESC);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER daily_summaries_updated_at
  BEFORE UPDATE ON daily_summaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Materialised daily summary — refresh via cron or after each sync
-- This view aggregates on-the-fly from sessions table as an alternative.
CREATE OR REPLACE VIEW daily_summaries_live AS
SELECT
  DATE(ended_at AT TIME ZONE 'Asia/Kolkata') AS date,
  COUNT(*)                                   AS session_count,
  SUM(input_tokens)                          AS total_input_tokens,
  SUM(output_tokens)                         AS total_output_tokens,
  SUM(cache_creation_tokens)                 AS total_cache_creation,
  SUM(cache_read_tokens)                     AS total_cache_read,
  SUM(total_tokens)                          AS total_tokens,
  SUM(estimated_cost_usd)                    AS estimated_cost_usd,
  COUNT(DISTINCT project)                    AS active_projects,
  COUNT(*) FILTER (WHERE is_ghost)           AS ghost_count
FROM sessions
GROUP BY DATE(ended_at AT TIME ZONE 'Asia/Kolkata')
ORDER BY date DESC;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
-- All reads/writes via service role only
