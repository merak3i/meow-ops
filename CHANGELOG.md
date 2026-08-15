# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Local Usage Receipt v1 ADR**: docs/schema evidence matrix, fail-closed JSON schema, and schema contract tests. No adapters. See `docs/adr/0001-local-usage-receipt-v1.md`.
- **Cursor aggregate usage panel**: Overview shows Admin API usage that could not be exactly matched to a local session, grouped by model and explicitly labelled as unassigned.
- **Cursor Admin API usage enricher** (`sync/cursor-admin-usage.mjs`): opt-in team-admin connector for `POST /teams/filtered-usage-events`. Local agent transcripts still parse without a key. The published schema does not promise a session identifier; when the API explicitly returns a known conversation/cloud-agent id variant, events join only on exact equality with a local id. Unmatched model totals stay aggregate. The credential is never logged or written.
- **Loop-Ops Supabase connector** (`sync/loop-ops-supabase.mjs`) — opt-in, plug-in-later: pulls live per-surface truth states from a Supabase table into the truth CSV the Loom importer already consumes (`--truth`), keyed by `surface_key`. Excel stays the structure; Supabase supplies the live state. No-op until `LOOP_OPS_SUPABASE_URL/_KEY/_TABLE` are set; all private config in env, never committed. Plus `sync/loop-ops-supabase-watch.mjs` for real-time sync via Supabase Realtime, and a near-real-time cron path. README documents all three cadences.
- **Google Antigravity parser** (`sync/parse-antigravity.mjs`) — tracks Antigravity agent sessions (time, tools, project, snippet) from `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`. Token/model/cost are not exposed by Antigravity locally (encrypted store, opaque model enum, server-side usage), so those sessions carry `usage_available: false` and are never assigned fabricated tokens or cost.
- `sync/session-utils.mjs` — shared snippet/project/default-session helpers, removing copy-paste drift across the five parsers.
- Golden tests for `cost-calculator`, `parse-session`, and `parse-antigravity`; security regression tests for the local API (cross-origin + DNS-rebinding rejection).
- `.github/workflows/ci.yml` — CI runs sync tests + build (blocking) and lint + typecheck (visible, non-blocking while pre-existing debt is cleared).
- `typecheck` npm script (`tsc --noEmit`).
- `db/migrations/0004_rls_tenant_isolation.sql` — strict per-tenant SELECT on the legacy tables (removes the `tenant_id IS NULL` world-read).
- Env: `MEOW_TZ`, `MEOW_NO_SNIPPETS`, `ANTIGRAVITY_DIR`, `MEOW_DASHBOARD_ORIGIN`, `CURSOR_PROJECTS_DIR`, `CURSOR_ADMIN_API_KEY`.
- App-shell React error boundary so one page throwing no longer blank-screens the app.

### Fixed
- Session and overview UI now preserve every tracked agent source, show the real model id (or `Not exposed`), and render unavailable token/cost usage as `N/A` instead of mislabeling it as Sonnet or zero.
- **Billing accuracy:** Codex no longer double-counts cached tokens (OpenAI `input_tokens` already includes cached); Cursor can no longer produce negative `output_tokens`; Aider guards `NaN` token parses and stops fabricating a 300s duration; the cost calculator clamps negative/`NaN` tokens and flags unknown models instead of silently pricing them as Sonnet; the over-broad `flash` match no longer mis-prices `gemini-1.5-flash`.
- **Security:** the dev server and `sync/local-api.mjs` now reject cross-origin and non-localhost-Host requests (CSRF / DNS-rebinding); a browser POST can no longer trigger `git push` (the `--push` side effect is removed from the HTTP path); secret-detection regexes now catch Supabase JWT service-role keys.
- `export-local.mjs` does real de-duplication (was a no-op alias) and fixes a subagent `session_id` collision; reads large JSONL via a chunked reader (no 512MB single-string cap); day/week/month boundaries use the system timezone (overridable via `MEOW_TZ`) instead of hardcoded IST.
- Runtime validation of `sessions.json` at the data-layer boundary so a malformed row can no longer `NaN`-poison every total.
- Per-source breakdowns no longer fold Cursor/Aider/Antigravity sessions into "Claude".

