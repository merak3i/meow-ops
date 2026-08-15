# Local Usage Receipt v1

Manual, local-first import of sanitized open/local-model invocation evidence.

## Architecture

```
computer/harness
  → read-only adapter or explicit receipt writer
  → sanitized receipt JSONL
  → manual copy into an import directory
  → Meow Ops aggregate dashboard
```

There is no automatic LAN discovery, cloud backend, public upload, or live paid API call.

## Supported sources

| Source | Adapter | Counts as usage |
|---|---|---|
| Hermes `session_model_usage` | Read-only SQLite adapter | Yes, one receipt per usage row |
| Explicit receipt writer | Operator or harness integration | Yes, one receipt per invocation |
| Ollama installed-model list | None | No |
| LM Studio loaded-model list | None | No |
| Cursor local transcripts | None | No. Cursor Admin remains the official Cursor path |
| Existing Hermes session scan | Unchanged | Yes, through the current Hermes parser |

Do not treat this as universal coverage. Harnesses without durable invocation history must write receipts themselves.

## Receipt schema

```json
{
  "schema": "meow.local_usage_receipt",
  "schema_version": 1,
  "machine_id": "11111111-1111-4111-8111-111111111111",
  "harness": "hermes",
  "source_event_id": "session_model_usage:sess-1:ollama:local-a:none",
  "occurred_at": "2026-08-15T12:00:00.000Z",
  "runtime": "ollama",
  "provider": "ollama",
  "model": "local-a",
  "session_id": "sess-1",
  "tokens": {
    "input": 100,
    "output": 20,
    "cache_read": 10,
    "cache_write": 5,
    "reasoning": 3
  },
  "cost_usd": null
}
```

`harness` is `hermes` or `receipt-writer`. Future `schema_version` values are rejected, not coerced. Unknown cost stays `null` and is shown as unavailable, never `$0`.

## Machine identity

Each computer generates a persistent random UUID at `~/.meow-ops/machine-id`.

It is not derived from hostname, username, hardware ID, MAC address, serial number, or filesystem path. The file is never committed. Override the path with `MEOW_MACHINE_ID_PATH` only for tests.

The dashboard displays `machine-` plus the first eight hex characters. The full UUID does not appear in the Overview.

## Collect receipts on each computer

Hermes, when `session_model_usage` exists:

```bash
node sync/local-usage-hermes.mjs --out ~/meow-receipts/hermes.jsonl
```

Harnesses without durable history:

```bash
node sync/local-usage-writer.mjs \
  --out ~/meow-receipts/writer.jsonl \
  --event ollama-chat-2026-08-15-1 \
  --harness receipt-writer \
  --provider ollama \
  --model local-a \
  --input 100 \
  --output 20
```

Copy those JSONL files to the primary computer. Do not commit them.

## Import on the primary dashboard

```bash
MEOW_LOCAL_USAGE_IMPORTS=/absolute/path/receipts-a:/absolute/path/receipts-b
node sync/export-local.mjs
```

Import is idempotent. Identity is `machine_id + harness + source_event_id`. Accepted receipts are merged into `~/.meow-ops/local-usage-store.jsonl` with an atomic replace so a partial write cannot erase prior imports.

Traversal (`..`) and symlinks that escape an import root are skipped. Incomplete last lines are skipped. Prompts, responses, transcripts, usernames, hostnames, absolute paths, repository remotes, and credential-shaped strings are rejected. Rejection errors name the rule only.

## Session assignment

A receipt is assigned to a Meow Ops session only when `session_id` exactly equals one local `session_id`, `composer_id`, `conversation_id`, or `cloud_agent_id`. Time-window and model-name matching are not used.

Unmatched receipts stay in the Local Usage Receipts aggregates, the same way unmatched Cursor Admin events stay unassigned.

Receipts never overwrite official Hermes or Cursor Admin usage already present on a session.

## Privacy boundary

Receipts and public artifacts must not contain:

- prompts, responses, transcripts, or message content
- usernames, hostnames, or computer names
- absolute paths or home directories
- repository remotes or credentials
- the full machine UUID in the Overview

Installed or loaded model inventories are not usage.

## Rollback

1. Unset `MEOW_LOCAL_USAGE_IMPORTS` and re-run `node sync/export-local.mjs`.
2. Delete `~/.meow-ops/local-usage-store.jsonl` if previously imported receipts should leave the aggregate view.
3. Revert the feature commit if the Overview panel itself must go.

Existing Hermes and Cursor tracking does not depend on this importer.

## Not verified

- Live multi-computer operator import of production Hermes databases
- Third-party harness writers beyond the documented CLI
- Windows path separators in `MEOW_LOCAL_USAGE_IMPORTS`
- Automatic transport between computers
