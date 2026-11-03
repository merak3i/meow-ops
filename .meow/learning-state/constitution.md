# Project Constitution

## Mission

Meow Ops is the local inbox for AI coding work. It shows what happened, what it cost, and what you should decide next. Nothing applies until the owner says so.

## Primary outcome

An operator opens Meow Ops and can answer, in one sitting:

1. What did my agents do in this range?
2. What did that cost, and which project burned it?
3. What proposed change is waiting on me?

## Success measures

- Primary navigation is six words: Today, Review, Ledger, Swarm, Sanctum, Learn.
- The focus timer is a chip on every screen, never a page.
- Companion is removed from the product.
- Every number declares its date range, sources, and archive vs preview.
- Codex, Claude Code, Hermes, Antigravity, and Cursor share one evidence model.
- Missing vendor fields show as unavailable. Never invented.
- Approved learning reaches native agent files only after preview and one-use approval.

## Constraints

- Local-first. No required cloud, account, telemetry, or analytics-on-analytics.
- No agent approves its own learning or consequential write.
- Raw transcripts, secrets, and unapproved proposals stay out of Git.
- Meow Ops governs context and decisions. Native agents own coding execution.
- Swarm orchestrates through AutoSwarm only. Work starts on an explicit owner dispatch, every acting route needs a one-use owner nonce, and approvals or answers are relayed only from the owner's own click.

## Non-goals

- Rebuilding five coding agents inside Meow Ops.
- A living companion, a second chat product, or seven charts of the same dataset as primary product.
- Autonomous consequential writes without an owner preview.

## Product laws

1. One job. If a feature cannot serve what happened, what it cost, or what to decide next, it is a room, not a surface. Sanctum and Learn are the two allowed rooms.
2. Every figure declares range, source, and completeness.
3. A new feature joins Today, Review, Ledger, or Swarm. Sanctum and Learn do not grow new siblings.
4. Helper-down is one banner. Pages do not invent their own offline story.
5. A name that needs a glossary entry is the wrong name.

## Current phase

Cut the UI to match this mission. Today, Review, Ledger, Swarm, Sanctum, Learn. Timer as chrome. Companion deleted.

## Amendments

- 2026-11-03, owner decision: Swarm becomes a primary surface (sixth sidebar item) for orchestrating native agents through AutoSwarm. Provenance: the owner asked for Swarm to have its own sidebar button and a control panel in the Meow Ops session of 2026-11-03. Canonical once the owner approves merging `feat/swarm-control`. Review: at the next navigation review, or by 2027-02-03. Rollback: remove the `swarm` surface from `src/components/nav-config.ts` (its legacy routes keep old links working) and restore the five-word line and Law 3 above.
