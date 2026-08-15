import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RECEIPT_SCHEMA,
  applyLocalUsageReceipts,
  emptyLocalUsageReport,
  generateMachineId,
  importLocalUsageReceipts,
  machineDisplayLabel,
  readOrCreateMachineId,
  receiptIdentity,
  toPublicLocalUsageReport,
  validateReceipt,
} from '../local-usage-receipt.mjs';
import { receiptsFromHermesUsageRows } from '../local-usage-hermes.mjs';
import { writeLocalUsageReceipt } from '../local-usage-writer.mjs';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MACHINE_A = '11111111-1111-4111-8111-111111111111';
const MACHINE_B = '22222222-2222-4222-8222-222222222222';
const OCCURRED = '2026-08-15T12:00:00.000Z';

function tmpDir(label) {
  return mkdtempSync(join('/tmp', `meow-local-usage-${label}-`));
}

function receipt(overrides = {}) {
  return {
    schema: RECEIPT_SCHEMA,
    schema_version: 1,
    machine_id: MACHINE_A,
    harness: 'hermes',
    source_event_id: 'session_model_usage:sess-1:ollama:local-a:none',
    occurred_at: OCCURRED,
    runtime: 'ollama',
    provider: 'ollama',
    model: 'local-a',
    session_id: 'sess-1',
    tokens: {
      input: 100,
      output: 20,
      cache_read: 10,
      cache_write: 5,
      reasoning: 3,
    },
    cost_usd: null,
    ...overrides,
  };
}

function writeJsonl(dir, name, lines) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function importFrom(dir, storePath, extra = {}) {
  return importLocalUsageReceipts({
    importSpec: dir,
    storePath,
    allowWorktree: true,
    ...extra,
  });
}

test('valid receipt imports and keeps separate token fields', () => {
  const dir = tmpDir('valid');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'one.jsonl', [JSON.stringify(receipt())]);
  const imported = importFrom(dir, store);
  assert.equal(imported.report.status, 'ok');
  assert.equal(imported.report.accepted, 1);
  assert.equal(imported.receipts[0].tokens.input, 100);
  assert.equal(imported.receipts[0].tokens.output, 20);
  assert.equal(imported.receipts[0].tokens.cache_read, 10);
  assert.equal(imported.receipts[0].tokens.cache_write, 5);
  assert.equal(imported.receipts[0].tokens.reasoning, 3);
  assert.equal(imported.receipts[0].cost_usd, null);
  assert.equal(imported.report.totals.cost_available, false);
  assert.equal(imported.report.totals.cost_usd, null);
});

test('two computers using the same model stay distinct by machine', () => {
  const dir = tmpDir('two-machines');
  const store = join(dir, 'store.jsonl');
  const rootA = join(dir, 'a');
  const rootB = join(dir, 'b');
  writeJsonl(rootA, 'a.jsonl', [JSON.stringify(receipt({
    machine_id: MACHINE_A,
    source_event_id: 'evt-a',
    session_id: null,
  }))]);
  writeJsonl(rootB, 'b.jsonl', [JSON.stringify(receipt({
    machine_id: MACHINE_B,
    source_event_id: 'evt-b',
    session_id: null,
  }))]);
  const imported = importLocalUsageReceipts({
    importSpec: `${rootA}:${rootB}`,
    storePath: store,
    allowWorktree: true,
  });
  assert.equal(imported.report.accepted, 2);
  assert.equal(imported.report.by_model.length, 1);
  assert.equal(imported.report.by_model[0].key, 'local-a');
  assert.equal(imported.report.by_model[0].receipts, 2);
  assert.deepEqual(imported.report.by_machine.map((row) => row.key).sort(), [
    machineDisplayLabel(MACHINE_A),
    machineDisplayLabel(MACHINE_B),
  ]);
});

test('one computer using multiple harnesses is aggregated by harness', () => {
  const dir = tmpDir('two-harnesses');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'mixed.jsonl', [
    JSON.stringify(receipt({ harness: 'hermes', source_event_id: 'evt-hermes' })),
    JSON.stringify(receipt({
      harness: 'receipt-writer',
      source_event_id: 'evt-writer',
      provider: 'lmstudio',
      runtime: 'lmstudio',
    })),
  ]);
  const imported = importFrom(dir, store);
  assert.equal(imported.report.by_machine.length, 1);
  assert.deepEqual(imported.report.by_harness.map((row) => row.key).sort(), [
    'hermes',
    'receipt-writer',
  ]);
  assert.deepEqual(imported.report.by_provider.map((row) => row.key).sort(), [
    'lmstudio',
    'ollama',
  ]);
});

