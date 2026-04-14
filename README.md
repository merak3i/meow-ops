# 🐾 Meow Operations

> **The open source AI observability layer with a soul — and a cat.**

A local-first, multi-model token analytics dashboard, Pomodoro focus system, and living 3D AI companion — all in one installable PWA. Free, MIT-licensed, and built for every developer who wants to understand what their AI agents are actually doing and what they're actually worth.

**Not just a cost tracker. A productivity OS for the agentic age.**

---

## Install — 2 minutes, zero accounts

### Prerequisites
- **Node.js 18+** — check with `node --version`
- **npm** (comes with Node) or pnpm
- **Claude Code** installed and used at least once (your sessions live in `~/.claude/projects/`)

### Download and run

```bash
git clone https://github.com/merak3i/meow-ops.git
cd meow-ops
npm install
node sync/export-local.mjs    # parses ~/.claude/projects → public/data/sessions.json
npm run dev                   # opens http://localhost:5173
```

That's it. Your real session data loads on first page hit.

### First-time setup

1. Open `http://localhost:5173` in Chrome
2. The dashboard loads your Claude sessions immediately
3. To add Aider sessions: `AIDER_PROJECTS=/path/to/your/project node sync/export-local.mjs`
4. To add Cursor sessions: `CURSOR_LOGS_DIR=~/.cursor/logs node sync/export-local.mjs`
5. Re-run the sync command any time after new AI sessions to refresh

### Install as a PWA (dock-installable)

Run locally, then in Chrome: **address bar → install icon (⊕)** → the dashboard installs to your dock or desktop. Works offline via service worker.

For remote access from any device (phone, iPad, second machine), see the **Deploy** section below.

---

## The Problem Nobody Talks About

Developers using AI tools — Claude, GPT-4o, Gemini, Codex, Cursor, Aider — spend hundreds of dollars a month on tokens with almost no visibility into what they got for it. Not cost-per-model. Not which project burns the most. Not whether a session actually shipped something or just spun its wheels.

The tools that do exist count tokens. None of them:
- Tell you what those tokens **produced**
- Work across **multiple AI models** in one view
- Let you watch your **agents operate in real time**
- Make any of it **fun to look at**

Meow Operations fixes all four. For free. For everyone.

---

## What It Does

### Analytics Dashboard
Tracks sessions from **Claude Code**, **OpenAI Codex Desktop**, **Aider**, and **Cursor** in one unified view. Cost tables for 30+ models.

| Page | What you see |
|---|---|
| **Overview** | Sessions, tokens, cost, healthy/ghost ratio, daily chart, tool distribution, spend by period |
| **Sessions** | Sortable table with cat-type classification per session |
| **Agent Ops** | Wall-clock Gantt timeline of parent + subagent runs, efficiency index, drill-down panel |
| **Scrying Sanctum** | 3D agent pipeline visualizer — unit frames, ley lines, pixel-art sprites |
| **By Project** | Horizontal bar breakdown per project |
| **By Day** | Area chart of token usage and session counts over time |
| **By Action** | Which tools your agents actually reach for |
| **Cost Tracker** | Daily cost line, cumulative burn, per-model breakdown |
| **Live Sessions** | Real-time agent cards with tool-usage bars |

### Source Breakdown

When you use both Claude Code and OpenAI Codex Desktop, the **Overview** page shows a full side-by-side comparison and the **sidebar** shows a compact Source Usage panel:

- Sessions count and percentage share per source
- Total cost and tokens per source
- Average cost per session
- Ghost rate (empty/useless sessions) with a red flag when > 15%
- Filter the whole dashboard to one source via the `◆ Claude` / `⬡ Codex` toggle buttons

The Source Usage sidebar panel is hidden automatically when only one source has data.

### Agent Operations Visualizer

When Claude Code runs with subagents, meow-ops turns the session tree into a Gantt timeline showing exactly what ran in parallel vs. sequentially:

```
Run: patherle — 3 agents — $0.84 — 12m ago
⏱ 10:32:14 ───────────────────────────── 10:34:57 IST
├── 📐 Sonnet  code-explorer    ████████████           47s $0.12
├── 📐 Sonnet  code-architect      ███████████████████ 1m42s $0.51
└── 🔍 Haiku   code-reviewer    ████████               38s $0.09

⚡ 14,200 tok/$  (efficiency index)
```

