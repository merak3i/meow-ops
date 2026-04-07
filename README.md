# Meow Operations

A self-hosted analytics dashboard for Claude Code that turns your local session
files into charts, projects, costs, and a gamified cat colony. Includes a
Pomodoro focus timer with cat-breed unlocks, a live sessions view, and a one-click
local sync.

Built with React + Vite + Recharts + Framer Motion. Premium dark theme inspired
by ElevenLabs (OKLCH palette, weight-300 typography, layered shadows). Designed
to be installed as a PWA on the macOS dock.

> No accounts, no telemetry, no servers required. Your session data never leaves
> your machine unless you explicitly upload it to your own Supabase bucket.

---

## What it does

Claude Code writes a JSONL transcript for every session under
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (and nested
`subagents/agent-*.jsonl` for subagent runs). These files contain everything
the dashboard needs: timestamps, model names, token usage, tool calls, and
project paths.

Meow Operations parses those files locally and gives you:

- **Overview** — sessions today, tokens, cost, healthy/ghost ratio, daily token chart, tool distribution
- **Sessions** — sortable table of every session with cat-type icons
- **By Project** — horizontal bar chart + per-project stats
- **By Day** — area chart of token usage and session counts over time
- **By Action** — tool usage pie + horizontal bar (which tools you actually use)
- **Cost Tracker** — daily cost line, cumulative cost, model-by-model breakdown
- **Cat Colony** — projects rendered as buildings with sessions as cats grouped by tool profile (Builder, Detective, Commander, Architect, Guardian, Storyteller, Ghost)
- **Live Sessions** — agent cards with tool-usage bars + a models breakdown view
- **Focus Timer** — Pomodoro timer with cat breeds that grow during focus, ghost on tab-switch, shiny drops on long streaks

## Why

Most Claude Code trackers count input tokens. None count output, none gamify,
none make the data feel like *yours*. Meow Operations is the dashboard built for
people who want to see what they actually shipped, not just what they spent.

---

## Quickstart (local-only, 2 minutes)

```bash
git clone https://github.com/merak3i/meow-ops.git
cd meow-ops
npm install
node sync/export-local.mjs    # parses ~/.claude/projects → public/data/sessions.json
npm run dev                   # opens http://localhost:5176
```

That's it. The dashboard loads your real Claude Code data on the first page hit.

There's a **Sync button** in the bottom-left of the sidebar (only visible in dev
mode). Click it any time to re-parse your latest sessions. The Vite dev server
exposes a `POST /api/sync` endpoint that runs the export script and the
dashboard auto-refreshes.

### Refresh data manually

```bash
node sync/export-local.mjs
```

Re-parsing 200+ sessions takes ~2 seconds.

---

## Deploy to Vercel + Supabase Storage (so the PWA works from anywhere)

This is the path if you want to install Meow Operations as a PWA on your dock,
your iPad, or share a read-only link with someone.

### 1. Create a Supabase project (free tier is fine)