test('Hermes adapter keeps every model used in one session', () => {
  const mapped = receiptsFromHermesUsageRows([
    {
      session_id: 'hermes-1', model: 'local-a', billing_provider: 'ollama',
      input_tokens: 100, output_tokens: 20, estimated_cost_usd: 0, last_seen: 1_784_410_000,
    },
    {
      session_id: 'hermes-1', model: 'cloud-b', billing_provider: 'openrouter',
      billing_mode: 'chat_completions', input_tokens: 50, output_tokens: 10,
      estimated_cost_usd: 0.02, last_seen: 1_784_410_120,
    },
  ], { machineId: MACHINE_A, allowWorktree: true });

  assert.equal(mapped.receipts.length, 2);
  assert.deepEqual(mapped.receipts.map((row) => row.model).sort(), ['cloud-b', 'local-a']);
  assert.equal(mapped.receipts.every((row) => row.session_id === 'hermes-1'), true);
  assert.equal(mapped.receipts.every((row) => row.harness === 'hermes'), true);
  const paid = mapped.receipts.find((row) => row.model === 'cloud-b');
  assert.equal(paid.cost_usd, 0.02);
  const local = mapped.receipts.find((row) => row.model === 'local-a');
  assert.equal(local.cost_usd, 0);
});

test('exact session identifier match assigns usage; official Hermes/Cursor rows stay intact', () => {
  const sessions = [
    {
      session_id: 'sess-1', source: 'cursor', usage_available: false, model: null,
      input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
      total_tokens: 0, estimated_cost_usd: 0,
    },
    {
      session_id: 'hermes-1', source: 'hermes', usage_available: true, usage_source: 'hermes',
      input_tokens: 99, output_tokens: 7, total_tokens: 106, estimated_cost_usd: 0.11,
    },
  ];
  const receipts = [
    receipt({ session_id: 'sess-1', cost_usd: 0.4 }),
    receipt({
      source_event_id: 'session_model_usage:hermes-1:ollama:local-a:none',
      session_id: 'hermes-1',
      tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 },
    }),
  ];
  const result = applyLocalUsageReceipts(sessions, receipts, emptyLocalUsageReport({ status: 'ok', enabled: true }));
  assert.equal(result.report.matched_sessions, 2);
  assert.equal(result.report.matched_receipts, 2);
  assert.equal(result.report.applied_receipts, 1);
  assert.equal(sessions[0].usage_source, 'local-usage-receipt');
  assert.equal(sessions[0].input_tokens, 100);
  assert.equal(sessions[0].reasoning_tokens, 3);
  assert.equal(sessions[0].cost_available, true);
  assert.equal(sessions[0].estimated_cost_usd, 0.4);
  assert.equal(sessions[1].input_tokens, 99);
  assert.equal(sessions[1].usage_source, 'hermes');
});

test('multi-model receipts on one session keep both models in aggregates and do not pick a winner', () => {
  const sessions = [{
    session_id: 'sess-multi', source: 'cursor', usage_available: false,
    input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
    total_tokens: 0, estimated_cost_usd: 0, model: null,
  }];
  const receipts = [
    receipt({ session_id: 'sess-multi', model: 'local-a', source_event_id: 'evt-a', cost_usd: null }),
    receipt({
      session_id: 'sess-multi', model: 'cloud-b', source_event_id: 'evt-b',
      provider: 'openrouter', runtime: 'openrouter',
      tokens: { input: 50, output: 10, cache_read: null, cache_write: null, reasoning: null },
      cost_usd: 0.02,
    }),
  ];
  const result = applyLocalUsageReceipts(sessions, receipts, emptyLocalUsageReport({ status: 'ok', enabled: true }));
  assert.equal(result.report.matched_sessions, 1);
  assert.equal(sessions[0].model, null);
  assert.equal(sessions[0].input_tokens, 150);
  assert.equal(sessions[0].cost_available, true);
  assert.equal(sessions[0].estimated_cost_usd, 0.02);
  assert.deepEqual(result.report.by_model.map((row) => row.key).sort(), ['cloud-b', 'local-a']);
});

