# Codex Rollout Fixtures

These fixtures are anonymized from real Codex Desktop rollout JSONL samples and
trimmed to keep only parser-relevant structure.

Redactions applied:
- `cwd` paths normalized to `/workspace/...`
- user/assistant text content replaced with neutral placeholders
- tool arguments and outputs reduced to non-sensitive stubs
- ids replaced with synthetic values (`sample-*`, `call-*`)

Goal: protect `sync/parse-codex.mjs` against schema drift in streamed events
without including personal or proprietary content.
