// Read-only Local Usage Receipt adapter for Hermes session_model_usage.
//
// This is the only official harness adapter in v1. It opens the Hermes
// SQLite state database read-only, maps each usage row to a sanitized
// receipt, and never treats the currently installed or loaded model list
// as evidence of an invocation.

import { readHermesModelUsageRows, DEFAULT_HERMES_DB } from './parse-hermes.mjs';
import {
  RECEIPT_SCHEMA,
  RECEIPT_SCHEMA_VERSION,
  appendReceiptLine,
  readOrCreateMachineId,
  validateReceipt,
} from './local-usage-receipt.mjs';

function isoFromHermes(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    const milliseconds = number < 1e12 ? number * 1000 : number;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function optionalCount(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function sourceReportedCost(row) {
  const actual = Number(row?.actual_cost_usd);
  if (Number.isFinite(actual) && actual >= 0) return actual;
  const estimated = Number(row?.estimated_cost_usd);
  if (Number.isFinite(estimated) && estimated >= 0) return estimated;
  return null;
}

function stableEventId(row, provider, model, billingMode) {
  return [
    'session_model_usage',
    String(row?.session_id || 'none'),
    provider || 'unknown',
    model || 'unknown',
    billingMode || 'none',
  ].join(':');
}

export function receiptsFromHermesUsageRows(rows = [], options = {}) {
  const machineId = options.machineId || readOrCreateMachineId({
    path: options.machineIdPath,
    allowWorktree: options.allowWorktree,
  });
  const occurredFallback = options.occurredAt || new Date().toISOString();
  const receipts = [];
  const rejected = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = String(row?.billing_provider || '').trim() || null;
    const model = String(row?.model || '').trim() || null;
    const billingMode = String(row?.billing_mode || '').trim() || null;
    const candidate = {
      schema: RECEIPT_SCHEMA,
      schema_version: RECEIPT_SCHEMA_VERSION,
      machine_id: machineId,
      harness: 'hermes',
      source_event_id: stableEventId(row, provider, model, billingMode),
      occurred_at: isoFromHermes(row?.last_seen, occurredFallback),
      runtime: provider,
      provider,
      model,
      session_id: row?.session_id ? String(row.session_id) : null,
      tokens: {
        input: optionalCount(row?.input_tokens),
        output: optionalCount(row?.output_tokens),
        cache_read: optionalCount(row?.cache_read_tokens),
        cache_write: optionalCount(row?.cache_write_tokens),
        reasoning: null,
      },
      cost_usd: sourceReportedCost(row),
    };
    const validated = validateReceipt(candidate, options);
    if (!validated.ok) {
      rejected.push(validated.reason);
      continue;
    }
    receipts.push(validated.receipt);
  }

  return { receipts, rejected };
}

export function scanHermesUsageReceipts(options = {}) {
  const dbPath = options.dbPath || process.env.HERMES_STATE_DB || DEFAULT_HERMES_DB;
  const { status, rows } = readHermesModelUsageRows(dbPath);
  if (status !== 'ok') return { status, receipts: [], rejected: [] };
  const mapped = receiptsFromHermesUsageRows(rows, options);
  return { status: 'ok', ...mapped };
}

export function writeHermesUsageReceipts(outPath, options = {}) {
  if (!outPath) throw new Error('Hermes receipt writer requires an output path');
  const scanned = scanHermesUsageReceipts(options);
  if (scanned.status !== 'ok') return { ...scanned, written: 0 };
  let written = 0;
  for (const receipt of scanned.receipts) {
    appendReceiptLine(outPath, receipt);
    written += 1;
  }
  return { status: 'ok', receipts: scanned.receipts, rejected: scanned.rejected, written };
}

function parseArgs(argv) {
  const args = { out: null, db: null, machineIdPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--out' && value) { args.out = value; i += 1; }
    else if (key === '--db' && value) { args.db = value; i += 1; }
    else if (key === '--machine-id-path' && value) { args.machineIdPath = value; i += 1; }
  }
  return args;
}

function isMain() {
  const invoked = process.argv[1] || '';
  return invoked.endsWith('local-usage-hermes.mjs');
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('Usage: node sync/local-usage-hermes.mjs --out <receipts.jsonl> [--db <state.db>]');
    process.exit(1);
  }
  const result = writeHermesUsageReceipts(args.out, {
    dbPath: args.db,
    machineIdPath: args.machineIdPath,
  });
  if (result.status !== 'ok') {
    console.error(`Hermes receipts unavailable (${result.status})`);
    process.exit(1);
  }
  console.log(`Wrote ${result.written} Hermes receipt(s)`);
}
