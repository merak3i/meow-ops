import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCHEMA_VERSION,
  assertOutsideWorktree,
  canonicalDedupeKey,
  readOrCreateMachineId,
  validateReceipt,
} from '../local-usage-receipt.mjs';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const M1 = '550e8400-e29b-41d4-a716-446655440000';
const M2 = '6ba7b810-9dad-41d4-a716-446655440000';

function event(machineId, harness, sourceEventId, extra = {}) {
  return {
    source_event_id: sourceEventId,
    dedupe_key: canonicalDedupeKey(SCHEMA_VERSION, machineId, harness, sourceEventId),
    harness,
    model: 'local-a',
    availability: {
      model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
      tokens: 'source', cost: 'source', tool_calls: 'unavailable',
    },
    provenance: {
      source_kind: 'receipt', source_label: 'manual.invocation', recorded_as: 'invocation',
    },
    ...extra,
  };
}

function receipt(machineId, events) {
  return {
    schema_version: SCHEMA_VERSION,
    kind: 'meow-ops.local-usage-receipt',
    machine_id: machineId,
    exported_at: '2026-08-15T20:00:00.000Z',
    events,
  };
}

function edit(base, mutate) {
  const copy = structuredClone(base);
  mutate(copy);
  return copy;
}

const valid = receipt(M1, [event(M1, 'ollama', 'chat-1', {
  runtime: 'ollama',
  provider: 'ollama',
  tokens: { input: { available: true, value: 10, provenance: 'source' } },
  cost_usd: { available: true, value: 0, provenance: 'source' },
})]);

test('accepts bounded harness ids including ollama, lmstudio, and opencode', () => {
  for (const harness of ['hermes', 'ollama', 'lmstudio', 'opencode', 'receipt-writer']) {
    const row = receipt(M1, [event(M1, harness, `evt-${harness}`)]);
    assert.equal(validateReceipt(row).ok, true, harness);
  }
});

test('two computers sharing a model and event id keep distinct dedupe keys', () => {
  const a = receipt(M1, [event(M1, 'ollama', 'shared-evt')]);
  const b = receipt(M2, [event(M2, 'ollama', 'shared-evt')]);
  assert.equal(validateReceipt(a).ok, true);
  assert.equal(validateReceipt(b).ok, true);
  assert.notEqual(a.events[0].dedupe_key, b.events[0].dedupe_key);
});

test('canonical dedupe key is JSON.stringify array SHA-256', () => {
  const key = canonicalDedupeKey(SCHEMA_VERSION, M1, 'hermes', 'evt-1');
  assert.match(key, /^[a-f0-9]{64}$/);
  const collided = edit(valid, (row) => { row.events[0].dedupe_key = '0'.repeat(64); });
  assert.equal(validateReceipt(collided).reason, 'dedupe_key');
});

test('machine_id is a persistent random UUID and refuses worktrees', () => {
  const dir = mkdtempSync(join('/tmp', 'meow-machine-id-'));
  const path = join(dir, 'machine-id');
  const first = readOrCreateMachineId({ path });
  const second = readOrCreateMachineId({ path });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, hostname());
  assert.throws(() => assertOutsideWorktree(REPO), /worktree/);
});

const cases = [
  ['contract version mismatch', (row) => { row.schema_version = 'local-usage-receipt.v2'; }, 'unsupported_version'],
  ['missing exact model', (row) => { delete row.events[0].model; }, 'malformed'],
  ['selected model evidence', (row) => { row.events[0].provenance.recorded_as = 'selected'; }, 'malformed'],
  ['inventory model evidence', (row) => { row.events[0].availability.model = 'source'; }, 'malformed'],
  ['fractional tokens', (row) => { row.events[0].tokens = { input: { available: true, value: 1.5, provenance: 'source' } }; }, 'malformed'],
  ['negative tokens', (row) => { row.events[0].tokens = { input: { available: true, value: -1, provenance: 'source' } }; }, 'malformed'],
  ['zero cost is source-reported', (row) => { row.events[0].cost_usd = { available: true, value: 0, provenance: 'source' }; }, null],
  ['unavailable cost forbids a value', (row) => { row.events[0].cost_usd = { available: false, value: 0, provenance: 'source' }; }, 'malformed'],
  ['untrusted cost without provenance', (row) => { row.events[0].cost_usd = { available: true, value: 1.25 }; }, 'malformed'],
  ['calculated cost is rejected', (row) => { row.events[0].cost_usd = { available: true, value: 1.25, provenance: 'calculated' }; }, 'malformed'],
  ['unknown field', (row) => { row.events[0].note = 'extra'; }, 'malformed'],
  ['prompt leakage', (row) => { row.events[0].prompt = 'ignored'; }, 'malformed'],
  ['response leakage', (row) => { row.events[0].response = 'ignored'; }, 'malformed'],
  ['transcript leakage', (row) => { row.events[0].transcript = 'ignored'; }, 'malformed'],
  ['absolute path leakage', (row) => { row.events[0].source_event_id = '/Users/alice/evt'; }, 'malformed'],
  ['hostname leakage', (row) => { row.hostname = 'macbook-pro.local'; }, 'malformed'],
  ['username leakage', (row) => { row.events[0].username = 'alice'; }, 'malformed'],
  ['remote leakage', (row) => { row.events[0].git_remote = 'git@example.com:org/repo.git'; }, 'malformed'],
  ['secret leakage', (row) => { row.events[0].model = `sk-${'a'.repeat(24)}`; }, 'secret'],
];

for (const [name, mutate, reason] of cases) {
  test(name, () => {
    const result = validateReceipt(edit(valid, mutate));
    if (reason == null) assert.equal(result.ok, true);
    else {
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(JSON.stringify(result).includes('sk-aaaaaaaa'), false);
    }
  });
}
