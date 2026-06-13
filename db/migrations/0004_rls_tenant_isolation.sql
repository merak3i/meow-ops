-- 0004_rls_tenant_isolation.sql
--
-- Fix a cross-tenant read leak in the legacy observability tables.
--
-- 0003 granted SELECT to ANY authenticated user for rows where
-- `tenant_id IS NULL` — and every row written by the service-role sync script
-- has a NULL tenant_id (auth.uid() is NULL for service-role). In a single
-- operator deployment that is harmless, but in a multi-tenant deployment it
-- means every signed-in user can read every other tenant's session metadata
-- and first-message snippets.
--
-- This migration removes the `OR tenant_id IS NULL` escape hatch so the SELECT
-- policies enforce strict per-tenant isolation. The service-role key still
-- bypasses RLS entirely for sync writes, so the exporter is unaffected.
--
-- NOTE: pre-existing rows with tenant_id IS NULL become visible only to the
-- service role after this runs. Backfill them with a real tenant id if they
-- should belong to a specific user:
--   UPDATE sessions SET tenant_id = '<uuid>' WHERE tenant_id IS NULL;

-- sessions
DROP POLICY IF EXISTS "sessions_tenant_select" ON sessions;
CREATE POLICY "sessions_tenant_select" ON sessions
  FOR SELECT
  USING (auth.role() = 'authenticated' AND tenant_id = auth.uid());

-- daily_summaries
DROP POLICY IF EXISTS "daily_summaries_tenant_select" ON daily_summaries;
CREATE POLICY "daily_summaries_tenant_select" ON daily_summaries
  FOR SELECT
  USING (auth.role() = 'authenticated' AND tenant_id = auth.uid());

-- meow_ops_sessions (created conditionally in 0003 — guard its existence)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'meow_ops_sessions'
  ) THEN
    DROP POLICY IF EXISTS "meow_ops_sessions_tenant_select" ON meow_ops_sessions;
    CREATE POLICY "meow_ops_sessions_tenant_select" ON meow_ops_sessions
      FOR SELECT
      USING (auth.role() = 'authenticated' AND tenant_id = auth.uid());
  END IF;
END $$;
