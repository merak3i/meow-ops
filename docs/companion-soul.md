# Companion Soul Studio

Soul Studio is Phase 3 of Companion's Project Intelligence build. It lets the owner personalize Companion without weakening the evidence system introduced in Phases 0 to 2.

## Phase 3A: private soul profile

Shipped:

- Four foundations: Clear Operator, Warm Strategist, Critical Partner, and Curious Explorer.
- A custom owner meta-prompt of up to 8,000 characters.
- Strict, evidence-led, and exploratory uncertainty postures.
- Separate permissions for session metrics, confirmed project facts, inferred claims, and model synthesis.
- Append-only profile revisions under `~/.meow-ops/companion/soul.jsonl`.

The active profile changes model synthesis, memory availability, Companion's displayed name, and how it approaches uncertainty. Deterministic evidence answers stay compact and retain their original truth status.

## Locked evidence contract

Personality cannot override the four evidence gates:

- Known known: answer from verified local evidence.
- Known unknown: name the missing fact and ask one focused question.
- Unknown known: label a hypothesis and invite confirmation.
- Unknown unknown: label the blind spot and keep synthesis unverified.

Soul instructions cannot approve proposals, execute changes, invent project facts, or remove evidence labels.

## Local routes

- `GET /companion/soul` returns the current private profile and available presets.
- `POST /companion/soul` validates and appends one profile revision with a nonce.
- `POST /companion/soul/reset` appends the default profile with a nonce.

## Phased follow-through

Phase 3B should add project-specific overlays, so one global soul can adapt to BergLabs, Patherle, or Meow Ops without duplicating the base meta-prompt. Phase 3C should propose preference changes from repeated interaction patterns, but every proposal must remain review-only until the owner confirms it.