test('unmatched receipts stay as aggregates and are not assigned', () => {
  const sessions = [{ session_id: 'other', source: 'cursor', usage_available: false }];
  const receipts = [receipt({ session_id: 'missing-session', model: 'orphan-model' })];
  const result = applyLocalUsageReceipts(sessions, receipts, emptyLocalUsageReport({ status: 'ok' }));
  assert.equal(result.report.matched_receipts, 0);
  assert.equal(result.report.unmatched_receipts, 1);
  assert.equal(result.report.unmatched.by_model[0].key, 'orphan-model');
  assert.equal(sessions[0].usage_source, undefined);
});

test('duplicate imports are idempotent', () => {
  const dir = tmpDir('dup');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'one.jsonl', [JSON.stringify(receipt())]);
  const first = importFrom(dir, store);
  const second = importFrom(dir, store);
  assert.equal(first.report.accepted, 1);
  assert.equal(second.report.accepted, 0);
  assert.equal(second.report.duplicates, 1);
  assert.equal(second.receipts.length, 1);
  assert.equal(receiptIdentity(second.receipts[0]), receiptIdentity(first.receipts[0]));
});

test('missing model, tokens, and cost remain unavailable instead of zero-filled cost', () => {
  const dir = tmpDir('missing');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'sparse.jsonl', [JSON.stringify(receipt({
    model: null,
    tokens: {},
    cost_usd: null,
    source_event_id: 'sparse-1',
    session_id: null,
  }))]);
  const imported = importFrom(dir, store);
  assert.equal(imported.report.accepted, 1);
  assert.equal(imported.receipts[0].model, null);
  assert.equal(imported.receipts[0].tokens.input, null);
  assert.equal(imported.report.totals.cost_available, false);
  assert.equal(imported.report.totals.cost_usd, null);
  assert.equal(imported.report.by_model[0].key, 'unknown');
});

test('malformed lines and future schema versions are rejected without import', () => {
  const dir = tmpDir('bad');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'bad.jsonl', [
    '{not-json',
    JSON.stringify(receipt({ schema_version: 2, source_event_id: 'future-1' })),
    JSON.stringify(receipt({ source_event_id: 'ok-1' })),
  ]);
  const imported = importFrom(dir, store);
  assert.equal(imported.report.accepted, 1);
  assert.equal(imported.report.rejected, 2);
  assert.equal(imported.report.rejected_reasons.malformed, 1);
  assert.equal(imported.report.rejected_reasons.unsupported_version, 1);
  assert.equal(imported.receipts[0].source_event_id, 'ok-1');
});