Click any row for a full breakdown: token split, cache hit rate, tool usage, sidechain flag.

### Scrying Sanctum

A real-time multi-agent pipeline visualizer with a fantasy WotLK aesthetic. Watch your AI agents communicate — see every token flow traverse the network as animated runestones along glowing ley lines.

```
Argent Vanguard ──────────── Ebon Blade Scout ──────────── Dalaran Archmage ──── Argent Herald
  [active]       healthy ley     [active]       choked ley     [active]            [idle]
  $0.0009                        $0.0041                        $0.0223             $0.0003
  112ms                          1480ms                         3240ms              58ms
```

**Features:**
- Four champion node types with distinct sigils and accent colors
- Ley line health states: `healthy` (fast flow), `choked` (slow flow), `severed` (flickering)
- Animated runestones travel along ley line paths carrying JSON/text/error payloads
- Click any runestone to open a Loot Box modal showing full payload, token count, and latency
- D3 zoom/pan canvas — scroll to zoom, drag to pan
- Demo mode: cycles pre-built pipelines when not authenticated; no Supabase account required
- Supabase Realtime mode: live data from `ss_pipelines`, `ss_nodes`, `ss_edges`, `ss_runestones` tables with multi-tenant RLS

See `db/migrations/0003_scrying_sanctum.sql` for the full schema and RLS policies.

### The Cat Companion

A living 3D companion rendered in WebGL with Kajiya-Kay fur shading, subsurface scattering, and proper procedural anatomy — that evolves based on your actual session data.

**Procedural anatomy** (no glTF required, runs in every browser):
- Multi-part body: capsule torso, sphere head, cylinder neck, capsule limbs, sphere paws, cubic Bezier tail, cone ears
- Canvas-generated fur texture: 9000 directional micro-strands per part, breed-specific base color + accent stripes
- Layered eye system: sclera (clearcoat 0.6) + iris (clearcoat 1.0, vertical slit pupil) + specular catchlight
- Whiskers rendered as `LineSegments` — 3 per side, tapered opacity
- Post-processing tuned to prevent bloom overexposure: `luminanceThreshold 0.88`, `focalLength 0.08`, `toneMappingExposure 0.95`

**Physical evolution — real mesh deformations:**

| Morph | Driver | Visual change |
|---|---|---|
| **Robustness** | Heavy `Bash` usage | More muscular frame |
| **Agility** | Heavy `Read` / `Grep` | Longer, leaner silhouette |
| **Intelligence** | Heavy `Agent` / `PlanMode` | Larger head |
| **Size** | Total tokens (lifetime XP) | kitten → elder |
| **Fatigue** | 4h overload window | Drooping posture |

**Tamagotchi gameplay** (lives in localStorage, nothing uploaded):
- 5 stats: Hunger, Energy, Happiness, Health, Shine — decay over real time
- Feed, play, groom, sleep — each triggers a particle effect on the 3D cat
- 20+ food items, 15+ accessories, 6 rooms (each changes HDRI lighting)
- Cat runs away after 14 days of neglect → memorial entry

**Personality traits** — the cat reflects your work pattern:

| 14-day dominant type | Trait | Bonus |
|---|---|---|
| Architect | 📐 Methodical | Happiness decay resistance |
| Builder | 🔨 Prolific | +10% shine from feed |
| Detective | 🔍 Vigilant | +5% health passive |
| Commander | ⚡ Bold | +10% energy from sleep |

**Memory markings** — permanent 3D marks earned once, never removed:
- 🩹 Scar — survived health < 5%
- ✨ Gold stripe — 7-day coding streak
- ⭐ Star mark — 100+ total sessions
- 🔥 Blaze — single session cost > $1
- 👑 Crown — 30-day streak

**Cat card export** — 📸 Share button → PNG download with name, breed, stats, trait badge, meow-ops watermark.

**Live session detection** — page polls every 30s. When new sessions are detected while you're working, the cat reacts with a gold sparkle burst.

### macOS Menu Bar

A native-feeling menu bar widget that auto-syncs your sessions in the background:

