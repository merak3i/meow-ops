# Project Intelligence

Project Intelligence lets Companion answer project-time questions from the complete local session artifact and learn owner-confirmed mission, vision, outcome, phase, priority, constraint, and non-goal facts.

Use **Teach** in the Companion context bar to save one fact at a time. Project facts are appended outside the worktree under `~/.meow-ops/project-intelligence/`; raw prompts, transcript content, cwd values, and arbitrary metadata are rejected.

Every project answer carries one evidence gate:

- **Verified** — a fresh metric or owner-confirmed fact.
- **Needs teaching** — a specific known gap that Companion asks you to fill.
- **Hypothesis** — a local pattern or imported claim that still needs confirmation.
- **Blind spot** — the required evidence source or reasoning path is not available yet.

Use **Why I answered this way** to inspect evidence, **Confirm** to promote a hypothesis, and **Correct** to append a replacement. Corrections never rewrite history. Project learning does not approve proposals or execute changes.

## Local routes

- `POST /loop-eng/ask` — deterministic project questions plus evidence gates.
- `GET /project-intelligence/snapshot` — local project coverage and current claims.
- `POST /project-intelligence/claims` — append one owner-confirmed fact with a nonce.
- `POST /project-intelligence/confirm` — promote one inferred claim with a nonce.

Project and confirmation writes stay local. The hosted demo cannot read or mutate the private ledger without the localhost helper.

## Phased build

- Phases 0 to 2: deterministic project metrics, private project facts, and the four evidence gates.
- Phase 3A: [Companion Soul Studio](./companion-soul.md) for owner-controlled personality, meta-prompts, uncertainty posture, and memory permissions.
- Phase 3B: inherited project-specific soul overlays with alias-aware runtime activation.
- Phase 3C: planned review-only preference proposals from repeated patterns.
