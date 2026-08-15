import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCHEMA_VERSION,
  canonicalDedupeKey,
  machineIdPath,
  readOrCreateMachineId,
  validateReceipt,
} from '../local-usage-receipt.mjs';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MODULE_URL = new URL('../local-usage-receipt.mjs', import.meta.url).href;
const M1 = '550e8400-e29b-41d4-a716-446655440000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function event(machineId, harness, sourceEventId, extra = {}) {
  return {
    source_event_id: sourceEventId,
    dedupe_key: canonicalDedupeKey(SCHEMA_VERSION, machineId, harness, sourceEventId),
    harness,
    model: 'local-a',
    runtime: 'ollama',
    provider: 'ollama',
    session_id: 'sess1',
    availability: {
      model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
      tokens: 'source', cost: 'source', tool_calls: 'unavailable',
    },
    provenance: {
      source_kind: 'sqlite', source_label: 'hermes.session_model_usage',
      schema_pin: 'hermes-schema-23', recorded_as: 'invocation',
    },
    tokens: { input: { available: true, value: 10, provenance: 'source' } },
    cost_usd: { available: true, value: 0, provenance: 'source' },
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

const valid = receipt(M1, [event(M1, 'hermes', 'chat-1')]);

test('accepts a valid envelope and recomputes every event dedupe key', () => {
  const row = receipt(M1, [
    event(M1, 'hermes', 'chat-1'),
    event(M1, 'ollama', 'chat-2', { model: 'ollama/llama3.2' }),
    event(M1, 'lmstudio', 'chat-3', { model: 'llama3.2:latest' }),
  ]);
  const result = validateReceipt(row);
  assert.equal(result.ok, true);
  assert.equal(result.receipt, row);
  for (const evt of row.events) {
    assert.equal(
      evt.dedupe_key,
      canonicalDedupeKey(SCHEMA_VERSION, M1, evt.harness, evt.source_event_id),
    );
  }
});

test('accepts exact source zero cost and keeps unavailable cost absent', () => {
  assert.equal(valid.events[0].cost_usd.value, 0);
  assert.equal(validateReceipt(valid).ok, true);
  const omitted = edit(valid, (row) => {
    delete row.events[0].cost_usd;
    row.events[0].availability.cost = 'unavailable';
  });
  assert.equal(validateReceipt(omitted).ok, true);
  assert.equal('cost_usd' in omitted.events[0], false);
});

const rejects = [
  ['plausible wrong hash', (row) => { row.events[0].dedupe_key = 'a'.repeat(64); }, 'dedupe_key'],
  ['duplicate dedupe keys', (row) => { row.events.push(event(M1, 'hermes', 'chat-1')); }, 'duplicate_dedupe_key'],
  ['fractional tokens', (row) => { row.events[0].tokens.input.value = 1.5; }, 'malformed'],
  ['negative tokens', (row) => { row.events[0].tokens.input.value = -1; }, 'malformed'],
  ['NaN tokens', (row) => { row.events[0].tokens.input.value = Number.NaN; }, 'malformed'],
  ['infinite tokens', (row) => { row.events[0].tokens.input.value = Number.POSITIVE_INFINITY; }, 'malformed'],
  ['contradictory availability', (row) => { row.events[0].availability.tokens = 'unavailable'; }, 'malformed'],
  ['source_kind receipt', (row) => { row.events[0].provenance.source_kind = 'receipt'; }, 'malformed'],
  ['SQLite missing schema pin', (row) => { delete row.events[0].provenance.schema_pin; }, 'malformed'],
  ['SQLite unknown schema pin', (row) => { row.events[0].provenance.schema_pin = 'unknown-pin-1'; }, 'schema_pin'],
  ['forbidden content', (row) => { row.events[0].prompt = 'ignored'; }, 'malformed'],
  ['unknown field', (row) => { row.events[0].note = 'extra'; }, 'malformed'],
  ['path value', (row) => { row.events[0].source_event_id = '/Users/alice/evt'; }, 'malformed'],
  ['URL value', (row) => { row.events[0].model = 'https://example.invalid/model'; }, 'malformed'],
  ['traversal value', (row) => { row.events[0].model = 'local/../secret'; }, 'malformed'],
  ['credential-shaped value', (row) => { row.events[0].model = `sk-${'a'.repeat(24)}`; }, 'secret'],
];

for (const [name, mutate, reason] of rejects) {
  test(`rejects ${name}`, () => {
    const result = validateReceipt(edit(valid, mutate));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.receipt, null);
    assert.equal(JSON.stringify(result).includes('sk-aaaaaaaa'), false);
  });
}

test('machine identity is a stable random UUID v4 with private modes', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-machine-id-'));
  const first = readOrCreateMachineId(home);
  const second = readOrCreateMachineId(home);
  assert.equal(first, second);
  assert.match(first, UUID_RE);
  const file = machineIdPath(home);
  assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(machineIdPath().endsWith('/.meow-ops/machine-id'), true);
});

test('malformed identity and worktree locations fail closed', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-machine-bad-'));
  const file = machineIdPath(home);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, 'not-a-uuid\n', { encoding: 'utf8', mode: 0o600 });
  assert.throws(() => readOrCreateMachineId(home), /malformed/);
  assert.equal(readFileSync(file, 'utf8').trim(), 'not-a-uuid');
  assert.throws(() => readOrCreateMachineId(REPO), /worktree/);
});

test('concurrent first creation preserves one stable identity', async () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-machine-race-'));
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      `import { readOrCreateMachineId } from ${JSON.stringify(MODULE_URL)};
       process.stdout.write(readOrCreateMachineId(${JSON.stringify(home)}));`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && UUID_RE.test(out)) resolve(out);
      else reject(new Error('concurrent identity child failed'));
    });
  });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a, b);
  assert.equal(readOrCreateMachineId(home), a);
});
