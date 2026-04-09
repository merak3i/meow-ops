-- Migration: 0001_initial_schema
-- Created: 2026-04-09
-- Target: Supabase (PostgreSQL 15+)
-- Purpose: Core sessions table that mirrors the Session type in src/types/session.ts.
--          Run this when you want to move from Supabase Storage (JSON file)
--          to a proper relational database for querying and filtering.

-- ─── Tracking Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  id         SERIAL PRIMARY KEY,
  filename   TEXT        NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Sessions ─────────────────────────────────────────────────────────────────
-- Mirrors Session interface from src/types/session.ts
CREATE TABLE IF NOT EXISTS sessions (
  session_id               TEXT        PRIMARY KEY,
  project                  TEXT        NOT NULL,
  model                    TEXT        NOT NULL,
  entrypoint               TEXT,
  git_branch               TEXT,
  started_at               TIMESTAMPTZ NOT NULL,
  ended_at                 TIMESTAMPTZ NOT NULL,
  duration_seconds         INTEGER     NOT NULL DEFAULT 0,
  message_count            INTEGER     NOT NULL DEFAULT 0,
  user_message_count       INTEGER     NOT NULL DEFAULT 0,
  assistant_message_count  INTEGER     NOT NULL DEFAULT 0,
  input_tokens             INTEGER     NOT NULL DEFAULT 0,
  output_tokens            INTEGER     NOT NULL DEFAULT 0,
  cache_creation_tokens    INTEGER     NOT NULL DEFAULT 0,
  cache_read_tokens        INTEGER     NOT NULL DEFAULT 0,
  total_tokens             INTEGER     NOT NULL DEFAULT 0,
  estimated_cost_usd       NUMERIC(12,6) NOT NULL DEFAULT 0,
  cat_type                 TEXT        NOT NULL CHECK (cat_type IN ('builder','detective','commander','architect','guardian','storyteller','ghost')),
  is_ghost                 BOOLEAN     NOT NULL DEFAULT false,
  is_subagent              BOOLEAN     NOT NULL DEFAULT false,
  source                   TEXT        NOT NULL CHECK (source IN ('claude','codex')),
  cwd                      TEXT,
  tools                    JSONB                              -- { "Bash": 12, "Read": 5, ... }
);

-- Indexes for common dashboard queries
CREATE INDEX IF NOT EXISTS sessions_project_idx    ON sessions (project);
CREATE INDEX IF NOT EXISTS sessions_model_idx      ON sessions (model);
CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_ended_at_idx   ON sessions (ended_at DESC);
CREATE INDEX IF NOT EXISTS sessions_source_idx     ON sessions (source);
CREATE INDEX IF NOT EXISTS sessions_cat_type_idx   ON sessions (cat_type);

-- ─── Row-Level Security ────────────────────────────────────────────────────────
-- Sessions are private — no anon access.
-- All reads go through service role or authenticated user.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
