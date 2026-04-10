# 🐾 Meow Operations

> **The open source AI observability layer with a soul — and a cat.**

A local-first, multi-model token analytics dashboard, Pomodoro focus system, and living 3D AI companion — all in one installable PWA. Free, MIT-licensed, and built for every developer who wants to understand what their AI agents are actually doing and what they're actually worth.

**Not just a cost tracker. A productivity OS for the agentic age.**

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

## What It Is

A self-hosted PWA that parses your local AI session files — no accounts, no cloud dependency, no telemetry. Install it to your dock in under 2 minutes. Your data never leaves your machine unless you choose to sync it to your own Supabase bucket.

The core thesis: **token cost is a vanity metric. Token value is the one that matters.**

---

## What It Does Right Now

### Multi-Model Analytics
Tracks sessions from **Claude Code** and **OpenAI Codex Desktop** in one unified view. Pricing tables for Claude Opus/Sonnet/Haiku, GPT-4o, GPT-4o-mini, o3, o4-mini, and GPT-5 — with intelligent model matching so even unlisted variants get the right rate.

- **Overview** — sessions today, tokens, cost, healthy/ghost session ratio, daily chart, tool distribution
- **Sessions** — sortable table with cat-type classification per session
- **By Project** — horizontal bar breakdown per project
- **By Day** — area chart of token usage and session counts over time
- **By Action** — which tools your agents actually reach for
- **Cost Tracker** — daily cost line, cumulative burn, per-model breakdown
- **Live Sessions** — real-time agent cards with tool-usage bars

### The Cat Companion — a Sims-like AI familiar

This is not a mascot. It is a living reflection of how you work.

Your companion is rendered in **WebGL** using a custom Kajiya-Kay fur shader and subsurface scattering. It evolves based on your session data — physically, emotionally, and in personality.

**Physical evolution:**
The companion's body changes shape based on your tool usage patterns over time. These are real, continuous mesh deformations driven by morph weights computed from your actual sessions:

| Morph weight | What drives it | What it changes |
|---|---|---|
| **Robustness** | Heavy `Bash` / `Shell` usage | More muscular frame |
| **Agility** | Heavy `Read` / `Grep` / `Glob` | Longer, leaner silhouette |
| **Intelligence** | Heavy `Agent` / `EnterPlanMode` | Larger head |
| **Size** | Total tokens (your XP level) | Overall scale: kitten → elder |
| **Fatigue** | 4-hour token overload | Drooping posture, half-lidded eyes |

**Emotional states** (XState finite state machine — not scripted, dynamically driven):

| State | Trigger |
|---|---|
| `focusing` | Pomodoro timer active |
| `idle` | 2 minutes without a session |
| `sleeping` | Curled up after 10+ minutes idle |
| `exhausted` | Fatigue score ≥ 80% |
| `neglected` | No interaction for 1 hour |
| `happy` | Pet event (head click) |

The companion tracks your cursor. It watches you work. If you ignore it, it sulks. If you burn through a 6-hour deep work session, it slumps. If you pet it, it perks up. If you hit a streak, it grows.

**Growth stages:** kitten → juvenile → adult → elder, gated by total tokens processed across your lifetime (5M → 20M → 60M).

### Focus System — Pomodoro with Cat Breeds

Forest-style focus timer where your cat breed grows during the session and enters a ghost state if you switch tabs (Page Visibility API). Eight breeds across four rarity tiers, unlocked by pomodoros completed:

| Breed | Rarity | Unlock |
|---|---|---|
| Persian, Siamese, Tabby | Common | Default |
| Tuxedo | Uncommon | 10 sessions |
| Calico | Uncommon | 25 sessions |
| Maine Coon | Rare | 50 sessions |
| Scottish Fold | Rare | 100 sessions |
| Sphynx | Legendary | 200 sessions |

Four shiny variants (Golden, Prismatic, Celestial, Void) drop on long streaks. All state lives in `localStorage` — nothing uploaded.

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

---

## Roadmap

The current build is the foundation. Here is what comes next — in order of community demand.

### Agent Operations Visualizer _(in development)_

The most requested feature and the one that matters most as AI becomes agentic.

When Claude Code runs with subagents, it produces a tree of JSONL files — one per agent, nested under the parent session. The visualizer turns that tree into a live, interactive timeline:

```
Session ─────────────────────────────────────────────────────────►
  ├── Agent: code-explorer ──────────────────┐
  │     └── tools: Read ×14, Grep ×8         │ 2m 14s
  ├── Agent: code-architect ──────────────────┤
  │     └── tools: Read ×6, Agent ×2          │ 1m 47s
  └── Agent: code-reviewer ──────────────────►
        └── tools: Read ×11, Grep ×5          1m 03s
```

Each node shows: model, tool calls, token spend, duration, and whether the agent completed or was abandoned. The companion reacts — pacing when agents are running, slumping when they ghost, celebrating when the session commits.

This is the missing observability layer for multi-agent workflows. No tool has it.

### Universal Model Support _(partial — expanding)_

Currently parsing: **Claude Code**, **Codex Desktop**

Planned parsers and cost tables:
- Cursor (`.cursor/` session logs)
- Aider (`.aider.chat.history.md`)
- Gemini CLI
- Mistral Le Chat
- Ollama (local models, cost = electricity estimate)
- OpenRouter (unified cost across all models)

The goal: one dashboard, every AI tool you use.

### Token Value Index _(designed, not yet built)_

