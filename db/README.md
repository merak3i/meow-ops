# Database Migrations

This directory contains forward-looking database infrastructure for when
meow-ops moves from file-based session storage to a proper relational database.

Current data pipeline: **local JSONL → sessions.json → Supabase Storage**.
Target (when scale requires it): **Supabase PostgreSQL (15+)**.

Run these migrations only when switching to database-backed session storage.

---

## Structure

```
db/
├── README.md              ← this file
├── migrate.sh             ← migration runner
└── migrations/
    ├── 0001_initial_schema.sql    ← sessions table (mirrors Session type)
    └── 0002_daily_summaries.sql   ← pre-aggregated daily stats + live view
```

---

## Running Migrations

### Prerequisites
- `psql` installed (`brew install libpq` on macOS, or `apt install postgresql-client`)
- A Supabase project created at [supabase.com](https://supabase.com)
- The connection string from: Supabase Dashboard → Settings → Database → URI

### Steps

```bash
# 1. Export the connection string
export DATABASE_URL="postgres://postgres:[password]@[host]:5432/postgres"

# 2. Make the runner executable
chmod +x db/migrate.sh

# 3. Run
./db/migrate.sh
```

The runner is **idempotent** — re-running it skips already-applied migrations.

---

## Schema Design Notes

### Why a sessions table instead of file storage?
- Enables server-side filtering, aggregation, and indexing
- Supports multi-device access without manual sync
- Powers the `daily_summaries_live` view for burn-rate forecasting

### Relationship to `src/types/session.ts`
`0001_initial_schema.sql` is the authoritative DB mirror of the `Session` interface.
If `Session` type changes, update the table definition and add a new migration.

### The `daily_summaries_live` view
Use this for dashboards — no need to pre-aggregate on write. Switch to the
`daily_summaries` table (materialised) if query performance becomes an issue.

---

## Migration Naming Convention

```
NNNN_snake_case_description.sql
```

- `NNNN` — zero-padded sequence number (0001, 0002, …)
- Files are applied **in filename order**

---

## Current Migration Status

| File | Purpose | Status |
|------|---------|--------|
| `0001_initial_schema.sql` | `sessions` table | Not yet applied |
| `0002_daily_summaries.sql` | `daily_summaries` table + live view | Not yet applied |

Apply `0001` first — `0002` depends on the `_migrations` table it creates.

---

## Environment Variables (when DB is live)

Add these to `.env.local` (never commit):

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...    # sync scripts only — never expose to browser
DATABASE_URL=postgres://postgres:...@db.xxxx.supabase.co:5432/postgres
```