```bash
cp sync/launchd-example.plist ~/Library/LaunchAgents/com.meow-ops.sync.plist
launchctl load ~/Library/LaunchAgents/com.meow-ops.sync.plist
```

Runs `export-local.mjs` every hour, keeping your deployed dashboard current without opening a terminal.

### How Sessions Are Classified

Every session is auto-tagged by tool usage profile:

| Type | Trigger | Meaning |
|---|---|---|
| 🏗️ Builder | >40% Write + Edit | Heavy coding/writing |
| 🔍 Detective | >50% Read + Grep + Glob | Code exploration |
| 💻 Commander | >40% Bash | Shell/system work |
| 📐 Architect | >20% Agent + PlanMode | Planning/orchestration |
| 🛡️ Guardian | Top tool is Grep/Read | Audits and reviews |
| 📝 Storyteller | Top tool is Write | Docs and content |
| 👻 Ghost | <3 messages or no tools | Empty session |

### Supported Models

30+ models with accurate pricing:

| Family | Models |
|---|---|
| **Claude** | Opus 4, Sonnet 4.6, Sonnet 4.5, Haiku 4.5 |
| **OpenAI** | GPT-4o, GPT-4o-mini, GPT-5, o3, o4-mini |
| **DeepSeek** | V3, R1, R1-0528 |
| **Qwen** | Max, Plus, Turbo (Alibaba DashScope) |
| **Moonshot** | Kimi K2 |
| **Zhipu** | GLM-4, GLM-4-Flash (free) |
| **ByteDance** | Doubao-Pro |
| **xAI** | Grok-3, Grok-3-mini, Grok-2 |
| **Cohere** | Command R+, Command R |
| **Amazon** | Nova Pro, Nova Lite, Nova Micro |
| **Google** | Gemini 2.5 Pro, 2.0 Flash, 1.5 Pro, 1.5 Flash |
| **Mistral** | Large, Small |
| **Perplexity** | Sonar Pro, Sonar |
| **Local** | Llama 3.3-70B (cost = $0) |

Unknown variants match by family fuzzy search.

---

## Deploy as a PWA (access from any device)

### 1. Supabase Storage setup (free tier)

```bash
# Create a public bucket
curl -X POST "https://<your-project>.supabase.co/storage/v1/bucket" \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"id":"meow-ops","name":"meow-ops","public":true}'
```

### 2. Configure `.env`

```bash
cp .env.example .env
# Fill in:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY
#   VITE_SESSIONS_URL   (public bucket URL to sessions.json)
#   SUPABASE_SERVICE_KEY  (local only — never deployed)
```

### 3. Sync and deploy

```bash
node sync/full-sync.mjs   # parse + upload in one shot
npx vercel --prod
```

### 4. Auto-sync hourly (macOS)

```bash
cp sync/launchd-example.plist ~/Library/LaunchAgents/com.meow-ops.sync.plist
# Edit the paths inside the plist to match your setup, then:
launchctl load ~/Library/LaunchAgents/com.meow-ops.sync.plist
```

### 5. Install to dock

1. Open your Vercel URL in Chrome
2. Address bar → install icon (⊕)
3. Right-click dock icon → Options → Keep in Dock

### 6. Scrying Sanctum (Supabase Realtime, optional)

Run the migration to enable live agent pipeline visualization:

```bash
# In Supabase SQL editor:
-- Run db/migrations/0003_scrying_sanctum.sql
```

This creates `ss_pipelines`, `ss_nodes`, `ss_edges`, `ss_runestones` with multi-tenant RLS and enables Realtime publication. Without this, the Scrying Sanctum page runs in demo mode automatically.

---

## Architecture

```
Local machine                                         Cloud (optional)
─────────────                                         ────────────────
~/.claude/projects/         ~/.codex/sessions/
  ├── <session>.jsonl          └── <session>.jsonl
  └── subagents/
       └── agent-*.jsonl
              │
              ▼
      sync/export-local.mjs
      (parse · dedupe · classify · cost-calculate)
              │
              ├──── public/data/sessions.json   (local dev)
              │
              └──── sync/upload-to-supabase.mjs ──► Supabase Storage
                                                         │
PWA on dock ──► vercel.app ──── fetch sessions.json ─────┘
              React 19 + Vite 8 + Recharts + D3
              Three.js companion (WebGL)
              XState emotional state machine
              Supabase Realtime (Scrying Sanctum)
```

