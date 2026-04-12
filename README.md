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
| **Scrying Sanctum** | WoW × MMORPG pipeline visualizer — unit frames, ley lines, boss bars |
| **By Project** | Horizontal bar breakdown per project |
| **By Day** | Area chart of token usage and session counts over time |
| **By Action** | Which tools your agents actually reach for |
| **Cost Tracker** | Daily cost line, cumulative burn, per-model breakdown |
| **Live Sessions** | Real-time agent cards with tool-usage bars |

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

### Scrying Sanctum (MMORPG Visualizer)

An alternate view of the same agent pipeline data — rendered as a dungeon encounter.

Each agent becomes a **unit frame** with WoW-style aesthetics:
- **Portrait + class** — auto-assigned based on session cat type (Warrior, Rogue, Mage, Warlock, Paladin, Priest, Death Knight)
- **HP bar** — inverted cost: cheap sessions are healthy, expensive ones are bleeding
- **Mana bar** — token volume (total tokens / max in run)
- **Spells cast** — top tools used by that agent
- **Gold cost** — displayed in `g/c` (gold/copper) notation

Agents are connected by **ley lines** that reflect pipeline health:
- 🟢 Green flowing — healthy (cheap, fast)
- 🟡 Amber pulsing — choked (expensive or slow)
- 🔴 Red dashed + ✕ — severed (ghost session, no output)

A **boss bar** at the top shows the total pipeline mana cost as a raid health bar — red when burning money, green when efficient.

Click any unit frame to expand a full detail drawer showing token breakdown, cache stats, and project.

### Rate Limit Panel (Sidebar)

The sidebar SOURCE USAGE section shows your actual Claude.ai rate limits alongside local session stats:

```
◆ Claude                              $714.65
Session · resets in 50 min   ████████░░  62% left
Weekly (all) · resets Tue    █████████░  19% left
Weekly (Sonnet)              ██████████  47% left

79 sessions this week
44.2M tokens this week

⬡ Codex                               $8.01
1 session total
```

Rate limits are seeded from `public/data/rate-limits.json`. To update after checking `claude.ai/settings/usage`:

```bash
CLAUDE_SESSION_PCT=38 CLAUDE_WEEKLY_ALL_PCT=81 CLAUDE_WEEKLY_SONNET_PCT=53 \
  node sync/fetch-claude-limits.mjs
```

### The Cat Companion

A living 3D companion rendered in WebGL (Kajiya-Kay fur, subsurface scattering) that evolves based on your actual session data.

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
              React 19 + Vite 8 + Recharts
              Three.js companion (WebGL)
              XState emotional state machine
```

**No backend. No database. No server-side rendering.** The entire production build is a static bundle plus one JSON file.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite 8 |
| 3D Companion | Three.js + React Three Fiber + custom GLSL shaders |
| State machine | XState 5 (companion emotional states) |
| Charts | Recharts |
| Styling | Tailwind CSS 4 + OKLCH design tokens |
| Data grid | AG-Grid (session analytics table) |
| Storage | Supabase Storage (opt-in) |
| Hosting | Vercel (or any static host) |
| Sync | Node.js ESM scripts |

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
├── src/
│   ├── analytics/               Velocity, efficiency, burn-rate, profile modules
│   ├── companion-v2/            WebGL companion
│   │   ├── CatMesh.tsx          Fur shaders, IK, morph weights, memory marks
│   │   ├── CompanionScene.tsx   R3F canvas, HDRI rooms, particles
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
│   │   ├── ScryingSanctum.tsx   WoW × MMORPG pipeline visualizer
│   │   └── ...                  Overview, Sessions, ByDay, ByProject, etc.
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
