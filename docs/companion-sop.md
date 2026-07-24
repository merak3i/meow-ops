# Meow Ops Companion - Plain-English SOP

Updated: 25 July 2026

## What Companion does

Companion is the local-first copilot inside Meow Ops. It can answer questions about your sessions, projects, changes, spending, sync health, and next actions. It uses local Meow Ops evidence first and labels when a model is helping with an unknown.

## Before you start

1. Open [Meow Ops](https://meow-ops.vercel.app).
2. Keep the Meow Ops local helper running on your Mac.
3. Click **Sync sessions** if the dashboard looks out of date.
4. Open **Companion** from the bottom-right button.

If the page was already open during an update and shows a missing-module error, refresh the page once.

## Ask Companion about your work

Use ordinary language. Useful examples:

- Which project took the most time this week?
- What changed today?
- Is sync healthy?
- What should I fix next?
- What don't you know about BergLabs?
- What happened in LCWI project in the last 3 days?
- What features were worked on according to the GitHub PR?
- What should I learn next?
- What recall is due?

Companion will prefer known local evidence. If the evidence is incomplete, it should say so instead of pretending certainty. Expand **Why I answered this way** below an answer to inspect its evidence and unknowns.

Project-activity answers resolve the registered project and aliases first, apply the requested time window, then read the private project-evidence vault and the registered checkout's local Git history. A GitHub PR mentioned in a local merge commit is labeled as local Git evidence; Companion does not imply that it made a live GitHub API request. If a named project is not registered, Companion must ask for that project instead of substituting another project's activity.

Project time is labeled **recorded agent-session span**, not focused human work time. Long-lived or overlapping threads can exceed the calendar window. When that happens, Companion refuses to present the total as human time and offers sessions, tokens, or commits as safer ranking signals.

For sync-health answers, **complete local archive** means the uncapped append-only history used for all-time reporting. **Browser compatibility preview** means the newest bounded set used by older dashboard views. The preview is not the all-time session total.

## Personalize Companion in Soul Studio

1. Open Companion.
2. Click the settings button in the chat header to open **Soul Studio**.
3. Choose a foundation:
   - **Clear Operator** for short, action-first answers.
   - **Warm Strategist** for supportive, decision-oriented answers.
   - **Critical Partner** for direct challenge and stronger focus protection.
   - **Curious Explorer** for patterns, possibilities, and missing questions.
4. Set your response style:
   - **Answer length:** concise, balanced, or detailed.
   - **Challenge style:** gentle, balanced, or direct.
   - **Exploration:** focused, balanced, or expansive.
5. Add your **Owner meta-prompt**. It accepts up to 100,000 characters.
6. Click **Save soul**.

The owner meta-prompt is your durable operating guidance. Good content includes your goals, decision rules, preferred communication style, recurring workflows, boundaries, and how you want assumptions challenged.

## Add project-specific souls

Project souls add focused guidance on top of the owner soul.

1. In Soul Studio, go to **Project souls**.
2. Add or select a project.
3. Add project-specific instructions and response-style overrides.
4. Save the soul.

Companion can keep up to 24 project souls. A project soul inherits the owner meta-prompt and only changes the fields you explicitly override. Evidence and privacy gates cannot be weakened by a project soul.

Project names, repository roots, Git remotes, and aliases are governed in **Project Control**. Use **Teach** for an owner-confirmed alias fact; use the local Project Control registration flow when Companion must read a project's local Git history.

## Teach Companion a project fact

Use **Teach** in the Companion chat when you want to add a durable owner-confirmed fact: an alias, vision, mission, current outcome, current phase, priority, constraint, or non-goal. Keep facts specific and state which project they belong to. A taught fact is owner-confirmed evidence; it remains distinct from facts observed in session data.

## Tune a response safely

After an answer, choose **Tune this response** and select one signal:

- Too long
- Needs more depth
- Challenge me more
- Too harsh
- Too speculative
- Explore more

Companion stores only the feedback category and safe technical references. It does not copy the raw question or answer into the learning ledger.

After three matching signals within 30 days, Companion creates a suggested refinement in Soul Studio. It never changes its soul automatically.

In **Suggested refinements**, the owner can:

- **Apply to soul** to accept the change.
- **Dismiss** to reject it.

## Use Companion with Builder's Journey

Companion reads only the safe aggregate Builder's Journey snapshot. Ask **What should I learn next?**, **Resume my workshop**, or **What recall is due?** Companion can name the next evidence step and direct you to Builder's Journey, but it cannot record learning progress from chat.

Builder's Journey uses these controls:

- A proof task opens before an action can be recorded. Read the lesson or do the work in its real surface, then confirm honestly.
- Code, product, marketing, GTM, and sales paths use lane-specific practice and proof actions.
- Code shipping requires verifier-owned local Git proof. A browser event cannot claim a PR, release, or production proof by supplying its own fingerprint.
- Product, marketing, GTM, and sales finish through a lane-bound owner confirmation with a private local evidence note. The screen clearly labels this as owner-confirmed, not automated external verification.
- Recall, including a failed retry, cannot be repeated before its server-derived due time. Untouched topics are not reported as recall due.
- A local Git proof cannot be reused.
- An active workshop topic cannot be deleted. Finish or explicitly leave the workshop first.
- First-principles answers stay in the browser tab. The four-dimension rubric is an owner self-check, not an automated truth score.

## How to read the evidence labels

- **Local reasoning:** Deterministic answer from local Meow Ops evidence.
- **Model-assisted:** A model helped interpret an unknown or incomplete area.
- **Unknown:** The available evidence does not support a reliable answer yet.

The answer badge adds more context: **Verified**, **Needs teaching**, **Hypothesis**, or **Blind spot**. Expand **Why I answered this way** before using an answer for an important decision.

## Privacy and control

- Soul data and preference-learning data stay in the local Meow Ops helper.
- Raw chat questions and responses are not written to the preference-learning ledger.
- Preference changes require owner review.
- Project souls cannot override locked evidence, privacy, or safety rules.
- Do not place passwords, API keys, recovery codes, or other secrets in a meta-prompt or project soul.

## Quick troubleshooting

- **Helper offline:** Restart the Meow Ops local helper, then reopen Companion.
- **Old data:** Click **Sync sessions** and wait for the sync to finish.
- **Missing page module after a release:** Refresh the browser once.
- **No project-specific answer:** Check the project registration and aliases in Project Control, then sync again.
- **No project activity:** Confirm the registered local checkout exists and has been updated. Companion reads local Git; it does not silently fall back to another project.
- **Companion asks a recovery question:** Answer it in the composer or use **Teach Companion** when offered. Clicking the question focuses the composer; it never sends the assistant's own question back as a user message.
- **Learning action rejected:** Read the exact helper reason. Recall may not be due, shipped proof may require the local verifier, or an active workshop may need to be finished or left first.
- **No suggested refinement:** It needs three matching feedback signals within 30 days.
- **Unexpected tone:** Review the foundation, response-style controls, owner meta-prompt, and the active project soul.

## Release record

- Feature phases complete through Companion Project Intelligence Phase 3C.
- Companion Project Intelligence release: [#57](https://github.com/merak3i/meow-ops/pull/57)
- Complete session archive and all-time reporting release: [#59](https://github.com/merak3i/meow-ops/pull/59)
- Companion SOP validation and evidence-label alignment: [#60](https://github.com/merak3i/meow-ops/pull/60)
- Production: [meow-ops.vercel.app](https://meow-ops.vercel.app)
