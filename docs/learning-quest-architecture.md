# Learning Quest architecture

## Outcome

Learning Quest turns approved generic competencies into a local learning game. Code is the main quest. Product, marketing, GTM, and sales are optional side quests that unlock from relevant technical milestones.

The public repository contains the reusable engine and synthetic examples. Personal curricula, progress, project links, answers, and proof remain outside Git under `~/.meow-ops/learning-quest/`.

## Trust boundaries

1. Project learning state and evidence are private source material.
2. The local helper is the only process allowed to read private learning records.
3. Learning Quest stores only owner-approved generic competencies.
4. The browser receives a constructed allowlist projection, never serialized storage records.
5. The hosted UI may read the safe Learning Quest projection but cannot read Project Control or Project Intelligence records.
6. Every browser write requires a fresh one-use owner nonce.
7. Portfolio output is private unless separately previewed and approved.

## Projection contract

Allowed topic fields:

- opaque topic ID
- generic title and summary
- learning lane and difficulty
- generic tags and prerequisites
- derived mastery stage
- recall confidence, interval, refresh state, and due date
- generated generic question
- aggregate action and attempt counts

Forbidden output includes project IDs, repository details, filesystem paths, learning-state files, raw evidence, artifacts, metadata, timestamps from source systems, session records, prompts, excerpts, customer details, and private content.

Projection is deny-by-default. A topic is invisible until `approved_for_projection` is explicitly true. Private linkage may exist in local storage but is omitted from every response.

## Mastery model

Stages are derived from append-only evidence events and cannot be directly assigned.

| Stage | Required evidence |
|---|---|
| Discovered | lesson opened and concept preview completed |
| Practiced | exercise attempted and code changed |
| Proven | tests passed, broken case repaired, and Feynman explanation passed |
| Shipped | verified commit, PR, release, or production proof |

A failed recall check never erases an earned stage. It lowers current confidence, adds a refresh requirement, and schedules a nearer check.

## Recall model

The supported intervals are `0, 1, 3, 7, 14, 30, 60, 90, 180, 270, 360` days. Successful recall advances through the schedule. Failed recall keeps history intact and returns the concept to the adaptive queue.

Question forms rotate across analogy, prediction, debugging, architecture, and transfer. Deterministic questions are the baseline. A future local-LLM generator may propose variations only from approved generic concepts, and every generated question must pass safety and answerability validation before use.

## Learning analytics

The north star is durable capability: retained understanding, independent application, transfer, and verified shipping.

Capture only bounded learning signals:

- action and variation
- result, attempts, duration, and hint count
- AI-assistance tier
- confidence before and after
- numeric accuracy, clarity, causality, and transfer rubrics
- opaque proof fingerprint
- lane and derived stage
- recall interval and outcome

Do not store answers, code, paths, project metadata, source excerpts, or raw proof in analytics.

Primary analysis:

- durable recall through 360 days
- transfer strength across contexts
- AI-independence trend
- recurring error category
- Feynman explanation quality
- confidence calibration
- stage bottlenecks
- cross-lane transfer
- fatigue and repeated-failure guardrails

The browser receives aggregates only: rates, averages, counts, stage funnels, and lane summaries. Event IDs, event times, proof fingerprints, topic-project links, and raw event rows are never projected.

## Curriculum

The built-in seed contains the 12-project agent-engineering code spine plus four optional product, marketing, GTM, and sales side quests. `npm run learning:seed` writes it to the private local store. A private Git project link may be supplied through `MEOW_LEARNING_PROJECT_ROOT`; it is stored locally, never printed, and never included in the browser projection.

The detailed workshop sequence, free learning shelf, and local-LLM capstone are in `docs/learning-quest-syllabus.md`.

The existing `Patherle Agent Lab Weekend` heartbeat remains the time-based entry point. Each run must read the safe snapshot first, choose one incomplete or recall-due topic, ask one question at a time, and record only bounded actions through the local API. Scheduling never advances mastery.

## Delivery phases

1. Private ledger, stage derivation, recall scheduler, safe projection, and API boundary.
2. Topic CRUD, learning map, question sessions, and evidence capture UI.
3. Analytics, adaptive queue, rewards, side quests, and Companion integration.
4. Weekend automation integration, maintenance guide, security pass, browser QA, PR verification, and launch.

Each phase must pass focused unit and negative tests, the full sync suite, lint, typecheck, and production build before the next phase stacks on it.

## Rollback

Code rolls back through the phase PR. Local quest data is append-only; destructive topic deletion affects the topic catalog but preserves the event ledger. No migration may rewrite project learning state or the private evidence vault.

## Launch gate

- Launch step: merge all verified Learning Quest phases and verify one complete local learning flow.
- Owner: Vismay Hegde.
- Target date: 2026-07-31.
- Ship-ugly fallback: local-only topic CRUD, evidence-derived stages, deterministic recall questions, and the safe projection. Local-LLM variations and decorative reward depth may follow only if the complete core flow is already live.
