import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../docs/local-usage-receipt-v1.schema.json'),
  'utf8',
));

function dedupeKey(schemaVersion, machineId, harness, sourceEventId) {
  return createHash('sha256')
    .update(JSON.stringify([schemaVersion, machineId, harness, sourceEventId]), 'utf8')
    .digest('hex');
}

function deref(root, ref) {
  const path = ref.replace(/^#\//, '').split('/');
  return path.reduce((node, key) => node[key], root);
}

function typeOk(type, data) {
  if (type === 'null') return data === null;
  if (type === 'object') return data !== null && typeof data === 'object' && !Array.isArray(data);
  if (type === 'array') return Array.isArray(data);
  if (type === 'integer') return Number.isInteger(data) && Number.isFinite(data);
  if (type === 'number') return typeof data === 'number' && Number.isFinite(data);
  if (type === 'boolean') return typeof data === 'boolean';
  if (type === 'string') return typeof data === 'string';
  return false;
}

function check(node, data, root) {
  if (node.$ref) return check(deref(root, node.$ref), data, root);
  if (node.allOf && node.allOf.some((part) => !check(part, data, root))) return false;
  if (node.anyOf && !node.anyOf.some((part) => check(part, data, root))) return false;
  if (node.oneOf && node.oneOf.filter((part) => check(part, data, root)).length !== 1) return false;
  if (node.not && check(node.not, data, root)) return false;
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => typeOk(type, data))) return false;
  }
  if ('const' in node && data !== node.const) return false;
  if (node.enum && !node.enum.includes(data)) return false;
  if (typeof data === 'string') {
    if (node.minLength != null && data.length < node.minLength) return false;
    if (node.maxLength != null && data.length > node.maxLength) return false;
    if (node.pattern && !new RegExp(node.pattern, 'u').test(data)) return false;
  }
  if (typeof data === 'number') {
    if (node.minimum != null && data < node.minimum) return false;
    if (node.maximum != null && data > node.maximum) return false;
  }
  if (Array.isArray(data)) {
    if (node.minItems != null && data.length < node.minItems) return false;
    if (node.maxItems != null && data.length > node.maxItems) return false;
    if (node.uniqueItems && new Set(data.map((item) => JSON.stringify(item))).size !== data.length) return false;
    if (node.items && data.some((item) => !check(node.items, item, root))) return false;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (node.required && node.required.some((key) => !(key in data))) return false;
    if (node.additionalProperties === false && node.properties
      && Object.keys(data).some((key) => !(key in node.properties))) return false;
    if (node.properties) {
      for (const [key, value] of Object.entries(data)) {
        if (node.properties[key] && !check(node.properties[key], value, root)) return false;
      }
    }
  }
  if (node.if) {
    const matched = check(node.if, data, root);
    if (matched && node.then && !check(node.then, data, root)) return false;
    if (!matched && node.else && !check(node.else, data, root)) return false;
  }
  return true;
}

function valid(data) {
  return check(schema, data, schema);
}

const V = 'local-usage-receipt.v1';
const M1 = '550e8400-e29b-41d4-a716-446655440000';
const M2 = '6ba7b810-9dad-41d4-a716-446655440000';

function event(machineId, harness, sourceEventId, extra = {}) {
  return {
    source_event_id: sourceEventId,
    dedupe_key: dedupeKey(V, machineId, harness, sourceEventId),
    harness,
    model: 'local-a',
    availability: {
      model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
      tokens: 'source', cost: 'source', tool_calls: 'count',
    },
    provenance: {
      source_kind: 'sqlite', source_label: 'hermes.session_model_usage',
      schema_pin: 'hermes-schema-23', recorded_as: 'invocation',
    },
    ...extra,
  };
}

function receipt(machineId, events) {
  return {
    schema_version: V, kind: 'meow-ops.local-usage-receipt',
    machine_id: machineId, exported_at: '2026-08-15T20:00:00.000Z', events,
  };
}

const hermesExact = receipt(M1, [event(M1, 'hermes', 'sess1-local-a-main', {
  runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
  started_at: '2026-08-15T19:00:00.000Z', ended_at: '2026-08-15T19:05:00.000Z',
  tokens: {
    input: { available: true, value: 100, provenance: 'source' },
    output: { available: true, value: 20, provenance: 'source' },
    cache_read: { available: true, value: 4, provenance: 'source' },
    cache_write: { available: true, value: 2, provenance: 'source' },
    reasoning: { available: true, value: 0, provenance: 'source' },
    total: { available: true, value: 126, provenance: 'source' },
  },
  cost_usd: { available: true, value: 0.02, provenance: 'source' },
  tool_calls: { available: true, count: 3, names: ['Bash', 'Read'] },
})]);

const zeroCost = receipt(M1, [event(M1, 'hermes', 'sess1-local-a-zero', {
  runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
  tokens: {
    input: { available: true, value: 10, provenance: 'source' },
    output: { available: true, value: 2, provenance: 'source' },
  },
  cost_usd: { available: true, value: 0, provenance: 'source' },
  availability: {
    model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
    tokens: 'source', cost: 'source', tool_calls: 'unavailable',
  },
  tool_calls: { available: false },
})]);

const unavailable = receipt(M1, [event(M1, 'hermes', 'sess2-local-a-none', {
  session_id: 'sess2',
  tokens: {
    input: { available: false },
    output: { available: false },
    total: { available: false },
  },
  cost_usd: { available: false },
  tool_calls: { available: false },
  availability: {
    model: 'exact', runtime: 'unavailable', provider: 'unavailable', session: 'exact',
    tokens: 'unavailable', cost: 'unavailable', tool_calls: 'unavailable',
  },
})]);