**No backend. No server-side rendering.** The entire production build is a static bundle plus one JSON file. Supabase Realtime is opt-in for the Scrying Sanctum pipeline visualizer.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite 8 |
| 3D Companion | Three.js + React Three Fiber + custom GLSL shaders |
| State machine | XState 5 (companion emotional states) |
| Charts | Recharts |
| Pipeline visualizer | D3 (zoom/pan/SVG) |
| Styling | Tailwind CSS 4 + OKLCH design tokens |
| Data grid | AG-Grid (session analytics table) |
| Storage | Supabase Storage (opt-in) |
| Realtime | Supabase Realtime (Scrying Sanctum, opt-in) |
| Hosting | Vercel (or any static host) |
| Sync | Node.js ESM scripts |

---

## Testing

End-to-end tests run against the production build using Playwright:

```bash
npm run build         # build dist/
npx playwright test   # runs all 15 tests against npm run preview
```

Tests cover all 12 pages, key interactions, PWA manifest, and data endpoints. The `playwright.config.ts` uses a single Chromium project against `http://localhost:4173` (Vite preview port).

To run a single test file or test by name:

```bash
npx playwright test --grep "Scrying Sanctum"
npx playwright test --reporter=list
```

---

## Privacy

- **Local-first by default.** Nothing leaves your machine in dev mode.
- **Sessions JSON contains metrics only** — token counts, tool counts, durations, model names, project names from `cwd`. No message content, no prompts, no code.
- **Supabase upload is opt-in.** Your own bucket, your own credentials.
- **Service key is local-only.** It never appears in the production bundle.
- **No analytics, no telemetry, no tracking.** The app has no idea you exist.

---

## Roadmap

### Token Value Index _(designed, not yet built)_

Link sessions to git commits and measure what shipped:
- Lines of code merged per $1 spent
- Successful sessions (committed output) vs. ghost sessions (nothing landed)
- Project ROI: which codebases generate the most value per token
- Model comparison: which model gets you to commit fastest

### Gemini CLI + OpenRouter parsers _(planned)_

Parsers for additional AI tools:
- `sync/parse-gemini.mjs` — Gemini CLI session logs
- `sync/parse-openrouter.mjs` — unified cost across all OpenRouter models
- `sync/parse-ollama.mjs` — local model sessions (cost = electricity estimate)

### Scrying Sanctum enhancements _(planned)_

- Supabase integration guide for connecting your own multi-agent pipelines
- WebSocket bridge for non-Supabase backends
- Node clustering for large pipelines (10+ agents)
- Replay mode: scrub through a completed pipeline run

### Community Cat Registry _(planned)_

Opt-in. Share your companion's current state (not your session data) to a public registry. See how your cat's physique compares to other developers globally. Leaderboards by growth stage, rarity tier, streak length.

Privacy-first and opt-in by design.

---

## Contributing

Every feature on the roadmap is an open issue. The highest-impact contributions:

**New model parsers**
- `sync/parse-gemini.mjs` — Gemini CLI
- `sync/parse-openrouter.mjs` — OpenRouter unified

**Analytics**
- Token value index (link sessions to git commits)
- Session quality score (output tokens / ghost ratio / tool diversity)
- Model comparison view (same project, different models, side-by-side cost)

**Companion**
- New cat types / classifier rules for new tools
- Sound design (purring on focus, chirps on breakthroughs)
- Cat card frame designs (community-submitted overlays)

