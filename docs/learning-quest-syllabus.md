# Learning Quest syllabus

## Rhythm

Use one 3-4 hour weekend workshop per project. The calendar is a guide, not a deadline. If evidence is incomplete, repeat the project instead of advancing the stage manually.

1. `20 min` - open the lesson, preview the concept, and answer one prediction question.
2. `90 min` - build the smallest working slice with AI scaffolding; explain every critical boundary before accepting generated code.
3. `45 min` - repair an intentionally broken case and run deterministic tests.
4. `25 min` - give a Feynman explanation: mechanism, boundary, failure case, and transfer example.
5. `20 min` - verify a commit and choose one optional product, marketing, GTM, or sales side quest.

Recall runs after `1, 3, 7, 14, 30, 60, 90, 180, 270, and 360` successful-day intervals. A failed check schedules a one-day refresh but never removes an earned stage.

## Code spine

| Order | Project | Layman model | Minimum proof |
|---|---|---|---|
| 1 | Structured Output Agent | A customs desk rejects malformed packages | Schema tests, repair retry, validation log |
| 2 | Grounded RAG Agent | An open-book answer must show its page references | Citation coverage and low-confidence fallback |
| 3 | ReAct Planning Agent | A technician follows a checklist with a stop rule | Iteration cap and graceful degraded result |
| 4 | Multi-Tool Orchestrator | A dispatcher assigns allowed specialists | Permission denial, parallel execution, conflict test |
| 5 | Memory Conversational Agent | A desk buffer plus a labeled archive | Relevance score, compression, cross-session recall |
| 6 | Human Approval Agent | A safety gate pauses consequential uncertainty | Pause/resume, validated input, immutable audit event |
| 7 | Cost-Aware Router | A travel desk picks the cheapest capable vehicle | Budget guard, early exit, cost-per-decision report |
| 8 | Event Automation Agent | A mailroom delivers once and quarantines failures | Idempotency, retries, dead-letter replay |
| 9 | Multi-Agent Debate | Specialists propose; a chair compares evidence | Independent critic, consensus, confidence output |
| 10 | Self-Reflective Auto-Eval | A maker builds and a rubric inspects | Baseline, constrained retry, measured improvement |
| 11 | Observable Production Agent | A flight recorder exposes failures before users do | Traces, alerts, canary, rollback drill |
| 12 | Open Source Contribution | Public trust comes from proof others can reproduce | Tests, docs, benchmark, reviewed PR |

## Side quests

Side quests are asynchronous and optional. They unlock from shipped technical proof rather than replacing code practice.

- Product: translate a mechanism into a user promise and acceptance condition.
- Marketing: tell a before, mechanism, and verified-after proof story.
- GTM: match the proof to an audience, adoption barrier, and channel.
- Sales: connect pain, qualification, verified capability, and an honest next commitment.

## Free learning shelf

Use these as references, not prerequisites:

- Hugging Face Agents Course: https://huggingface.co/learn/agents-course/unit0/introduction - free, self-paced, with optional free certification and a suggested 3-4 hours per week.
- Practical Deep Learning for Coders: https://course.fast.ai/ - free and self-paced foundations for training and evaluating neural networks.
- Neural Networks: Zero to Hero: https://github.com/karpathy/nn-zero-to-hero - free from-scratch neural-network and GPT lectures.
- build-nanogpt: https://github.com/karpathy/build-nanogpt - step-by-step GPT-2 reproduction from an empty file.
- nanoGPT: https://github.com/karpathy/nanoGPT - a small open implementation for local experiments after the foundations are proven.

## Local LLM capstone

Run this after Project 10, in parallel with Projects 11-12:

1. Implement a tiny tokenizer and bigram baseline locally.
2. Implement embeddings, attention, the transformer block, training loop, and sampling without copying a complete framework implementation.
3. Train only a small model that fits owned hardware and a non-sensitive dataset.
4. Add deterministic evaluation, checkpoints, resource measurements, and a reproducible model card.
5. Use the local model only for optional question variation after its output passes the same generic-concept projection and safety checks as deterministic questions.

The capstone is successful when the learner can explain tensor shapes, causal masking, loss, backpropagation, sampling, overfitting, and evaluation without relying on library names.