The inverse of cost tracking. Link sessions to git commits and measure what shipped:

- Lines of code merged per $1 spent
- Successful sessions (committed output) vs. ghost sessions (nothing landed)
- Project ROI: which codebases generate the most value per token
- Model comparison: which model gets you to commit fastest

The cat companion reflects this — a high-value developer's companion looks different from a high-cost one.

### Community Cat Registry _(planned)_

Opt-in. Share your companion's current state (not your session data) to a public registry. See how your cat's physique compares to other developers globally. Leaderboards by growth stage, rarity tier, streak length.

This is the social layer — built to be privacy-first and opt-in by design.

---

## Why Open Source

AI token costs are a new kind of financial burden that landed on developers overnight. There is no standard tooling. No common language for what a token "costs" vs. what it "produces." No way to compare across models. No way to explain your AI spend to a client, a manager, or yourself.

Commercial solutions exist. They require accounts, send your metadata to servers you don't control, and cost money to solve a problem you're already paying for.

Meow Operations will always be free, self-hosted, and MIT licensed. The companion, the analytics, the agent visualizer — all of it. Because the developer community deserves observability tooling that belongs to them.

The cats are because building should be fun.

---

## Quickstart — 2 minutes, zero accounts

```bash
git clone https://github.com/merak3i/meow-ops.git
cd meow-ops
npm install
node sync/export-local.mjs    # parses ~/.claude/projects → public/data/sessions.json
npm run dev                   # opens http://localhost:5176
```

Your real session data loads on the first page hit. Click **Sync** in the sidebar to refresh after new sessions.

---

## Deploy as a PWA (dock-installable, works everywhere)

This path lets you install Meow Operations to your macOS dock or iOS home screen and access it from any device.

### 1. Supabase Storage (free tier)

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

### 4. Auto-sync hourly

```bash
cp sync/launchd-example.plist ~/Library/LaunchAgents/com.meow-ops.sync.plist
# Edit paths in the plist, then:
launchctl load ~/Library/LaunchAgents/com.meow-ops.sync.plist
```

### 5. Install to dock

1. Open your Vercel URL in Chrome
2. Address bar → install icon
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
| Animation | Framer Motion |
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

## Contributing

Every feature on the roadmap is an open issue. The highest-impact contributions:

**Parsers (new model support)**
- `sync/parse-cursor.mjs` — Cursor session logs
- `sync/parse-aider.mjs` — Aider chat history
- `sync/parse-gemini.mjs` — Gemini CLI

**Analytics**
- Token value index (link sessions to git commits)
- Session quality score (output tokens / ghost ratio / tool diversity)
- Model comparison view (same project, different models, side-by-side cost)

**Companion**
- New cat types / classifier rules for new tools
- Accessory system (unlockable items based on milestones)
- Sound design (purring on focus, chirps on breakthroughs)

**Agent Visualizer**
- Subagent tree parser (already partially built in `sync/parse-session.mjs`)
- Timeline component (D3 or custom SVG)
- Live replay mode (replay a session's agent operations at 10× speed)

**New model cost tables**
- Gemini 2.0 Flash / Pro
- Mistral Large / Small
- Llama 3.3 (Ollama cost estimation)

PRs welcome. Open an issue first for anything substantial.

---

## Pomodoro Breeds — Full Reference

Eight breeds, four tiers, Forest-style grow/ghost mechanics:

| Breed | Rarity | Unlock at |
|---|---|---|
| Persian | Common | Default |
| Siamese | Common | Default |
| Tabby | Common | Default |
| Tuxedo | Uncommon | 10 pomodoros |
| Calico | Uncommon | 25 pomodoros |
| Maine Coon | Rare | 50 pomodoros |
| Scottish Fold | Rare | 100 pomodoros |
| Sphynx | Legendary | 200 pomodoros |

Shiny variants (Golden, Prismatic, Celestial, Void) drop at increasing probability from your daily streak. All state is `localStorage`. Nothing is uploaded.

---

## Project Structure

```
meow-ops/
├── public/
│   ├── manifest.json            PWA manifest
│   ├── sw.js                    Service worker (network-first)
│   └── meow-*.png               Logos + favicon
├── src/
│   ├── analytics/               Velocity, efficiency, burn-rate, profile modules
│   ├── companion-v2/            WebGL companion — CatMesh, scene, shaders, IK, LOD
│   ├── components/              Charts, session table, stat cards, date filter
│   ├── pages/                   Overview, Sessions, ByDay, ByProject, ByAction,
│   │                            CostTracker, LiveSessions, Pomodoro, AnalyticsDashboard
│   ├── state/
│   │   └── companionMachine.ts  XState machine — emotional states, cursor tracking
│   ├── types/
│   │   └── session.ts           Single source of truth for all session types
│   └── lib/
│       ├── format.ts            Number/date formatters
│       ├── queries.js           Data fetching, prod/dev source switching
│       └── supabase.js          Storage client
├── sync/
│   ├── parse-session.mjs        JSONL parser (shared)
│   ├── cost-calculator.mjs      Multi-model pricing (Claude + OpenAI)
│   ├── export-local.mjs         ~/.claude/projects → sessions.json
│   ├── upload-to-supabase.mjs   Push to Storage bucket
│   ├── full-sync.mjs            export + upload
│   └── launchd-example.plist    macOS auto-sync template
├── db/                          Forward-looking DB migrations (Supabase PostgreSQL)
├── CHANGELOG.md
├── ROLLBACK.md
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