const multiModel = receipt(M1, [
  event(M1, 'hermes', 'sess1-local-a', { session_id: 'sess1', model: 'local-a', runtime: 'ollama', provider: 'ollama' }),
  event(M1, 'hermes', 'sess1-cloud-b', { session_id: 'sess1', model: 'cloud-b', runtime: 'openrouter', provider: 'openrouter' }),
]);

test('schema encodes fail-closed quantity, pin, and identifier rules', () => {
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.definitions.event.additionalProperties, false);
  assert.equal(schema.definitions.tokenQuantity.properties.value.type, 'integer');
  assert.equal(schema.definitions.moneyQuantity.properties.value.type, 'number');
  assert.equal(schema.definitions.safeId.pattern, '^[a-z0-9][a-z0-9._-]{0,63}$');
  assert.deepEqual(schema.definitions.event.properties.provenance.then.required, ['schema_pin']);
});

test('pass: Hermes exact model with tokens and source cost', () => {
  assert.equal(valid(hermesExact), true);
});

test('pass: local model with explicit zero cost', () => {
  assert.equal(valid(zeroCost), true);
  assert.equal(zeroCost.events[0].cost_usd.value, 0);
});

test('pass: exact model with unavailable tokens and cost', () => {
  assert.equal(valid(unavailable), true);
  assert.equal('value' in unavailable.events[0].cost_usd, false);
});

test('pass: multi-model events sharing one session', () => {
  assert.equal(valid(multiModel), true);
  assert.equal(multiModel.events[0].session_id, multiModel.events[1].session_id);
  assert.notEqual(multiModel.events[0].dedupe_key, multiModel.events[1].dedupe_key);
});

test('pass: same model from two random machine ids', () => {
  const a = receipt(M1, [event(M1, 'hermes', 'shared-evt', { model: 'local-a' })]);
  const b = receipt(M2, [event(M2, 'hermes', 'shared-evt', { model: 'local-a' })]);
  assert.equal(valid(a), true);
  assert.equal(valid(b), true);
  assert.notEqual(a.events[0].dedupe_key, b.events[0].dedupe_key);
});

test('dedupe key is JSON.stringify array SHA-256, not newline-joined', () => {
  const canonical = dedupeKey(V, M1, 'hermes', 'evt-1');
  assert.match(canonical, /^[a-f0-9]{64}$/);
  const newlineJoin = createHash('sha256').update(`${V}\n${M1}\nhermes\nevt-1`, 'utf8').digest('hex');
  assert.notEqual(canonical, newlineJoin);
  const left = JSON.stringify([V, M1, 'a\nb', 'c']);
  const right = JSON.stringify([V, M1, 'a', 'b\nc']);
  assert.notEqual(left, right);
  assert.notEqual(
    createHash('sha256').update(left, 'utf8').digest('hex'),
    createHash('sha256').update(right, 'utf8').digest('hex'),
  );
});

function mutate(base, edit) {
  const copy = structuredClone(base);
  edit(copy);
  return copy;
}

const fail = [
  ['fractional tokens', (row) => { row.events[0].tokens = { input: { available: true, value: 1.5, provenance: 'source' } }; }],
  ['available=false with a value', (row) => { row.events[0].cost_usd = { available: false, value: 100, provenance: 'source' }; }],
  ['missing exact model', (row) => { delete row.events[0].model; }],
  ['selected provenance', (row) => { row.events[0].provenance.recorded_as = 'selected'; }],
  ['inventory provenance', (row) => { row.events[0].provenance.recorded_as = 'inventory'; }],
  ['sqlite without schema_pin', (row) => { delete row.events[0].provenance.schema_pin; }],
  ['malformed dedupe key', (row) => { row.events[0].dedupe_key = 'ABC'; }],
  ['newline in source_event_id', (row) => { row.events[0].source_event_id = 'evt\n2'; }],
  ['control character in source_label', (row) => { row.events[0].provenance.source_label = 'hermes.session\tusage'; }],
  ['forbidden prompt field', (row) => { row.events[0].prompt = 'ignored'; }],
  ['forbidden content field', (row) => { row.events[0].content = 'ignored'; }],
  ['unix path source_event_id', (row) => { row.events[0].source_event_id = '/tmp/state.db'; }],
  ['windows path source_event_id', (row) => { row.events[0].source_event_id = 'C:/state.db'; }],
  ['url source_label', (row) => { row.events[0].provenance.source_label = 'https://example.invalid'; }],
  ['credential field', (row) => { row.events[0].api_key = 'sk-test'; }],
  ['unknown top-level field', (row) => { row.hostname = 'box'; }],
  ['unknown event field', (row) => { row.events[0].username = 'ops'; }],
  ['tool_calls unavailable with names', (row) => { row.events[0].tool_calls = { available: false, names: ['Bash'] }; }],
  ['tool_calls unavailable with count', (row) => { row.events[0].tool_calls = { available: false, count: 1 }; }],
  ['future schema version', (row) => { row.schema_version = 'local-usage-receipt.v2'; }],
];

for (const [name, edit] of fail) {
  test(`fail: ${name}`, () => {
    assert.equal(valid(mutate(hermesExact, edit)), false);
  });
}