1. Sign up at [supabase.com](https://supabase.com), create a project
2. Get your Project URL and **service role key** from Project Settings → API

### 2. Create a public storage bucket called `meow-ops`

```bash
curl -X POST "https://<your-project>.supabase.co/storage/v1/bucket" \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"id":"meow-ops","name":"meow-ops","public":true}'
```

### 3. Configure `.env` locally

```bash
cp .env.example .env
# Edit .env and fill in:
#   VITE_SUPABASE_URL          (e.g. https://abc.supabase.co)
#   VITE_SUPABASE_ANON_KEY
#   VITE_SESSIONS_URL          (https://abc.supabase.co/storage/v1/object/public/meow-ops/sessions.json)
#   SUPABASE_SERVICE_KEY       (local-only, never deployed)
```

### 4. Push your sessions to the bucket

```bash
node sync/full-sync.mjs    # parses + uploads in one shot
```

### 5. Deploy to Vercel

```bash
npm install -g vercel
vercel link
vercel env add VITE_SESSIONS_URL production    # paste the same URL from step 3
vercel --prod
```

The production bundle has the Sync button hidden (no Vite middleware in prod).
It fetches `sessions.json` from the public bucket URL baked in at build time.

### 6. Auto-sync hourly with launchd (macOS)

A reference plist is in `sync/launchd-example.plist`. Edit the paths and load:

```bash
cp sync/launchd-example.plist ~/Library/LaunchAgents/com.meow-ops.sync.plist
# Edit the plist to point at your repo
launchctl load ~/Library/LaunchAgents/com.meow-ops.sync.plist
```

Now `sync/full-sync.mjs` runs every hour in the background. The PWA picks up
new data on every page load (5-minute browser cache).

### 7. Install as a PWA

1. Open your Vercel URL in **Chrome**
2. Address bar → install icon (small monitor + down arrow)
3. Confirm "Install"
4. Right-click the dock icon → Options → Keep in Dock

Done. The dock icon now opens your dashboard instantly, anywhere, no
local server required.

---

## Architecture

```
Local machine                                       Cloud
─────────────                                       ─────
~/.claude/projects/
  ├── <encoded-cwd>/
  │     ├── <session-id>.jsonl
  │     └── <session-id>/subagents/agent-*.jsonl
                │
                ▼
        sync/export-local.mjs
        (parse + dedupe + classify cat types)
                │
                ▼
        public/data/sessions.json
                │
                ▼
        sync/upload-to-supabase.mjs
                │
                └──────────────────────────────────►  Supabase Storage
                                                      (public bucket)
                                                            │
                                                            │
PWA on dock ──► https://<your>.vercel.app                   │
                Vite + React + Recharts                     │
                                       └──── fetch ─────────┘
                                              sessions.json
```

Three scripts in `sync/`:

| Script | What it does |
|--------|--------------|
| `export-local.mjs` | Walks `~/.claude/projects/`, parses every JSONL, writes `public/data/sessions.json` |
| `upload-to-supabase.mjs` | Uploads that file to your Supabase Storage bucket |
| `full-sync.mjs` | Runs both, in order |

The Vite dev server has a tiny custom plugin (`vite.config.js`) that exposes
`POST /api/sync` for the in-app Sync button. This middleware does **not** ship
to production — it's a dev-only convenience.

## How cat types are classified

Each session is auto-tagged based on which tools you used most:

| Cat | Trigger | Tools |
|-----|---------|-------|
| 🏗️ Builder | >40% Write+Edit | Heavy writing/editing |
| 🔍 Detective | >50% Read+Grep+Glob | Code exploration |
| 💻 Commander | >40% Bash | Shell/CLI work |
| 📐 Architect | >20% Agent+EnterPlanMode | Planning/orchestration |
| 🛡️ Guardian | top tool = Grep/Read | Audits, reviews |
| 📝 Storyteller | top tool = Write | Docs, content |
| 👻 Ghost | <3 messages or no tools | Empty sessions |

## Pomodoro + Cat Breeds

Eight cat breeds, four rarity tiers, eight unlock thresholds:

| Breed | Rarity | Unlock |
|-------|--------|--------|
| Persian, Siamese, Tabby | common | from start |
| Tuxedo | uncommon | 10 pomodoros |
| Calico | uncommon | 25 pomodoros |
| Maine Coon | rare | 50 pomodoros |
| Scottish Fold | rare | 100 pomodoros |
| Sphynx | legendary | 200 pomodoros |

Plus four **shiny variants** (Golden, Prismatic, Celestial, Void) that drop with
increasing chance based on your daily streak.

Forest-style mechanics: cat grows from kitten → adult during the timer. If you
switch tabs (Page Visibility API), it enters a warning state. After the grace
period, it becomes a ghost and the session is marked broken. Focus score tracks
% of timer time spent in-tab.

All Pomodoro state lives in `localStorage`. Nothing is uploaded.

## Tech stack

- **Vite 8** + **React 19** for the frontend
- **Tailwind CSS 4** (just for utilities — most styling is inline OKLCH variables)
- **Recharts** for the graphs
- **Framer Motion** for animations
- **Lucide** icons
- **Supabase JS** client (only used in production for storage fetch — no DB tables required)
- **Node** scripts for parsing and uploading
- **Vercel** for hosting (anywhere static will work)

No backend, no database, no server-side rendering. The whole production app is
a static bundle plus one JSON file in object storage.

## Privacy & data ownership

- **Local-first**: by default, nothing leaves your machine. The dev server reads
  JSONL files from your home directory and writes a JSON file under `public/`.
- **Sessions JSON contains aggregated metrics only**: token counts, tool counts,
  durations, model names, project names (from `cwd`). It does **not** contain
  message content, prompts, code snippets, or file contents.
- **Supabase upload is opt-in**: you only ship data to your own bucket if you
  configure `.env` with your own credentials. The bucket can be private if you
  prefer (use signed URLs from a serverless function — not included).
- **Service key stays local**: `SUPABASE_SERVICE_KEY` is read by `upload-to-supabase.mjs`
  on your machine only. It never appears in the production bundle.

If you're worried about leaking client/project names through `cwd`, edit
`projectFromCwd()` in `sync/export-local.mjs` to anonymize them before upload,
or skip the public deploy and run dev mode only.

## Project structure

```
meow-ops/
├── public/
│   ├── manifest.json           PWA manifest
│   ├── sw.js                   Service worker
│   └── meow-*.png              Logos
├── src/
│   ├── App.jsx                 Layout + routing
│   ├── main.jsx                React entry
│   ├── index.css               Theme (OKLCH variables)
│   ├── colony/
│   │   └── ColonyView.jsx      Cat colony visualization
│   ├── components/
│   │   ├── Sidebar.jsx         Nav + Sync button (dev only)
│   │   ├── SessionTable.jsx
│   │   ├── DailyChart.jsx
│   │   ├── ToolBreakdown.jsx
│   │   ├── ProjectBreakdown.jsx
│   │   ├── StatCard.jsx
│   │   ├── DateFilter.jsx
│   │   ├── ModelBadge.jsx
│   │   └── pomodoro/           Timer ring, cat sprites, settings, stats
│   ├── lib/
│   │   ├── queries.js          Data fetching, prod/dev source switching
│   │   ├── format.js
│   │   ├── cat-classifier.js
│   │   ├── pomodoro-store.js   localStorage state, breed unlocks, chime
│   │   └── supabase.js
│   └── pages/
│       ├── Overview.jsx
│       ├── Sessions.jsx
│       ├── ByProject.jsx
│       ├── ByDay.jsx
│       ├── ByAction.jsx
│       ├── CostTracker.jsx
│       ├── LiveSessions.jsx
│       └── Pomodoro.jsx
├── sync/
│   ├── parse-session.mjs       JSONL parser (shared by all scripts)
│   ├── cost-calculator.mjs     Pricing per model
│   ├── export-local.mjs        Walks ~/.claude/projects → sessions.json
│   ├── upload-to-supabase.mjs  Pushes JSON to public bucket
│   ├── full-sync.mjs           export + upload, one command
│   └── launchd-example.plist   macOS auto-sync template
├── vite.config.js              Includes the dev-only sync middleware plugin
├── vercel.json                 SPA rewrites + sw.js cache rule
└── .env.example
```

## Contributing

This started as a personal tool but it's open source because anyone using
Claude Code seriously could use it. PRs welcome — especially:

- New cat types and classifier rules
- Additional cost calculators (cache tiers, batch pricing, etc.)
- Mobile-friendly responsive layouts
- Themes other than dark
- Integrations with other AI coding tools (Cursor, Aider, Codex, etc.)

## License

MIT — see [LICENSE](./LICENSE).

## Credits

Visual design inspired by [ElevenLabs](https://elevenlabs.io). Cat colony
mechanics inspired by [Forest: Stay Focused](https://www.forestapp.cc). Built
with [Claude Code](https://claude.com/claude-code).
