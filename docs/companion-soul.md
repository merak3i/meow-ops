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
- `GET /companion/preferences` returns review-only preference suggestions and the learning policy.
- `POST /companion/feedback` records one allowlisted metadata signal for one response with a nonce.
- `POST /companion/preferences/decision` applies or dismisses one reviewed suggestion with a nonce.

## Phase 3C: review-only preference learning

Shipped:

- Direct response-style controls for answer length, challenge, and exploration.
- Six allowlisted feedback signals: too long, needs more depth, challenge me more, too harsh, too speculative, and explore more.
- One signal per Companion response, stored as metadata only in `~/.meow-ops/companion/preferences.jsonl`.
- A review-only suggestion after three matching signals within 30 days.
- Global suggestions and project-only suggestions when the answer used a project soul.
- Owner Apply and Dismiss actions in Soul Studio. Suggestions never auto-apply.

The preference ledger stores a generated response reference, signal ID, evidence gate, soul revision, project ID when applicable, and timestamp. It does not store the question, answer, transcript, prompt, or arbitrary metadata. Applying a suggestion appends a normal soul revision, so the result remains versioned and inspectable.

## Phase status

The planned Companion Project Intelligence build through Phase 3C is complete. Future expansion should use the same pattern: local evidence, allowlisted metadata, owner-visible review, and no silent mutation.
