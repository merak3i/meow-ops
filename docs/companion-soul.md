# Companion Soul Studio

Soul Studio is Phase 3 of Companion's Project Intelligence build. It lets the owner personalize Companion without weakening the evidence system introduced in Phases 0 to 2.

## Phase 3A: private soul profile

Shipped:

- Four foundations: Clear Operator, Warm Strategist, Critical Partner, and Curious Explorer.
- A custom owner meta-prompt of up to 100,000 characters.
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

## Phase 3B: inherited project souls

Shipped:

- Up to 24 project-specific soul layers in the same private, versioned profile.
- Project matching through the project's canonical name, ID, and owner-confirmed aliases.
- Global inheritance by default, with an optional project-only working-style override.
- Up to 12,000 characters of project-only instructions per layer.
- Active project-soul metadata on each Companion answer.

A project soul never duplicates or replaces the owner meta-prompt. The effective instruction order is global preset, uncertainty posture, owner meta-prompt, matching project layer, then the locked evidence contract. Paused layers remain saved but cannot activate.

## Local routes

- `GET /companion/soul` returns the current private profile and available presets.
- `POST /companion/soul` validates and appends one profile revision with a nonce.
- `POST /companion/soul/reset` appends the default profile with a nonce.

## Phased follow-through

Phase 3C should propose preference changes from repeated interaction patterns, but every proposal must remain review-only until the owner confirms it. Preference learning must store allowlisted feedback signals rather than raw conversation content.
