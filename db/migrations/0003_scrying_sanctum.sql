-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0003_scrying_sanctum
-- Created:   2026-04-12
-- Target:    Supabase (PostgreSQL 15+)
-- Purpose:   Scrying Sanctum — real-time multi-tenant agent pipeline visualizer.
--            Creates the four Scrying Sanctum tables (ss_*), backfills tenant_id
--            on existing observability tables, and applies strict RLS everywhere.
--
-- Depends on: 0001_initial_schema, 0002_daily_summaries
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — PREREQUISITES & HELPERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Helper: stamp updated_at automatically (reused from migration 0002).
-- CREATE OR REPLACE is idempotent, so safe to repeat.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Helper: auto-fill tenant_id from the active JWT on INSERT.
-- Enforces that every row is owned by the authenticated caller
-- without requiring the application layer to pass tenant_id explicitly.
CREATE OR REPLACE FUNCTION fill_tenant_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- auth.uid() returns NULL for service-role calls; allow that for migrations/seeding.
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — BACKFILL tenant_id ON EXISTING OBSERVABILITY TABLES
-- ═══════════════════════════════════════════════════════════════════════════════
-- Both tables were created single-tenant with RLS enabled but no policies.
-- We add tenant_id as nullable first, backfill the single known tenant
-- (owner's auth.uid is set at runtime — leave NULL for service-role rows),
-- then add the trigger so future writes self-fill.
--
-- NOTE: We do NOT add NOT NULL here because the existing rows were written
-- via service role (sync script) which has no JWT. The RLS policies below
-- use USING (true) for service-role bypass and tenant_id IS NOT NULL checks
-- only for authenticated reads.

-- ── sessions ──────────────────────────────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS sessions_tenant_idx ON sessions (tenant_id);

DROP TRIGGER IF EXISTS sessions_fill_tenant ON sessions;
CREATE TRIGGER sessions_fill_tenant
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();

-- RLS policy: authenticated users see only their own rows; anon is denied.
DROP POLICY IF EXISTS "sessions_tenant_select" ON sessions;
CREATE POLICY "sessions_tenant_select" ON sessions
  FOR SELECT
  USING (
    -- Service role bypasses RLS entirely (Supabase default).
    -- Authenticated users see their tenant or unowned rows (legacy data).
    auth.role() = 'authenticated'
    AND (tenant_id = auth.uid() OR tenant_id IS NULL)
  );

DROP POLICY IF EXISTS "sessions_tenant_insert" ON sessions;
CREATE POLICY "sessions_tenant_insert" ON sessions
  FOR INSERT
  WITH CHECK (tenant_id = auth.uid() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "sessions_tenant_update" ON sessions;
CREATE POLICY "sessions_tenant_update" ON sessions
  FOR UPDATE
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

-- ── meow_ops_sessions (production alias — apply same treatment) ───────────────
-- The sync script writes to meow_ops_sessions in production.
-- Apply identical treatment if the table exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'meow_ops_sessions') THEN
    EXECUTE $SQL$
      ALTER TABLE meow_ops_sessions
        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

      CREATE INDEX IF NOT EXISTS meow_ops_sessions_tenant_idx ON meow_ops_sessions (tenant_id);

      DROP TRIGGER IF EXISTS meow_ops_sessions_fill_tenant ON meow_ops_sessions;
      CREATE TRIGGER meow_ops_sessions_fill_tenant
        BEFORE INSERT ON meow_ops_sessions
        FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();

      ALTER TABLE meow_ops_sessions ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "meow_ops_sessions_tenant_select" ON meow_ops_sessions;
      CREATE POLICY "meow_ops_sessions_tenant_select" ON meow_ops_sessions
        FOR SELECT
        USING (
          auth.role() = 'authenticated'
          AND (tenant_id = auth.uid() OR tenant_id IS NULL)
        );

      DROP POLICY IF EXISTS "meow_ops_sessions_tenant_insert" ON meow_ops_sessions;
      CREATE POLICY "meow_ops_sessions_tenant_insert" ON meow_ops_sessions
        FOR INSERT
        WITH CHECK (tenant_id = auth.uid() OR auth.role() = 'service_role');
    $SQL$;
  END IF;
END $$;

-- ── daily_summaries ───────────────────────────────────────────────────────────
ALTER TABLE daily_summaries
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS daily_summaries_tenant_idx ON daily_summaries (tenant_id);

DROP TRIGGER IF EXISTS daily_summaries_fill_tenant ON daily_summaries;
CREATE TRIGGER daily_summaries_fill_tenant
  BEFORE INSERT ON daily_summaries
  FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();

DROP POLICY IF EXISTS "daily_summaries_tenant_select" ON daily_summaries;
CREATE POLICY "daily_summaries_tenant_select" ON daily_summaries
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (tenant_id = auth.uid() OR tenant_id IS NULL)
  );

