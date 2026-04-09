# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
