-- 0005_migrations_table_rls.sql
--
-- SHIP-GATE check 5 follow-up: `_migrations` was the only public table without row level
-- security. On Supabase the Data API roles (anon, authenticated) hold default grants on
-- public tables, so without RLS the migration ledger was readable and writable with the
-- anon key that ships in the SPA bundle. Enabling RLS with no policies makes it reachable
-- only by the service role and the table owner. db/migrate.sh connects as the owner, so
-- the runner's own bookkeeping is unaffected.
--
-- Rollback: ALTER TABLE _migrations DISABLE ROW LEVEL SECURITY;

ALTER TABLE _migrations ENABLE ROW LEVEL SECURITY;
