# ADR 0001: Local Usage Receipt v1

Status: Proposed (draft, not implemented)

Base: `main` at `a9c630b` (PR #79, Hermes per-model usage)

This ADR records a read-only evidence audit of local and open-model usage sources, then freezes a versioned receipt contract for moving sanitized invocation evidence between computers. It does not add adapters.

## Decision

Meow Ops may record a model only when a durable source shows that the model was invoked. Installed, downloaded, selected, or currently loaded models are inventory, not usage.

Cross-machine merge uses a Local Usage Receipt v1 file that the owner copies by hand. Default transport is manual export and import. There is no LAN discovery, hosted database, automatic upload, or credential transfer.

Tokens, model, session, and cost are copied only when the source exposes them. Missing data is `available: false` with no value. Explicit `0` is valid only when the source recorded zero. Cost `$0` and cost unavailable are different states. Local cost is never estimated from electricity. Receipt `total` is source-only and is never a derived sum.

## Why a receipt

PR #79 already reads Hermes `session_model_usage` on one machine. Direct Ollama and LM Studio inventories still prove nothing about who called which model. Most inference servers expose usage only on the live HTTP response. Chat UIs that do persist history usually mix prompts into the same row.

A receipt is the smallest object that can leave one computer without taking transcripts, paths, or secrets with it.

## Evidence rules

- Official documentation or upstream source is required. Community blogs and third-party dashboards are labeled Not verified.
- Inventory APIs (`/api/tags`, `/v1/models`, `lms ps`, `/api/ps`) are unsupported as usage sources.
- A selected or loaded model is not historical usage.
- Read-only parsing is required. WAL sidecar files may be read. The source must not be written.
- Mixed prompt stores may be read only through a metrics projection that never persists content.
- Existing Meow Ops session history already rejects `cwd`, `session_title`, and `first_user_message`. Receipts follow the same boundary.

## Evidence matrix

Adapter status values: `build now`, `aggregate-only`, `receipt required`, `unsupported`.

| Source | Durable store | Invocations | Exact model | Runtime / provider | Session id | Tokens | Cost | Tools | Time | Prompts mixed | Read-only | Drift | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hermes Agent | `~/.hermes/state.db` tables `sessions` and `session_model_usage` | Yes. `session_model_usage` is written when a model is used. Official schema version 23. PK is session, model, billing_provider, billing_base_url, billing_mode, task. | Yes. `model` on the usage row, not the currently selected model. | Yes. `billing_provider`, `billing_mode`. `billing_base_url` exists but must not be exported raw. | Yes. `session_id`. | Yes when present: input, output, cache_read, cache_write, reasoning. | Yes when present: `estimated_cost_usd`, `actual_cost_usd`, `cost_source`. Zero is accepted only when Hermes stored zero. | Yes. `messages.tool_name` and `sessions.tool_call_count`. | Yes. `first_seen`, `last_seen`, session `started_at` / `ended_at`. | Yes in `messages` and `system_prompts`. Usage table is metrics. | Yes. Meow Ops already uses `sqlite3 -readonly`. | High. v20 seeded the table. v22 rebuilt the PK to add `task`. | `build now` (same-machine parser shipped in PR #79). Receipt emitter next. |
| Ollama server | Live `POST /api/generate` and `/api/chat` responses. Official usage fields: `prompt_eval_count`, `eval_count`, `model`, `created_at`. | Live response only. No official durable invocation ledger. | Yes on the response. `GET /api/tags` is inventory. `GET /api/ps` is currently loaded. | Runtime is Ollama. No historical provider ledger. | No official session id on the generate/chat usage object. | Input/output on the final chunk. No official cache or reasoning categories. | No. | No official tool-call usage log. | `created_at` on the response. | Response body includes the generated text. | Live call is not a historical read. | API is documented as stable, not strictly versioned. | `receipt required`. Inventory endpoints are `unsupported`. |
| Ollama Desktop | Community reports of a SQLite chat store. Not in official API docs. | Not verified. | Not verified. | Not verified. | Not verified. | Not verified. Access logs, if present, are HTTP counts, not tokens. | No official cost. | Not verified. | Not verified. | Likely, if chats are stored. | Not verified. | Not verified. | `receipt required` until official schema is published. |
| LM Studio | Official: conversations under `~/.lmstudio/conversations/` as JSON. Official warning: do not rely on that structure. Server logs under `~/.lmstudio/server-logs`. Live `lms log stream`. REST `/v1/chat/completions` and `/api/v0/chat/completions` return `usage`. | Live API and chat UI turns. Durable file schema is unstable. | API `model` / `model_instance_id`. `lms ps` and `/v1/models` are loaded or installed. | Runtime is LM Studio. Response may include a `runtime` object. | Conversation ids exist in the UI store. Official schema is unstable. | API `usage.prompt_tokens` / `completion_tokens`. Native `stats.input_tokens`, `total_output_tokens`, `reasoning_output_tokens`. | No official local cost. | Tool calls appear in API choices. Not a durable usage ledger. | API `created`. Log timestamps. | Yes. Conversations and `lms log stream --filter input,output` are prompt-bearing. | Conversation files can be read. Schema is not a contract. | High. Official docs say the conversation format may change. | `receipt required`. Inventory and loaded-model lists are `unsupported`. |
| llama.cpp `llama-server` | Optional `--log-file`. Optional `--log-prompts-dir` (debug, prompt-bearing). `GET /metrics` Prometheus counters. OpenAI-compatible `/v1/chat/completions` returns `usage`. | Live response or operator-enabled logs. `/metrics` is process-lifetime aggregate, not per-request history. `/slots` is current state. | Response `model` is often the server alias, not a GGUF digest. `--cache-list` is inventory. | Runtime is llama.cpp. | No official durable session id. | Response `usage.prompt_tokens`, `completion_tokens`, `total_tokens` when the server emits them. Metrics counters are totals only. | No. | Function-calling responses may include tool calls. Not a usage ledger. | Log timestamps if enabled. | `--log-prompts-dir` and verbose logs mix prompts. | Optional log files can be read. Default install has no durable usage file. | High. Server README and flags change often. | `receipt required`. `/metrics` is `aggregate-only`. |
| LocalAI | Auth database at `{DataPath}/database.db` or `LOCALAI_AUTH_DATABASE_URL`. Usage APIs exist only when `LOCALAI_AUTH=true`. Traces are a bounded ring under the data path. | Yes when auth is on: per-request token rows aggregated by the Usage API. Without auth, no official usage ledger. | Usage rows include model. `/v1/models` is inventory. | Endpoint name is stored. Backend traces include backend name and can include request bodies. | Auth session cookies are not model-session ids. Usage API returns time buckets, not a documented per-request id. | Prompt, completion, total when auth tracking is on. | No official local cost. | Not in the documented usage payload. | Yes. Time-series buckets. | Traces and middleware events can store bodies. Usage API is aggregate metrics. | Usage API needs a credential. Direct SQLite read is possible but schema is not fully published. | Medium. Auth usage gained a `source` column and a backfill. | `aggregate-only` when auth is enabled and the owner supplies a local key. Otherwise `receipt required`. Do not transfer that key. |
| vLLM | Live OpenAI response `usage`. Optional `--enable-per-request-metrics`. `/metrics` Prometheus. Optional `--enable-log-requests` / `--enable-log-outputs`. Optional OTLP. | Live response or operator logging. No default durable per-request store. | Response model. Served model list is inventory. | Runtime is vLLM. | Request ids are ephemeral unless the operator exports traces. | `prompt_tokens`, `completion_tokens`. Cached tokens via optional headers. | No official local cost. | Not a usage ledger. | Prometheus and OTLP timestamps if configured. | Request/output logs can include prompts. | Only if the operator already persisted logs. | Medium. Flags and response shapes are still changing. | `receipt required`. `/metrics` is `aggregate-only`. |
| Jan | Data folder `threads/<thread_id>/thread.json` and `messages.jsonl`. Official data-folder docs. | Thread files are conversations, not an invocation ledger. | `thread.json` `model` is documented as active or selected model settings. That is not historical per-call usage. | `providers.json` is configuration, including keys. Never read it for usage. | Thread id. | `metadata.tokenSpeed.tokenCount` is speed metadata, not billed input/output categories. | No official cost. | Tool messages may exist. Not a usage ledger. | Thread and message timestamps. | Yes. Full message content. | Yes, files are local JSON. | High. Docs and in-app examples disagree on field names. | `unsupported` for model usage. Selected model is not an invocation. |
| Open WebUI | `{DATA_DIR}/webui.db` (default `./data/webui.db`). Official `chat_message` table. | Yes. One row per message. Assistant `model_id` is the model that produced the message. | Yes on assistant rows: `model_id`. | Not a separate runtime column. Model id may embed a provider prefix. Not verified as a stable runtime field. | Yes. `chat_id`. | `usage` JSON when the backend returned usage. Official analytics docs: input, output, total. Exact JSON keys can vary by backend. | No official local cost. Analytics docs mention cost estimation as a use case, not a stored field. | Not a first-class usage column. | `created_at`. | Yes. `content` and `output` are in the same row. | Yes, SQLite read-only. Postgres is also supported. | Medium. `migrate_history` plus v0.10 / v0.11 column adds. | `build now` only as a metrics projection after the receipt contract. Never persist content. |
| AnythingLLM | Desktop `storage/anythingllm.db`. Official storage paths use the OS app-data directory. Prisma `workspace_chats`. | Chat turns are persisted. | Workspace `chatModel` is the selected workspace model. Per-turn invoked model inside `response` JSON is Not verified in official schema. | Workspace `chatProvider` is selected provider. | `thread_id`, `api_session_id`, row `id`. | API history examples show `metrics.prompt_tokens`, `completion_tokens`, `total_tokens`. Official Prisma schema does not declare those columns. They live inside `response` JSON. | No official cost column. | Agent invocations are a separate table. Not verified as token usage. | `createdAt`. | Yes. `prompt` and `response` are the row. | Yes, SQLite read-only. | Medium. Prisma migrations. Response JSON is a blob. | `receipt required` until official docs pin per-turn model and metrics. |
| Continue | `~/.continue/sessions/<sessionId>.json` and `sessions.json`. Upstream `HistoryManager` and `Session` type. | Session files are written after turns. | `chatModelTitle` is the selected chat model title. Per-turn invoked model is Not verified as a required persisted field. | Provider name exists in logging paths. Not verified on every session file. | Yes. `sessionId`. | `session.usage` and newer per-turn `message.usage`: prompt, completion, cache read/write, optional reasoning. Upstream `_logEnd` also local-counts tokens, and PR #10568 falls back to local counting when the provider returns zero. | `totalCost` when the provider path supplied it. | History can include tool calls. | File mtime and in-session timestamps. Not a single official event time field. | Yes. `history` is the transcript. | Yes. | High. Usage persistence is recent and still migrating old `totalCost`-only files. | `receipt required` until persisted usage is proven provider-reported, not estimated. |
| Aider | Project `.aider.chat.history.md`. Official `--chat-history-file`. Optional `--llm-history-file`. | History blocks are real chats. Token summary lines are written after turns. | Only when the block contains `/model` or `Model:`. Meow Ops currently falls back to a default model name. That is inference and is not allowed for receipts. | Not a first-class field. | No official session id. The current parser synthesizes `aider-<project>-<index>`. | `#### tokens: N sent, M received`. No cache or reasoning categories. | Dollar amount on the same line when Aider printed it. | Commands such as `/run` appear in the markdown. Not structured tool-call usage. | Header `aider chat started at`. No official end time. | Yes. The file is the transcript. | Yes. | Medium. Line format is conventional, not a versioned schema. | Existing parser may keep time/tools. Exact model and local usage need a receipt or an explicit model line. Default-model fallback is a defect relative to this ADR. |
| OpenCode | Official data dir `~/.local/share/opencode/`. Documented DB `opencode-next.db` (v2 troubleshooting). Older installs and issues also mention `opencode.db`. Official session API: `model`, `tokens`, `cost`, `time`. | Yes. Sessions are first-class rows. | Yes when `model.id` is present. | Yes when `model.providerID` is present. | Yes. Session id. | Official `tokens.input`, `output`, `reasoning`, `cache.read`, `cache.write`. | Official `cost` as USD. | Messages and parts can include tools. | `time.created`, `time.updated`. | Yes. Message and part tables hold content. | Yes, SQLite read-only. Official export exists. | High. Flat files migrated to SQLite. DB filename already drifted. | `build now` as a metrics projection after a schema pin. Prefer official export if it can omit content. |
| Open Interpreter | Official: sessions under `~/.openinterpreter/`. Older code stores conversation JSON. | Conversations are transcripts. | Selected `--model` / config. Not a per-call ledger. | LiteLLM provider string in config. | Resume ids exist in newer docs. Older files are prompt-derived filenames. | `%tokens` is documented as experimental and estimates the next request. A usage-display PR falls back to estimated tokens for local models. | LiteLLM `cost_per_token` estimates. | Code-execution tools are in the transcript, not a usage ledger. | File timestamps. | Yes. | Yes. | High. Docs and storage layout differ across versions. | `unsupported` for tokens and cost. `receipt required` for model invocation. |
| Other OpenAI-compatible local servers | Live `/v1/chat/completions` `usage`. | Live response only unless the operator wraps the server. | Request/response `model`, often an alias. | Whatever the proxy label is. | No. | Only if `usage` is present. Many local servers omit it on streams unless `stream_options.include_usage` is set. | No. | Optional. | Response `created`. | Response includes content. | Not historical. | High. | `receipt required`. |

### Inventory endpoints (all unsupported as usage)

| Endpoint or UI | Why it is not usage |
| --- | --- |
| Ollama `GET /api/tags`, `ollama list` | Installed models. |
| Ollama `GET /api/ps` | Currently loaded models. |
| LM Studio `GET /v1/models`, `lms ps` | Installed or currently loaded. |
| llama.cpp `--cache-list`, `/slots` | Cache inventory or live slot state. |
| LocalAI / vLLM `/v1/models` | Served model list. |
| Jan `models/` and `providers.json` | Downloads and credentials. |
| Continue Ollama `AUTODETECT` | Scans installed Ollama models. |
| Meow Ops `sync/lmstudio-client.mjs` | Localhost intake caller. It does not read historical usage. |

## Local Usage Receipt v1

Machine-readable schema: [`docs/local-usage-receipt-v1.schema.json`](../local-usage-receipt-v1.schema.json).

### Envelope

```json
{
  "schema_version": "local-usage-receipt.v1",
  "kind": "meow-ops.local-usage-receipt",
  "machine_id": "550e8400-e29b-41d4-a716-446655440000",
  "exported_at": "2026-08-15T20:00:00.000Z",
  "events": []
}
```

`machine_id` is a random UUID stored once at `~/.meow-ops/machine-id` (mode `0600`, outside the git worktree). It is created with a CSPRNG. It is never derived from hardware serials, MAC addresses, hostname, username, or any path.

### Event

Required: `source_event_id`, `dedupe_key`, `harness`, `model`, `availability`, `provenance`.

Optional exact fields, only when the source exposes them: `runtime`, `provider`, `session_id`, `started_at`, `ended_at`, token categories, `cost_usd`, tool-call count or names.

`harness` must match `^[a-z0-9][a-z0-9._-]{0,63}$`. `source_event_id` and `source_label` reject control characters, absolute Unix paths, Windows drive/UNC paths, URLs, and emails. When the official key includes a URL or path, export a hex digest of the official fields. Hermes example: digest of `session_id`, `model`, `billing_provider`, `billing_mode`, and `task`. Do not export `billing_base_url`.

`dedupe_key` is the lowercase 64-character SHA-256 hex of the UTF-8 bytes of:

```
JSON.stringify([schema_version, machine_id, harness, source_event_id])
```

Exact array order. No whitespace formatting. No Unicode normalization. Newline-joined hashes are invalid because a newline inside `harness` or `source_event_id` would collide.

Import is append-only. A duplicate `dedupe_key` is skipped.

Token fields use `tokenQuantity` (non-negative integer). `cost_usd` uses `moneyQuantity` (non-negative finite number). When `available` is true, `value` and `provenance: "source"` are required. When `available` is false, `value` and `provenance` must be absent. Importers must never convert missing data into zero.

`tool_calls.available=false` forbids `count` and `names`. `available=true` requires at least `count` or `names`. Names are unique sanitized identifiers, not transcript text.

Receipt `tokens.total` is copied only when the source stored a total. Do not write a derived total into the receipt. After import, Meow Ops may show a display-only sum of available categories, labelled calculated. That display value must never be rewritten as source evidence.

### Availability and provenance

`availability.model` must be `exact`. `provenance.recorded_as` is always `invocation`. Selected or inventory provenance is rejected.

`schema_pin` identifies the upstream product or schema version (example: `hermes-schema-23`), not the word sqlite. `provenance.source_kind=sqlite` requires a non-empty `schema_pin`. Unknown pins are valid in the file schema and must be rejected by the future importer.

### Forbidden fields

`additionalProperties` is false on every object. The schema rejects control characters and path/URL-shaped ids. Importers must also reject secret-shaped strings and any of: `prompt`, `response`, `content`, `messages`, `history`, `transcript`, `cwd`, `path`, `hostname`, `username`, `email`, `user_id`, `api_key`, `authorization`, `system_prompt`, `session_title`, `first_user_message`, `display_name`.

### Transport

v1 transport is a UTF-8 JSON file the owner copies. Suggested name: `meow-ops-local-usage-receipt-v1.json` (no hostname). JSONL can wait until a later version if export size requires it.

Allowed: USB, AirDrop, owner-initiated `scp`, or any path the owner chooses.

Forbidden: LAN service discovery, multicast, hosted sync, automatic upload, emailing receipts from Meow Ops, and copying API keys or `providers.json`.

Import writes into the existing private history tree under `~/.meow-ops/`, never into the git worktree. Public `sessions.json` stays metrics-only.

## Trust and privacy boundaries

| Boundary | Rule |
| --- | --- |
| Invocation vs inventory | Only durable invocation records become events. |
| Same machine vs other machine | Same-machine adapters may read local DBs read-only. Other machines enter only through a receipt file the owner copied. |
| Mixed stores | A parser may read a prompt-bearing DB. It may persist only the receipt fields. Content, titles, and paths are dropped before disk. |
| Credentials | No adapter reads `providers.json`, `.env`, or auth databases for keys. LocalAI usage API, if used, stays on localhost and the key never leaves that machine. |
| Cost | Copy source cost or leave unavailable. Never invent a local electricity or GPU-hour price. |
| Identity | `machine_id` is random. Receipts do not carry usernames, hostnames, or absolute paths. |
| Hosted demo | Receipts are private. The hosted shell must not fetch them. |
| Existing Cursor / DeepSeek connectors | Unchanged. Those are opt-in cloud usage paths and are not local-model receipts. |

## Adapter priority

1. Ship this contract. No new harness parsers in the same PR.
2. Hermes receipt emitter from `session_model_usage` (parser already exists).
3. OpenCode metrics projection after pinning the live DB filename and schema.
4. Open WebUI `chat_message` metrics projection (`id`, `chat_id`, `model_id`, `usage`, `created_at` only).
5. Aider: keep the current transcript parser for time. Stop defaulting a model. Accept receipts or an explicit `Model:` / `/model` line only.
6. Continue: wait until persisted `usage` can be proven provider-reported.
7. AnythingLLM: wait for an official per-turn model field.
8. LocalAI: aggregate-only, localhost, owner-supplied key, no key export.
9. Ollama, LM Studio, llama.cpp, vLLM, Open Interpreter: receipt required. No inventory polls.
10. Jan selected-model files: unsupported.

## Bounded implementation plan

Each later PR stays under 400 changed lines and 8 files. No adapter ships in this docs PR.

| PR | Scope | Files (budget) |
| --- | --- | --- |
| 0 (this) | ADR, JSON schema, schema contract tests | docs/schema only. Line-budget exception: keep ADR, schema, and fixtures in one review so the contract cannot drift. Later adapter PRs stay under 400 lines and 8 files. |
| 1 | Validate envelope and events. Create or read `~/.meow-ops/machine-id`. Compute `dedupe_key`. Reject forbidden keys and inferred totals. | `sync/local-usage-receipt.mjs`, unit test |
| 2 | Owner-triggered export/import CLI. Write under `~/.meow-ops/receipts/`. Append-only import into private history. No network. | `sync/export-local-receipts.mjs`, `sync/import-local-receipts.mjs`, tests, npm script |
| 3 | Hermes emitter: read `session_model_usage` read-only, emit receipts, include `reasoning_tokens` when present, omit messages and paths. | small extension of `sync/parse-hermes.mjs` plus tests |
| 4 | OpenCode pin-and-extract or official export sanitizer. Fail closed on unknown DB name or schema. | one parser, one test file |
| 5 | Open WebUI metrics projection. Select only id, chat_id, model_id, usage, created_at. Drop content. | one parser, one test file |

Rollback for PR 0 is delete the docs. Later PRs fail closed and leave existing Hermes session import unchanged.

## Verdict

**GO WITH MANUAL GATES**

Not GO: most runtimes only expose live responses; several UIs mix prompts; Continue and Open Interpreter estimate tokens; Aider still defaults a model; schema drift is real.

Not NO-GO: Hermes already proves same-machine local-model usage without inventory; a receipt is the only privacy-safe way to merge computers; OpenCode and Open WebUI have official invocation fields that can be projected later.

Manual gates before any adapter lands:

1. Owner copies files. Meow Ops does not discover or push.
2. Import rejects events without exact `model` and `source_event_id`.
3. Import rejects token or cost values whose provenance is not `source`, and never coerces missing to 0.
4. Forbidden content, path, URL, and credential fields fail the whole file.
5. SQLite adapters require `schema_pin` (upstream version, not "sqlite") and refuse unknown pins.
6. No electricity cost. No inventory API. No credential transfer.
7. Display-only token sums stay labelled calculated and are never written back as source totals.

## Unknowns and Not verified

- Ollama Desktop SQLite table list and whether it stores tokens. Official API docs cover live responses, `/api/tags`, and `/api/ps` only.
- Whether Ollama server logs under `~/.ollama/logs` include model and token fields. Not in official usage docs.
- LM Studio conversation JSON field names. Official docs say do not rely on the structure.
- Whether LM Studio `server-logs` files contain durable token rows or only live stream text.
- llama.cpp response `model` as a GGUF identity versus a server alias.
- LocalAI per-request primary key in the auth usage tables. Documented API returns buckets.
- Exact Open WebUI `usage` JSON keys per backend (Ollama vs OpenAI-compatible).
- AnythingLLM official per-turn model inside `workspace_chats.response`.
- Continue: whether files on disk mark provider-reported usage versus local `countTokens` fallback.
- OpenCode DB filename on current stable versus v2 (`opencode.db` vs `opencode-next.db`) and whether official export can omit message content.
- Open Interpreter v1 conversation JSON versus newer `~/.openinterpreter/` session ids.
- Whether any inspected local runtime exposes cache or reasoning tokens besides Hermes, OpenCode, LM Studio native stats, and Continue's optional details.
- Whether `session_model_usage` rows exist on Hermes installs older than schema v20. PR #79 already treats that as `unavailable`.
- This audit did not open operator home directories or copy any live session rows.

## Consequences

- Same-machine Hermes usage remains the only local-model breakdown in the dashboard until later gated PRs.
- Direct Ollama and LM Studio usage stays blank unless a receipt exists.
- Future parsers must implement this contract or be rejected in review.
- Multi-computer views, if built, key off `machine_id` plus `dedupe_key`, not hostname.

## References

- Meow Ops PR #79 / commit `a9c630b`, `sync/parse-hermes.mjs`
- Hermes session storage: https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage
- Hermes `hermes_state_common.py` `SCHEMA_SQL` (`session_model_usage`)
- Ollama usage: https://docs.ollama.com/api/usage
- Ollama `GET /api/ps`: https://docs.ollama.com/api/ps
- LM Studio conversations and `lms log stream`: https://lmstudio.ai/llms.txt , https://lmstudio.ai/docs/cli/serve/log-stream
- llama.cpp `tools/server/README.md`
- LocalAI auth usage: https://localai.io/docs/features/authentication/index.html
- vLLM per-request metrics and serve flags: https://docs.vllm.ai/en/latest/features/per_request_metrics/
- Jan data folder: https://www.jan.ai/docs/desktop/data-folder
- Open WebUI database schema: https://docs.openwebui.com/reference/database-schema/
- AnythingLLM desktop storage: https://docs.anythingllm.com/installation-desktop/storage
- AnythingLLM `server/prisma/schema.prisma` `workspace_chats`
- Continue `core/index.d.ts` `Session` / `Usage`, `core/util/history.ts`
- Aider history options: https://aider.chat/docs/config/options.html
- OpenCode v2 troubleshooting and session API: https://opencode.ai/v2/docs/troubleshooting , https://opencode.ai/v2/docs/api/session/v2-session-create
- Open Interpreter sessions and `%tokens`: https://www.openinterpreter.com/docs/terminal/sessions , https://docs.openinterpreter.com/guides/advanced-terminal-usage
