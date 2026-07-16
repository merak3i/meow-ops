# Meow Ops Companion - Plain-English SOP

Updated: 17 July 2026

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

Companion will prefer known local evidence. If the evidence is incomplete, it should say so instead of pretending certainty. Expand **Why I answered this way** below an answer to inspect its evidence and unknowns.

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
3. Add project-specific instructions, aliases, and response-style overrides.
4. Save the soul.

Companion can keep up to 24 project souls. A project soul inherits the owner meta-prompt and only changes the fields you explicitly override. Evidence and privacy gates cannot be weakened by a project soul.

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
- **No project-specific answer:** Check the project name and aliases in its project soul, then sync again.
- **No suggested refinement:** It needs three matching feedback signals within 30 days.
- **Unexpected tone:** Review the foundation, response-style controls, owner meta-prompt, and the active project soul.

## Release record

- Feature phases complete through Companion Project Intelligence Phase 3C.
- Companion Project Intelligence release: [#57](https://github.com/merak3i/meow-ops/pull/57)
- Complete session archive and all-time reporting release: [#59](https://github.com/merak3i/meow-ops/pull/59)
- Production: [meow-ops.vercel.app](https://meow-ops.vercel.app)
