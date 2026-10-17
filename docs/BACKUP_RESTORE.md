# Backup and restore runbook

Covers the Supabase Postgres behind Meow Ops (`sessions`, `daily_summaries`, `meow_ops_sessions`, `ss_*`). Local intake, ledgers and companion state already live outside the worktree under `~/.meow-ops` and are covered by your machine backup, not by this runbook.

## What the platform gives you

The Supabase organization is on the **Free plan: no daily backups, no point-in-time recovery**. Until that changes, the nightly dump below is the only copy of the database.

| Plan | Managed backups | How to enable |
|---|---|---|
| Free (current) | None | n/a |
| Pro ($25/month per organization) | Daily backups, 7-day retention | Supabase dashboard → Organization → Billing → Upgrade to Pro |
| Pro + PITR add-on ($100/month per 7 days retention, per project) | Point-in-time recovery | Dashboard → Project → Settings → Add-ons → Point in Time Recovery |

Prices as published on supabase.com/pricing, 2026-10. Re-check before deciding.

## Targets

- **RPO** (how much you can lose): 24 hours with the nightly dump alone; 24 hours on Pro daily backups; minutes with PITR.
- **RTO** (how long a restore takes): the drill measures it; default ceiling 600 seconds (`MEOW_DRILL_MAX_SECONDS`).

## Nightly backup

`npm run backup:db` runs `sync/db-backup.mjs`:

1. `pg_dump --format=plain --clean --if-exists --schema public DATABASE_URL`, streamed through gzip to `~/.meow-ops/intake/backups/db/db-<utc>.sql.gz` (mode 0600, directory 0700; override with `MEOW_DB_BACKUP_DIR`).
2. Verifies the dump (pg_dump header, completion marker, at least one `CREATE TABLE`), records size, sha256 and key-table row counts into `latest.json` and `<file>.json`.
3. Prunes to the newest `MEOW_DB_BACKUP_KEEP` (14).
4. On failure: structured `backup.failed` log line and a Telegram alert when `MEOW_TELEGRAM_*` is set.

`npm run agents:install` installs `com.meowops.db-backup`, a launchd agent running it every 24 hours. Its stdout/stderr land in `~/Library/Logs/meow-ops/com.meowops.db-backup{,.error}.log`; `npm run health` flags it like any other agent.

Requirements: `DATABASE_URL` in `~/.config/meow-ops/local.env` (same variable `db/migrate.sh` uses), and `pg_dump` + `psql` on the agent PATH (`/opt/homebrew/bin` via Postgres.app or `brew install libpq && brew link --force libpq`).

### Off-machine copy

A backup on the same laptop as the operator is one spilled coffee from being no backup. Pick one and do it:

- Put `MEOW_DB_BACKUP_DIR` on a synced, encrypted location (iCloud Drive or Google Drive folder with FileVault on), or
- `rclone copy ~/.meow-ops/intake/backups/db remote:meow-ops-db --max-age 48h` from the same launchd agent (append to the agent args once rclone is configured), or
- A second machine pulling with `rsync` nightly.

The dump contains session metadata and summaries. Treat the copy like the database.

## Restore drill (quarterly, 15 minutes)

1. Start a disposable target: `supabase start` in any checkout gives `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Never point the drill at production; the script refuses `DATABASE_URL` and refuses hosted hosts without `MEOW_DRILL_ALLOW_HOSTED=true`.
2. `MEOW_DRILL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run restore:drill:db`
3. Read the verdict line. PASS means: restore completed under the RTO ceiling and every key table's row count matches the count recorded at backup time. The report is written to `~/.meow-ops/intake/reports/restore-drill-db-<date>.json`.
4. Log the date and RTO in the table below. A FAIL is an incident: fix before the next nightly run.

| Date | Backup file | RTO (s) | RPO (h) | Verdict | Notes |
|---|---|---|---|---|---|
| | | | | | first drill pending |

## Real restore (production is broken)

1. Stop writers: `launchctl bootout gui/$(id -u)/com.meowops.harness-sync` so the sync agent does not write during the restore.
2. Pick the dump: newest in `~/.meow-ops/intake/backups/db`, or an older one if the corruption predates it (`latest.json` and each `<file>.json` carry row counts to compare).
3. Restore into a **new** Supabase project or a branch first, drill-style, and check the key tables. Only then restore into production: `gunzip -c <file> | psql --set ON_ERROR_STOP=1 "$DATABASE_URL"`. The dump is `--clean --if-exists`, so it drops and recreates the public schema objects it contains.
4. Re-run `./db/migrate.sh` to apply any migration newer than the dump.
5. Restart writers: `npm run agents:install`.
6. Write the postmortem in `docs/adr/` (what broke, what the RPO actually was, what changes).

## Related

- `ROLLBACK.md`: application rollback (Vercel, git). This runbook is the data half.
- `db/README.md`: migration runner and schema.
- SHIP-GATE checks 16 and 17 are closed by this runbook plus one logged drill.
