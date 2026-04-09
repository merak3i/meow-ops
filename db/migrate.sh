#!/usr/bin/env bash
# db/migrate.sh — Run pending SQL migrations against a PostgreSQL database.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host/db ./db/migrate.sh
#
# Requirements:
#   - psql (PostgreSQL client) installed
#   - DATABASE_URL environment variable set
#     For Supabase: Settings → Database → Connection string (URI format)
#
# Behaviour:
#   1. Creates _migrations table if it doesn't exist
#   2. Reads all .sql files in db/migrations/ in filename order
#   3. Skips files already recorded in _migrations
#   4. Applies new files and records them

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
MIGRATIONS_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"
PSQL="psql --no-psqlrc -v ON_ERROR_STOP=1"

# ─── Validate env ─────────────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "  Export it before running: export DATABASE_URL=postgres://..."
  exit 1
fi

# ─── Bootstrap _migrations table ──────────────────────────────────────────────
echo "→ Ensuring _migrations table exists..."
$PSQL "$DATABASE_URL" <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
  id         SERIAL PRIMARY KEY,
  filename   TEXT        NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# ─── Run pending migrations ───────────────────────────────────────────────────
applied=0

for filepath in "$MIGRATIONS_DIR"/*.sql; do
  filename="$(basename "$filepath")"

  # Check if already applied
  count=$($PSQL "$DATABASE_URL" -tAc \
    "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename'")

  if [[ "$count" -gt 0 ]]; then
    echo "  skip  $filename (already applied)"
    continue
  fi

  echo "  apply $filename ..."
  $PSQL "$DATABASE_URL" -f "$filepath"
  $PSQL "$DATABASE_URL" -c \
    "INSERT INTO _migrations (filename) VALUES ('$filename')"

  echo "  ✓     $filename"
  ((applied++))
done

# ─── Summary ──────────────────────────────────────────────────────────────────
if [[ $applied -eq 0 ]]; then
  echo "→ No new migrations to apply."
else
  echo "→ Applied $applied migration(s)."
fi