### Changed
- `parse-cursor.mjs` reads local parent and subagent agent-transcripts from `~/.cursor/projects` instead of inferring models from IDE logs.
- Pricing table adds `gemini-3-pro`, `gemini-3-flash`, and `gemini-2.5-flash`.

### Removed
- Dead D3 `src/scrying-sanctum/` tree (~900 LOC, unreferenced) and its duplicate `ScryingSanctum` component.

## [1.1.0] - 2026-04-09

### Fixed
- Remove unused `formatTokens` import in `AnalyticsDashboard.tsx` (dead import)
- Remove unused `fromPromise` import in `companionMachine.ts` (dead import)

### Changed
- Migrate `src/lib/format.js` → `src/lib/format.ts` — adds full type signatures, fixes pre-existing `noImplicitAny` error
- Enable `noUnusedLocals` and `noUnusedParameters` in `tsconfig.json` for build-time dead code enforcement

### Added
- `CHANGELOG.md` — project history in Keep a Changelog format
- `ROLLBACK.md` — documented rollback strategies for Vercel and git
- `db/` — forward-looking migration scaffolding (Supabase/PostgreSQL)
  - `db/migrations/0001_initial_schema.sql` — sessions table matching `Session` type
  - `db/migrations/0002_daily_summaries.sql` — daily aggregates table
  - `db/migrate.sh` — idempotent migration runner
  - `db/README.md` — migration workflow documentation

## [1.0.0] - 2026-04-09

### Added
- Architectural pivot: analytics engine + Kajiya-Kay companion v2 (React Three Fiber)
- `src/companion-v2/` — 3D cat with IK, LOD, and custom GLSL fur/SSS shaders
- `src/analytics/` — velocity, efficiency, burn-rate, and profile analytics modules
- `src/state/companionMachine.ts` — XState state machine for companion lifecycle
- `src/pages/AnalyticsDashboard.tsx` — AG-Grid table for session analytics
- `src/types/session.ts` — single source of truth for all session types

### Changed
- Token/spend stats, spend cards, and session cap accuracy improved
- Cost breakdown boxes (today/weekly/monthly/yearly) with auto-refresh
- IST timestamps and latest-first session sort
- Weekly/monthly spend tracking + Codex integration

### Fixed
- Overview/charts bucket sessions by `ended_at` (not `started_at`)
- Overview stat cards aggregate over full selected date range

## [0.4.0] - 2026-04-08

### Added
- 3D companion scene with React Three Fiber (`@react-three/fiber`, `@react-three/drei`)
- Cinematic visual overhaul with Puss in Boots-tier rendering
- Cat, GoT accessories, PNG override for visual customisation

### Changed
- Companion visuals upgraded from DOM-based to WebGL-rendered

## [0.3.0] - 2026-04-07

### Added
- PWA manifest with correct icon sizes for macOS dock install
- Service worker with network-first navigation, stale cache purge on activate
- Screenshots, capture script, and launch tweet templates (`docs/`)

### Changed
- Logo alt text updated to "Meow Operations"
- Sidebar refresh button added for production use

## [0.2.0] - 2026-02-27 — 2026-03-05

### Added
- Companion v1: Tamagotchi-style companion mode (replaced Cat Colony)
- Pomodoro timer with cat breed sprite
- Cost tracker, live sessions, by-day/project/action views

## [0.1.0] - 2026-04-07

### Added
- Initial release: React 19 + Vite + TypeScript PWA
- Session analytics dashboard with date filtering
- Overview stat cards and daily/spend charts
- Supabase Storage integration for data hosting (optional)
- File-based local data pipeline (`sync/` scripts)