test('secret-shaped content is rejected without echoing the secret', () => {
  const secret = `sk-${'a'.repeat(24)}`;
  const result = validateReceipt(receipt({ model: secret }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'secret');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('username, hostname, and absolute-path leakage is rejected', () => {
  assert.equal(validateReceipt(receipt({ username: 'alice' })).reason, 'forbidden_field');
  assert.equal(validateReceipt(receipt({ hostname: 'macbook-pro.local' })).reason, 'forbidden_field');
  assert.equal(validateReceipt(receipt({
    source_event_id: 'evt-path',
    model: '/Users/alice/models/local-a',
  })).reason, 'identity');
  assert.equal(validateReceipt(receipt({
    source_event_id: 'alice@office.local',
  }), { identityHints: ['alice', 'office.local'] }).reason, 'identity');
});

test('Ollama and LM Studio inventory objects are not counted as usage', () => {
  assert.equal(validateReceipt({
    models: [{ name: 'llama3.2', digest: 'sha256:abc', size: 12 }],
  }).reason, 'inventory');
  assert.equal(validateReceipt({
    object: 'list',
    data: [{ id: 'local-model', object: 'model' }],
  }).reason, 'inventory');
});

test('traversal and symlink escape are skipped', () => {
  const root = tmpDir('root');
  const outside = tmpDir('outside');
  const store = join(root, 'store.jsonl');
  writeJsonl(root, 'ok.jsonl', [JSON.stringify(receipt({ source_event_id: 'inside-1' }))]);
  writeJsonl(outside, 'escape.jsonl', [JSON.stringify(receipt({
    source_event_id: 'escaped-1',
    model: 'should-not-import',
  }))]);
  symlinkSync(join(outside, 'escape.jsonl'), join(root, 'link.jsonl'));
  const imported = importFrom(root, store);
  assert.equal(imported.receipts.some((row) => row.source_event_id === 'escaped-1'), false);
  assert.equal(imported.receipts[0].source_event_id, 'inside-1');
  assert.ok(imported.report.files_skipped >= 1);

  const traversal = importLocalUsageReceipts({
    importSpec: `${root}/../${outside.split('/').pop()}`,
    storePath: join(root, 'store-traversal.jsonl'),
    allowWorktree: true,
  });
  assert.equal(traversal.receipts.length, 0);
  assert.ok(traversal.report.files_skipped >= 1);
});

test('partial file writes do not corrupt prior imports', () => {
  const dir = tmpDir('partial');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'live.jsonl', [
    JSON.stringify(receipt({ source_event_id: 'first' })),
    JSON.stringify(receipt({ source_event_id: 'second' })),
  ]);
  const first = importFrom(dir, store);
  assert.equal(first.receipts.length, 2);
  const priorStore = readFileSync(store, 'utf8');

  writeFileSync(join(dir, 'live.jsonl'), [
    JSON.stringify(receipt({ source_event_id: 'first' })),
    JSON.stringify(receipt({ source_event_id: 'second' })),
    JSON.stringify(receipt({ source_event_id: 'third' })),
    '{"schema":"meow.local_usage_receipt","schema_version":1',
  ].join('\n'), 'utf8');
  writeFileSync(`${store}.tmp.9999`, 'CORRUPT', 'utf8');

  const second = importFrom(dir, store);
  assert.equal(second.receipts.length, 3);
  assert.deepEqual(second.receipts.map((row) => row.source_event_id).sort(), [
    'first',
    'second',
    'third',
  ]);
  assert.equal(readFileSync(store, 'utf8').includes('CORRUPT'), false);
  assert.ok(priorStore.includes('first'));
});

test('public report shows machine/harness/provider/model without identity', () => {
  const dir = tmpDir('public');
  const store = join(dir, 'store.jsonl');
  writeJsonl(dir, 'one.jsonl', [JSON.stringify(receipt())]);
  const imported = importFrom(dir, store);
  const pub = toPublicLocalUsageReport(imported.report);
  const blob = JSON.stringify(pub);
  assert.equal(blob.includes(MACHINE_A), false);
  assert.equal(blob.includes('/Users/'), false);
  assert.equal(blob.includes('/home/'), false);
  assert.equal(blob.includes(hostname()), false);
  assert.equal(pub.by_machine[0].key, machineDisplayLabel(MACHINE_A));
  assert.equal(pub.by_harness[0].key, 'hermes');
  assert.equal(pub.by_provider[0].key, 'ollama');
  assert.equal(pub.by_model[0].key, 'local-a');
  assert.equal(pub.totals.cost_usd, null);
});

test('machine_id is a persistent random UUID and is never derived from host identity', () => {
  const dir = tmpDir('machine');
  const path = join(dir, 'machine-id');
  const first = generateMachineId();
  const second = generateMachineId();
  assert.notEqual(first, second);
  assert.notEqual(first, hostname());
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const persisted = readOrCreateMachineId({ path, allowWorktree: true });
  const again = readOrCreateMachineId({ path, allowWorktree: true });
  assert.equal(persisted, again);
  assert.notEqual(persisted, hostname());
  assert.throws(
    () => readOrCreateMachineId({ path: join(REPO, '.meow-ops-machine-id') }),
    /worktree/,
  );
});

test('receipt writer appends a sanitized invocation and refuses inventory-like drafts', () => {
  const dir = tmpDir('writer');
  const out = join(dir, 'out.jsonl');
  const written = writeLocalUsageReceipt(out, {
    harness: 'receipt-writer',
    source_event_id: 'ollama-chat-1',
    provider: 'ollama',
    model: 'local-a',
    input_tokens: 12,
    output_tokens: 4,
  }, { machineId: MACHINE_B, allowWorktree: true });
  assert.equal(written.harness, 'receipt-writer');
  assert.equal(written.machine_id, MACHINE_B);
  const imported = importFrom(dir, join(dir, 'store.jsonl'));
  assert.equal(imported.report.accepted, 1);
  assert.throws(
    () => writeLocalUsageReceipt(out, { models: [{ name: 'llama3' }] }, { machineId: MACHINE_B }),
    /rejected/,
  );
});