**Agent Visualizer / Scrying Sanctum**
- Live replay mode (replay a session's agent operations at 10× speed)
- Cross-run comparison (trend lines: are your runs getting cheaper?)
- Scrying Sanctum zoom/pan canvas (true spatial layout, not horizontal scroll)

PRs welcome. Open an issue first for anything substantial.

---

## Project Structure

```
meow-ops/
├── public/
│   ├── manifest.json            PWA manifest
│   ├── sw.js                    Service worker (network-first)
│   └── data/                    Generated by export-local.mjs
│       ├── sessions.json        All parsed sessions (last 1000)
│       └── cost-summary.json    Today/week/month/year spend buckets
├── db/
│   └── migrations/
│       ├── 0001_sessions.sql    Core sessions schema
│       ├── 0002_backfill.sql    Tenant ID backfill
│       └── 0003_scrying_sanctum.sql  Pipeline viz schema + RLS + Realtime
├── e2e/
│   └── meow-ops.spec.ts         Playwright e2e tests (15 tests, all pages)
├── src/
│   ├── analytics/               Velocity, efficiency, burn-rate, profile modules
│   ├── companion-v2/            WebGL companion
│   │   ├── ProceduralCat.tsx    Procedural anatomy, fur textures, eye shader
│   │   ├── CompanionScene.tsx   R3F canvas, HDRI rooms, particles, post-processing
│   │   ├── CompanionPageV2.tsx  Orchestrator — polling, milestones, marks
│   │   ├── StatsPanel.tsx       Stat bars, actions, trait badge, share button
│   │   ├── useCompanionGame.ts  Store wrapper, personality trait, memory marks
│   │   ├── ActionParticles.tsx  Per-action Three.js particle effects
│   │   ├── MilestoneOverlay.tsx Celebration overlay (growth, streaks, spend)
│   │   └── CatCardExport.tsx   Canvas2D overlay → PNG download
│   ├── components/              Charts, session table, stat cards, date filter
│   ├── lib/
│   │   ├── agent-tree.ts        Forest builder, efficiency index, cache hit rate
│   │   └── companion-store.js   Tamagotchi engine (localStorage)
│   ├── pages/
│   │   ├── AgentVisualizer.tsx  Gantt timeline, ghost flagging, drill-down
│   │   ├── AgentDetailPanel.tsx Slide-in session detail panel
│   │   ├── ScryingSanctum.tsx   3D agent pipeline visualizer
│   │   └── ...                  Overview, Sessions, ByDay, ByProject, etc.
│   ├── scrying-sanctum/         Agent pipeline visualizer (D3 + Supabase Realtime)
│   │   ├── ScryingSanctum.tsx   Main page — D3 zoom canvas, legend, loot box
│   │   ├── ChampionNode.tsx     SVG foreignObject node card
│   │   ├── LeyLine.tsx          SVG path with flow animation + runestones
│   │   ├── Runestone.tsx        Animated token packet (RAF path-following)
│   │   ├── championsConfig.ts   Node metadata, colors, Bezier path builder
│   │   ├── useScryingData.ts    Supabase/demo data hook with Realtime subscriptions
│   │   ├── types.ts             SsNode, SsEdge, SsRunestone, SsPipeline types
│   │   └── scrying-sanctum.css  Ley line animations, champion cards, loot box
│   ├── state/
│   │   └── companionMachine.ts  XState machine — emotional states, cursor tracking
│   └── types/
│       └── session.ts           Single source of truth for all session types
├── sync/
│   ├── parse-session.mjs        JSONL parser with agent hierarchy extraction
│   ├── parse-codex.mjs          OpenAI Codex Desktop parser
│   ├── parse-cursor.mjs         Cursor IDE log parser
│   ├── parse-aider.mjs          Aider chat history parser
│   ├── cost-calculator.mjs      30+ model pricing with fuzzy matching
│   ├── export-local.mjs         All sources → sessions.json + cost-summary.json
│   ├── fetch-claude-limits.mjs  Update rate-limits.json from claude.ai/settings/usage
│   ├── upload-to-supabase.mjs   Push to Storage bucket
│   ├── full-sync.mjs            export + upload in one shot
│   └── launchd-example.plist    macOS hourly auto-sync template
├── playwright.config.ts         Playwright configuration
└── .env.example
```

---

## License

MIT. Build with it, fork it, ship it. The only ask is that derivative tools stay open source too.

---

## Credits

3D fur rendering inspired by Kajiya-Kay shading models. Focus timer mechanics inspired by [Forest: Stay Focused](https://www.forestapp.cc). Visual design language inspired by [ElevenLabs](https://elevenlabs.io). Built with [Claude Code](https://claude.com/claude-code).

---

*Meow Operations is a community tool. It has no business model, no venture funding, and no plans to acquire either. It exists because developers deserve to understand their AI spend — and because the interface for that understanding should feel like something you want to open.*