DROP POLICY IF EXISTS "daily_summaries_tenant_insert" ON daily_summaries;
CREATE POLICY "daily_summaries_tenant_insert" ON daily_summaries
  FOR INSERT
  WITH CHECK (tenant_id = auth.uid() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "daily_summaries_tenant_update" ON daily_summaries;
CREATE POLICY "daily_summaries_tenant_update" ON daily_summaries
  FOR UPDATE
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — SCRYING SANCTUM TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── ss_pipelines ─────────────────────────────────────────────────────────────
-- One row per agent pipeline run.
-- Links back to the initiating session so the Sanctum can cross-reference
-- token cost from the sessions table.
CREATE TABLE IF NOT EXISTS ss_pipelines (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  session_id    text,                                    -- optional: originating session_id
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','failed','idle')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ss_pipelines_tenant_idx    ON ss_pipelines (tenant_id);
CREATE INDEX IF NOT EXISTS ss_pipelines_status_idx    ON ss_pipelines (status);
CREATE INDEX IF NOT EXISTS ss_pipelines_created_idx   ON ss_pipelines (created_at DESC);

DROP TRIGGER IF EXISTS ss_pipelines_updated_at ON ss_pipelines;
CREATE TRIGGER ss_pipelines_updated_at
  BEFORE UPDATE ON ss_pipelines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS ss_pipelines_fill_tenant ON ss_pipelines;
CREATE TRIGGER ss_pipelines_fill_tenant
  BEFORE INSERT ON ss_pipelines
  FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();


-- ── ss_nodes ──────────────────────────────────────────────────────────────────
-- Champions — the four canonical pipeline stages.
-- node_type maps to the WotLK champion identities.
-- mana_burn = cumulative token cost (USD, 6dp).
-- stamina   = most-recent latency in ms.
CREATE TABLE IF NOT EXISTS ss_nodes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id   uuid        NOT NULL REFERENCES ss_pipelines(id) ON DELETE CASCADE,

  -- Champion identity
  node_type     text        NOT NULL
                            CHECK (node_type IN (
                              'argent_vanguard',    -- Input / Sentry
                              'ebon_blade_scout',   -- Research Agent
                              'dalaran_archmage',   -- LLM Extraction
                              'argent_herald'       -- Output / Webhook
                            )),
  label         text        NOT NULL,               -- display name

  -- Canvas position (D3 layout coords, persisted for stability across renders)
  position_x    float       NOT NULL DEFAULT 0,
  position_y    float       NOT NULL DEFAULT 0,

  -- Live metrics
  status        text        NOT NULL DEFAULT 'idle'
                            CHECK (status IN ('idle','active','completed','error')),
  mana_burn     numeric(12,6) NOT NULL DEFAULT 0,   -- token cost in USD (blue metric)
  stamina_ms    integer     NOT NULL DEFAULT 0,     -- last latency in ms (green metric)
  token_count   integer     NOT NULL DEFAULT 0,     -- raw token tally

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One champion per type per pipeline
  UNIQUE (pipeline_id, node_type)
);

CREATE INDEX IF NOT EXISTS ss_nodes_tenant_idx    ON ss_nodes (tenant_id);
CREATE INDEX IF NOT EXISTS ss_nodes_pipeline_idx  ON ss_nodes (pipeline_id);
CREATE INDEX IF NOT EXISTS ss_nodes_status_idx    ON ss_nodes (status);

DROP TRIGGER IF EXISTS ss_nodes_updated_at ON ss_nodes;
CREATE TRIGGER ss_nodes_updated_at
  BEFORE UPDATE ON ss_nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS ss_nodes_fill_tenant ON ss_nodes;
CREATE TRIGGER ss_nodes_fill_tenant
  BEFORE INSERT ON ss_nodes
  FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();


-- ── ss_edges ──────────────────────────────────────────────────────────────────
-- Ley Lines — directed connections between champions.
-- Status drives the visual rendering (bright / choked / severed).
CREATE TABLE IF NOT EXISTS ss_edges (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id   uuid        NOT NULL REFERENCES ss_pipelines(id) ON DELETE CASCADE,
  source_id     uuid        NOT NULL REFERENCES ss_nodes(id) ON DELETE CASCADE,
  target_id     uuid        NOT NULL REFERENCES ss_nodes(id) ON DELETE CASCADE,

  -- Ley Line health
  status        text        NOT NULL DEFAULT 'healthy'
                            CHECK (status IN ('healthy','choked','severed')),
  latency_ms    integer     NOT NULL DEFAULT 0,     -- last measured edge latency

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate edges in same pipeline
  UNIQUE (pipeline_id, source_id, target_id)
);

CREATE INDEX IF NOT EXISTS ss_edges_tenant_idx    ON ss_edges (tenant_id);
CREATE INDEX IF NOT EXISTS ss_edges_pipeline_idx  ON ss_edges (pipeline_id);
CREATE INDEX IF NOT EXISTS ss_edges_source_idx    ON ss_edges (source_id);
CREATE INDEX IF NOT EXISTS ss_edges_status_idx    ON ss_edges (status);

DROP TRIGGER IF EXISTS ss_edges_updated_at ON ss_edges;
CREATE TRIGGER ss_edges_updated_at
  BEFORE UPDATE ON ss_edges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS ss_edges_fill_tenant ON ss_edges;
CREATE TRIGGER ss_edges_fill_tenant
  BEFORE INSERT ON ss_edges
  FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();


-- ── ss_runestones ─────────────────────────────────────────────────────────────
-- Data payload packets traversing Ley Lines.
-- Each INSERT triggers a Realtime event → frontend animates a runestone
-- along the corresponding edge's Bezier path.
--
-- payload_type drives the visual:
--   json  → green glowing dot
--   text  → blue glowing dot
--   error → red pulsing dot
CREATE TABLE IF NOT EXISTS ss_runestones (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id   uuid        NOT NULL REFERENCES ss_pipelines(id) ON DELETE CASCADE,
  edge_id       uuid        NOT NULL REFERENCES ss_edges(id) ON DELETE CASCADE,

  -- Runestone type drives color / animation variant
  payload_type  text        NOT NULL DEFAULT 'json'
                            CHECK (payload_type IN ('json','text','error')),
  payload       jsonb,                              -- raw data packet (shown in Loot Box modal)

  -- Performance metadata (shown on hover / in Loot Box)
  tokens_used   integer     NOT NULL DEFAULT 0,
  latency_ms    integer     NOT NULL DEFAULT 0,

  -- Lifecycle: transit → delivered (or transit → failed)
  status        text        NOT NULL DEFAULT 'transit'
                            CHECK (status IN ('transit','delivered','failed')),

  created_at    timestamptz NOT NULL DEFAULT now()
  -- No updated_at — runestones are immutable once created.
);

CREATE INDEX IF NOT EXISTS ss_runestones_tenant_idx    ON ss_runestones (tenant_id);
CREATE INDEX IF NOT EXISTS ss_runestones_pipeline_idx  ON ss_runestones (pipeline_id);
CREATE INDEX IF NOT EXISTS ss_runestones_edge_idx      ON ss_runestones (edge_id);
CREATE INDEX IF NOT EXISTS ss_runestones_status_idx    ON ss_runestones (status);
CREATE INDEX IF NOT EXISTS ss_runestones_created_idx   ON ss_runestones (created_at DESC);

DROP TRIGGER IF EXISTS ss_runestones_fill_tenant ON ss_runestones;
CREATE TRIGGER ss_runestones_fill_tenant
  BEFORE INSERT ON ss_runestones
  FOR EACH ROW EXECUTE FUNCTION fill_tenant_id();


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — ROW LEVEL SECURITY (ALL ss_* TABLES)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Pattern for all four tables is identical:
--   SELECT: authenticated + tenant_id = auth.uid()
--   INSERT: authenticated + tenant_id = auth.uid()  (trigger auto-fills it)
--   UPDATE: authenticated + tenant_id = auth.uid()  (runestones: no UPDATE policy)
--   DELETE: authenticated + tenant_id = auth.uid()
-- Service role bypasses RLS entirely (Supabase default behaviour).

ALTER TABLE ss_pipelines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_nodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_edges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_runestones ENABLE ROW LEVEL SECURITY;

-- ── ss_pipelines RLS ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ss_pipelines_select" ON ss_pipelines;
CREATE POLICY "ss_pipelines_select" ON ss_pipelines
  FOR SELECT USING (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_pipelines_insert" ON ss_pipelines;
CREATE POLICY "ss_pipelines_insert" ON ss_pipelines
  FOR INSERT WITH CHECK (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_pipelines_update" ON ss_pipelines;
CREATE POLICY "ss_pipelines_update" ON ss_pipelines
  FOR UPDATE USING (auth.uid() = tenant_id) WITH CHECK (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_pipelines_delete" ON ss_pipelines;
CREATE POLICY "ss_pipelines_delete" ON ss_pipelines
  FOR DELETE USING (auth.uid() = tenant_id);

-- ── ss_nodes RLS ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ss_nodes_select" ON ss_nodes;
CREATE POLICY "ss_nodes_select" ON ss_nodes
  FOR SELECT USING (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_nodes_insert" ON ss_nodes;
CREATE POLICY "ss_nodes_insert" ON ss_nodes
  FOR INSERT WITH CHECK (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_nodes_update" ON ss_nodes;
CREATE POLICY "ss_nodes_update" ON ss_nodes
  FOR UPDATE USING (auth.uid() = tenant_id) WITH CHECK (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_nodes_delete" ON ss_nodes;
CREATE POLICY "ss_nodes_delete" ON ss_nodes
  FOR DELETE USING (auth.uid() = tenant_id);

-- ── ss_edges RLS ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ss_edges_select" ON ss_edges;
CREATE POLICY "ss_edges_select" ON ss_edges
  FOR SELECT USING (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_edges_insert" ON ss_edges;
CREATE POLICY "ss_edges_insert" ON ss_edges
  FOR INSERT WITH CHECK (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_edges_update" ON ss_edges;
CREATE POLICY "ss_edges_update" ON ss_edges
  FOR UPDATE USING (auth.uid() = tenant_id) WITH CHECK (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_edges_delete" ON ss_edges;
CREATE POLICY "ss_edges_delete" ON ss_edges
  FOR DELETE USING (auth.uid() = tenant_id);

-- ── ss_runestones RLS ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ss_runestones_select" ON ss_runestones;
CREATE POLICY "ss_runestones_select" ON ss_runestones
  FOR SELECT USING (auth.uid() = tenant_id);

DROP POLICY IF EXISTS "ss_runestones_insert" ON ss_runestones;
CREATE POLICY "ss_runestones_insert" ON ss_runestones
  FOR INSERT WITH CHECK (auth.uid() = tenant_id);

-- No UPDATE policy on runestones — they are immutable once created.
-- Status transitions (transit→delivered) are done via service role only.

DROP POLICY IF EXISTS "ss_runestones_delete" ON ss_runestones;
CREATE POLICY "ss_runestones_delete" ON ss_runestones
  FOR DELETE USING (auth.uid() = tenant_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — SUPABASE REALTIME PUBLICATION
-- ═══════════════════════════════════════════════════════════════════════════════
-- Enable Realtime on tables that drive live UI updates.
-- ss_runestones INSERT → triggers Runestone path animation in the Sanctum.
-- ss_nodes UPDATE     → live Mana Burn / Stamina readout refresh.
-- ss_edges UPDATE     → Ley Line health state transitions (healthy/choked/severed).

ALTER PUBLICATION supabase_realtime ADD TABLE ss_runestones;
ALTER PUBLICATION supabase_realtime ADD TABLE ss_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE ss_edges;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — SEED: DEFAULT PIPELINE TOPOLOGY
-- ═══════════════════════════════════════════════════════════════════════════════
-- Creates the canonical four-champion linear pipeline topology.
-- tenant_id is NULL here; the app layer sets it on first authenticated load
-- or the sync script runs with service role (which bypasses RLS).
-- This seed is idempotent via the ON CONFLICT DO NOTHING clause.

-- NOTE: This only seeds if no pipelines exist yet. Safe for first-run.
DO $$ DECLARE
  p_id uuid;
  n_vanguard  uuid;
  n_scout     uuid;
  n_archmage  uuid;
  n_herald    uuid;
BEGIN
  -- Only seed if table is completely empty
  IF (SELECT COUNT(*) FROM ss_pipelines) = 0 THEN

    INSERT INTO ss_pipelines (id, tenant_id, name, status)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000'::uuid, 'Primary Sanctum', 'idle')
    RETURNING id INTO p_id;

    -- Champions at evenly-spaced x positions, y=0 for horizontal layout
    INSERT INTO ss_nodes (id, tenant_id, pipeline_id, node_type, label, position_x, position_y)
    VALUES
      (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', p_id, 'argent_vanguard',  'Argent Vanguard',  100, 250),
      (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', p_id, 'ebon_blade_scout', 'Ebon Blade Scout', 380, 250),
      (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', p_id, 'dalaran_archmage', 'Dalaran Archmage', 660, 250),
      (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', p_id, 'argent_herald',    'Argent Herald',    940, 250)
    RETURNING id INTO n_vanguard;

    -- Re-fetch node IDs by type (since RETURNING only gives last row)
    SELECT id INTO n_vanguard  FROM ss_nodes WHERE pipeline_id = p_id AND node_type = 'argent_vanguard';
    SELECT id INTO n_scout     FROM ss_nodes WHERE pipeline_id = p_id AND node_type = 'ebon_blade_scout';
    SELECT id INTO n_archmage  FROM ss_nodes WHERE pipeline_id = p_id AND node_type = 'dalaran_archmage';
    SELECT id INTO n_herald    FROM ss_nodes WHERE pipeline_id = p_id AND node_type = 'argent_herald';

    -- Ley Lines: linear chain  Vanguard → Scout → Archmage → Herald
    INSERT INTO ss_edges (tenant_id, pipeline_id, source_id, target_id)
    VALUES
      ('00000000-0000-0000-0000-000000000000', p_id, n_vanguard, n_scout),
      ('00000000-0000-0000-0000-000000000000', p_id, n_scout,    n_archmage),
      ('00000000-0000-0000-0000-000000000000', p_id, n_archmage, n_herald);

  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — MIGRATION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO _migrations (filename) VALUES ('0003_scrying_sanctum.sql')
  ON CONFLICT (filename) DO NOTHING;
