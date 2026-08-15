// Explicit Local Usage Receipt writer.
//
// Integration point for harnesses that do not expose durable invocation
// history. Callers must pass one real invocation at a time. Installed or
// loaded model inventories are rejected and never counted as usage.
//
// This writer does not discover other computers, upload receipts, or call
// paid APIs. Copy the resulting JSONL to the primary dashboard import
// directory yourself.

import {
  RECEIPT_SCHEMA,
  RECEIPT_SCHEMA_VERSION,
  appendReceiptLine,
  readOrCreateMachineId,
  validateReceipt,
} from './local-usage-receipt.mjs';

const FORBIDDEN_CLI = new Set([
  '--prompt', '--response', '--transcript', '--username', '--hostname',
  '--cwd', '--path', '--remote', '--token', '--api-key',
]);

export function createReceiptDraft(input = {}, options = {}) {
  const machineId = input.machine_id || options.machineId || readOrCreateMachineId({
    path: options.machineIdPath,
    allowWorktree: options.allowWorktree,
  });
  return {
    schema: RECEIPT_SCHEMA,
    schema_version: RECEIPT_SCHEMA_VERSION,
    machine_id: machineId,
    harness: input.harness || 'receipt-writer',
    source_event_id: input.source_event_id,
    occurred_at: input.occurred_at || new Date().toISOString(),
    runtime: input.runtime ?? input.provider ?? null,
    provider: input.provider ?? input.runtime ?? null,
    model: input.model ?? null,
    session_id: input.session_id ?? null,
    tokens: {
      input: input.input_tokens ?? input.tokens?.input ?? null,
      output: input.output_tokens ?? input.tokens?.output ?? null,
      cache_read: input.cache_read_tokens ?? input.tokens?.cache_read ?? null,
      cache_write: input.cache_write_tokens ?? input.tokens?.cache_write ?? null,
      reasoning: input.reasoning_tokens ?? input.tokens?.reasoning ?? null,
    },
    cost_usd: Object.prototype.hasOwnProperty.call(input, 'cost_usd') ? input.cost_usd : null,
  };
}

export function writeLocalUsageReceipt(outPath, input = {}, options = {}) {
  if (!outPath) throw new Error('receipt writer requires an output path');
  const draft = createReceiptDraft(input, options);
  const validated = validateReceipt(draft, options);
  if (!validated.ok) {
    throw new Error(`receipt rejected: ${validated.reason}`);
  }
  return appendReceiptLine(outPath, validated.receipt);
}

function parseArgs(argv) {
  for (const arg of argv) {
    if (FORBIDDEN_CLI.has(arg)) {
      throw new Error('receipt writer refuses prompt, identity, path, and credential flags');
    }
  }
  const args = {
    out: null,
    harness: 'receipt-writer',
    event: null,
    provider: null,
    runtime: null,
    model: null,
    session: null,
    occurredAt: null,
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    cost: null,
    machineIdPath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;
    if (key === '--out') args.out = value;
    else if (key === '--harness') args.harness = value;
    else if (key === '--event') args.event = value;
    else if (key === '--provider') args.provider = value;
    else if (key === '--runtime') args.runtime = value;
    else if (key === '--model') args.model = value;
    else if (key === '--session') args.session = value;
    else if (key === '--occurred-at') args.occurredAt = value;
    else if (key === '--input') args.input = value;
    else if (key === '--output') args.output = value;
    else if (key === '--cache-read') args.cacheRead = value;
    else if (key === '--cache-write') args.cacheWrite = value;
    else if (key === '--reasoning') args.reasoning = value;
    else if (key === '--cost') args.cost = value;
    else if (key === '--machine-id-path') args.machineIdPath = value;
    else continue;
    i += 1;
  }
  return args;
}

function isMain() {
  const invoked = process.argv[1] || '';
  return invoked.endsWith('local-usage-writer.mjs');
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.out || !args.event) {
      console.error('Usage: node sync/local-usage-writer.mjs --out <receipts.jsonl> --event <source_event_id> [--model NAME] [--provider NAME]');
      process.exit(1);
    }
    const receipt = writeLocalUsageReceipt(args.out, {
      harness: args.harness,
      source_event_id: args.event,
      provider: args.provider,
      runtime: args.runtime,
      model: args.model,
      session_id: args.session,
      occurred_at: args.occurredAt,
      input_tokens: args.input,
      output_tokens: args.output,
      cache_read_tokens: args.cacheRead,
      cache_write_tokens: args.cacheWrite,
      reasoning_tokens: args.reasoning,
      cost_usd: args.cost,
    }, { machineIdPath: args.machineIdPath, allowWorktree: true });
    console.log(`Wrote receipt ${receipt.source_event_id}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
